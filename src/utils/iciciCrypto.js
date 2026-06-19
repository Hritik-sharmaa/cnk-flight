const crypto = require('crypto');
const logger = require('./logger');

/**
 * Decrypts an ICICI eCollections hybrid-encrypted payload.
 *
 * ICICI uses:
 *   encryptedKey  = Base64( RSA/ECB/PKCS1 or OAEP( sessionKey, ClientPubKey ) )
 *   encryptedData = Base64( AES/CBC/PKCS5Padding( payload, sessionKey, IV ) )
 *   oaepHashingAlgorithm: "NONE" → RSA_PKCS1_PADDING
 *                          "SHA1" → RSA_PKCS1_OAEP_PADDING (SHA-1/MGF1)
 *   IV is either sent separately in the "iv" field OR prepended as the first
 *   16 bytes of the decoded encryptedData bytes.
 */
async function decryptIciciPayload(body) {
  const privateKeyPem = process.env.ICICI_PRIVATE_KEY;
  if (!privateKeyPem) throw new Error('ICICI_PRIVATE_KEY env var is not set');

  // Step 1: Decrypt the session key with our RSA private key
  const oaep = (body.oaepHashingAlgorithm || 'NONE').toUpperCase();
  const rsaPadding = oaep === 'SHA1'
    ? crypto.constants.RSA_PKCS1_OAEP_PADDING
    : crypto.constants.RSA_PKCS1_PADDING;

  const encryptedKeyBuf = Buffer.from(body.encryptedKey || '', 'base64');
  const encryptedDataBuf = Buffer.from(body.encryptedData || '', 'base64');

  const privKeyObj = crypto.createPrivateKey(privateKeyPem);
  const modulusBytes = (privKeyObj.asymmetricKeyDetails?.modulusLength ?? 0) / 8;

  logger.info(
    `[IciciCrypto] incoming: oaepHashingAlgorithm=${oaep} | ` +
    `RSA key=${modulusBytes * 8}-bit (${modulusBytes}B modulus) | ` +
    `encryptedKey=${encryptedKeyBuf.length}B | encryptedData=${encryptedDataBuf.length}B | ` +
    `iv field="${body.iv || ''}"`
  );

  if (encryptedKeyBuf.length === 0) {
    throw new Error('encryptedKey field is missing or empty in the request body');
  }
  if (encryptedKeyBuf.length > modulusBytes) {
    throw new Error(
      `encryptedKey size (${encryptedKeyBuf.length}B) exceeds RSA key modulus (${modulusBytes}B / ${modulusBytes * 8}-bit). ` +
      `ICICI encrypted with a ${encryptedKeyBuf.length * 8}-bit public cert but ICICI_PRIVATE_KEY is only ${modulusBytes * 8}-bit. ` +
      `Deploy the matching ${encryptedKeyBuf.length * 8}-bit private key.`
    );
  }

  const sessionKey = crypto.privateDecrypt({ key: privateKeyPem, padding: rsaPadding }, encryptedKeyBuf);
  logger.info(`[IciciCrypto] RSA decrypt OK — sessionKey=${sessionKey.length}B (${sessionKey.length * 8}-bit AES key)`);

  // Step 2: Extract IV and ciphertext from encryptedData
  let iv;
  let ciphertext;

  if (body.iv && body.iv.length > 0) {
    iv = Buffer.from(body.iv, 'base64');
    ciphertext = encryptedDataBuf;
  } else {
    // IV is the first 16 bytes of the decoded encryptedData (ICICI standard)
    iv = encryptedDataBuf.subarray(0, 16);
    ciphertext = encryptedDataBuf.subarray(16);
  }

  logger.info(`[IciciCrypto] AES: iv=${iv.length}B ciphertext=${ciphertext.length}B`);

  if (iv.length !== 16) {
    throw new Error(
      `IV must be exactly 16 bytes for AES-CBC, got ${iv.length}B. ` +
      `encryptedData decoded to ${encryptedDataBuf.length}B — ICICI should prepend IV as first 16 bytes.`
    );
  }

  // Step 3: AES-CBC decrypt — ICICI uses 128-bit (16B) or 256-bit (32B) session keys
  const aesAlgoMap = { 16: 'aes-128-cbc', 32: 'aes-256-cbc' };
  const algo = aesAlgoMap[sessionKey.length];
  if (!algo) {
    throw new Error(
      `Unexpected AES session key length: ${sessionKey.length}B. ` +
      `Expected 16B (AES-128) or 32B (AES-256). ` +
      `RSA decryption likely used wrong padding — oaepHashingAlgorithm was "${oaep}".`
    );
  }

  const decipher = crypto.createDecipheriv(algo, sessionKey, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  logger.info(`[IciciCrypto] AES decrypt OK — plaintext=${decrypted.length}B`);

  return JSON.parse(decrypted.toString('utf8'));
}

/**
 * Encrypts our response payload back to ICICI using hybrid encryption.
 * Uses ICICI's public certificate to encrypt the AES session key.
 */
function encryptIciciResponse(payload, requestId = '', service = '') {
  const iciciCert = process.env.ICICI_PUBLIC_CERT;
  if (!iciciCert) throw new Error('ICICI_PUBLIC_CERT env var is not set');

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
