/**
 * Local test: simulate an ICICI E-Collections MSG HOLD + MIS POSTING request.
 * Run: node test-icici-van.js --van CNK100000001 [--amount 10000]
 *
 * It encrypts a fake payload exactly as ICICI would, then POSTs to localhost.
 * NOTE: temporarily add 127.0.0.1 to ICICI_WHITELISTED_IPS in .env for local testing.
 */

require('dotenv').config();
const crypto = require('crypto');

// Parse --van and --amount flags
const args = process.argv.slice(2);
const vanIdx = args.indexOf('--van');
const amtIdx = args.indexOf('--amount');
const VAN = vanIdx !== -1 ? args[vanIdx + 1] : 'CNK100000001';
const AMOUNT = amtIdx !== -1 ? args[amtIdx + 1] : '10000.00';
const BASE_URL = 'http://localhost:3001';

console.log(`\n🔧 Test config: VAN=${VAN} | Amount=₹${AMOUNT}`);

function encryptLikeICICI(payload) {
  const privateKeyPem = process.env.ICICI_PRIVATE_KEY;
  if (!privateKeyPem) throw new Error('ICICI_PRIVATE_KEY not set');

  // Extract public key from our private key (this is what ICICI holds)
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicKey = crypto.createPublicKey(privateKey);
  const publicKeyPem = publicKey.export({ type: 'pkcs1', format: 'pem' });

  // 1. Generate random 16-byte session key
  const sessionKey = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);

  // 2. Encrypt payload with AES-128-CBC
  const cipher = crypto.createCipheriv('aes-128-cbc', sessionKey, iv);
  const encryptedData = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);

  // 3. Encrypt session key with RSA/PKCS1 using our public key
  const encryptedKey = crypto.publicEncrypt(
    { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
    sessionKey
  );

  return {
    requestId: crypto.randomUUID(),
    service: 'MSGHOLD',
    encryptedKey: encryptedKey.toString('base64'),
    oaepHashingAlgorithm: 'NONE',
    iv: iv.toString('base64'),
    encryptedData: encryptedData.toString('base64'),
    clientInfo: '',
    optionalParam: '',
  };
}

async function testMsgHold(van) {
  const payload = {
    ClientCode: 'CNK',
    VirtualAccountNumber: van,
    Mode: 'NEFT',
    UTR: `ICIC${Date.now()}`,
    USERID: 'CNKTEST',
    SenderRemark: 'Test payment',
    ClientAccountNo: `TEL${van}`,
    Amount: AMOUNT,
    PayerName: 'Test Payer',
    PayerAccNumber: '0008429324',
    PayerBankIFSC: 'ICIC00000',
    PayerPaymentDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    BankInternalTransactionNumber: `REQ${Date.now()}`,
  };

  console.log('\n── MSG HOLD ─────────────────────────────────────');
  console.log('VAN:', van);
  console.log('Amount:', payload.Amount);
  console.log('UTR:', payload.UTR);

  const body = encryptLikeICICI(payload);
  const res = await fetch(`${BASE_URL}/api/v1/icici/msg-hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const raw = await res.json();
  console.log('\nRaw encrypted response:', JSON.stringify(raw, null, 2));

  // Decrypt the response to see what we actually replied
  try {
    const privateKeyPem = process.env.ICICI_PRIVATE_KEY;
    const encKeyBuf = Buffer.from(raw.encryptedKey, 'base64');
    const sessionKey = crypto.privateDecrypt(
      { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
      encKeyBuf
    );
    const encDataBuf = Buffer.from(raw.encryptedData, 'base64');
    const iv = raw.iv ? Buffer.from(raw.iv, 'base64') : encDataBuf.subarray(0, 16);
    const ct = raw.iv ? encDataBuf : encDataBuf.subarray(16);
    const decipher = crypto.createDecipheriv('aes-128-cbc', sessionKey, iv);
    const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);
    const result = JSON.parse(decrypted.toString('utf8'));
    console.log('\n✅ Decrypted response:', result);
    return { payload, result };
  } catch (e) {
    console.error('Decryption of response failed:', e.message);
    return null;
  }
}

async function testMisPosting(van, utr) {
  const payload = {
    ClientCode: 'CNK',
    VirtualAccountNumber: van,
    Mode: 'NEFT',
    UTR: utr,
    USERID: 'CNKTEST',
    SenderRemark: 'Test payment',
    ClientAccountNo: `TEL${van}`,
    Amount: AMOUNT,
    PayerName: 'Test Payer',
    PayerAccNumber: '0008429324',
    PayerBankIFSC: 'ICIC00000',
    PayerPaymentDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    BankInternalTransactionNumber: `REQ${Date.now()}`,
  };

  console.log('\n── MIS POSTING ──────────────────────────────────');

  const body = encryptLikeICICI(payload);
  const res = await fetch(`${BASE_URL}/api/v1/icici/mis-posting`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const raw = await res.json();

  try {
    const privateKeyPem = process.env.ICICI_PRIVATE_KEY;
    const encKeyBuf = Buffer.from(raw.encryptedKey, 'base64');
    const sessionKey = crypto.privateDecrypt(
      { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
      encKeyBuf
    );
    const encDataBuf = Buffer.from(raw.encryptedData, 'base64');
    const iv = raw.iv ? Buffer.from(raw.iv, 'base64') : encDataBuf.subarray(0, 16);
    const ct = raw.iv ? encDataBuf : encDataBuf.subarray(16);
    const decipher = crypto.createDecipheriv('aes-128-cbc', sessionKey, iv);
    const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);
    const result = JSON.parse(decrypted.toString('utf8'));
    console.log('✅ Decrypted response:', result);
  } catch (e) {
    console.error('Decryption failed:', e.message);
  }
}

(async () => {
  try {
    const msgHoldResult = await testMsgHold(VAN);
    if (msgHoldResult?.result?.AcceptOrReject === 'Y') {
      console.log('\n→ Payment accepted! Now sending MIS POSTING...');
      await testMisPosting(VAN, msgHoldResult.payload.UTR);
    } else {
      console.log('\n→ Payment rejected or error — skipping MIS POSTING');
      console.log('  Tip: pass a valid active VAN as argument: node test-icici-van.js <VAN>');
    }
  } catch (e) {
    console.error('Test failed:', e.message);
  }
})();


// node --security-revert=CVE-2023-46809 test-icici-van.js --van CNK100000012 --amount 1274837.00
