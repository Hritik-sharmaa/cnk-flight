const crypto = require('crypto');

/**
 * Decrypts an ICICI eCollections hybrid-encrypted payload.
 *
 * ICICI uses:
 *   encryptedKey  = Base64( RSA/ECB/PKCS1( sessionKey, ClientPubKey ) )
 *   encryptedData = Base64( AES/CBC/PKCS5Padding( payload, sessionKey, IV ) )
 *   IV is either sent separately in the "iv" field OR prepended as the first
 *   16 bytes of the decoded encryptedData bytes.
 *
 * @param {{ encryptedKey: string, oaepHashingAlgorithm?: string, iv?: string, encryptedData: string, service?: string, requestId?: string }} body
 * @returns {Promise<Record<string, string>>}
 */
async function decryptIciciPayload(body) {
  const privateKeyPem = process.env.ICICI_PRIVATE_KEY;
  if (!privateKeyPem) throw new Error('ICICI_PRIVATE_KEY env var is not set');

  // Step 1: Decrypt the session key with our RSA private key (PKCS1 padding)
  const encryptedKeyBuf = Buffer.from(body.encryptedKey, 'base64');
  const sessionKey = crypto.privateDecrypt(
    { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
    encryptedKeyBuf
  );

  // Step 2: Get IV and ciphertext from encryptedData
  const encryptedDataBuf = Buffer.from(body.encryptedData, 'base64');

  let iv;
  let ciphertext;

  if (body.iv && body.iv.length > 0) {
    // IV provided separately (base64-encoded, 16 bytes when decoded)
    iv = Buffer.from(body.iv, 'base64');
    ciphertext = encryptedDataBuf;
  } else {
    // IV is the first 16 bytes of the decoded encryptedData
    iv = encryptedDataBuf.subarray(0, 16);
    ciphertext = encryptedDataBuf.subarray(16);
  }

  // Step 3: Decrypt with AES-128-CBC or AES-256-CBC depending on session key length
  const algo = sessionKey.length === 32 ? 'aes-256-cbc' : 'aes-128-cbc';
  const decipher = crypto.createDecipheriv(algo, sessionKey, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return JSON.parse(decrypted.toString('utf8'));
}

/**
 * Encrypts our response payload back to ICICI using hybrid encryption.
 * Uses ICICI's public certificate to encrypt the AES session key.
 *
 * @param {Record<string, string>} payload
 * @returns {{ encryptedKey: string, iv: string, encryptedData: string }}
 */
function encryptIciciResponse(payload, requestId = '', service = '') {
  // ICICI_TEST_SELF_ENCRYPT=true → use our own public key so local tests can decrypt responses
  let iciciCert;
  if (process.env.ICICI_TEST_SELF_ENCRYPT === 'true') {
    const privateKeyPem = process.env.ICICI_PRIVATE_KEY;
    if (!privateKeyPem) throw new Error('ICICI_PRIVATE_KEY env var is not set');
    iciciCert = crypto.createPublicKey(privateKeyPem).export({ type: 'pkcs1', format: 'pem' });
  } else {
    iciciCert = process.env.ICICI_PUBLIC_CERT;
    if (!iciciCert) throw new Error('ICICI_PUBLIC_CERT env var is not set');
  }

  const sessionKey = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv('aes-128-cbc', sessionKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);

  const encryptedKey = crypto.publicEncrypt(
    { key: iciciCert, padding: crypto.constants.RSA_PKCS1_PADDING },
    sessionKey
  );

  return {
    requestId: requestId || '',
    service: service || '',
    encryptedKey: encryptedKey.toString('base64'),
    oaepHashingAlgorithm: 'NONE',
    iv: iv.toString('base64'),
    encryptedData: encrypted.toString('base64'),
    clientInfo: '',
    optionalParam: '',
  };
}

module.exports = { decryptIciciPayload, encryptIciciResponse };
