require('dotenv').config();
const crypto = require('crypto');
const app = require('./src/app');

// Validate ICICI keys at startup — refuse to boot if misconfigured.
// A missing/wrong cert causes every MSG HOLD to 500 → Deemed Accept → all payments accepted blindly.
(function validateIciciConfig() {
  const privateKey = process.env.ICICI_PRIVATE_KEY;
  const publicCert = process.env.ICICI_PUBLIC_CERT;

  if (!privateKey) {
    console.error('[STARTUP] FATAL: ICICI_PRIVATE_KEY is not set in .env');
    process.exit(1);
  }
  if (!publicCert) {
    console.error('[STARTUP] FATAL: ICICI_PUBLIC_CERT is not set in .env');
    process.exit(1);
  }

  let privKeyObj;
  try {
    privKeyObj = crypto.createPrivateKey(privateKey);
  } catch (e) {
    console.error('[STARTUP] FATAL: ICICI_PRIVATE_KEY is invalid:', e.message);
    process.exit(1);
  }

  let pubKeyObj;
  try {
    pubKeyObj = crypto.createPublicKey(publicCert);
  } catch (e) {
    console.error('[STARTUP] FATAL: ICICI_PUBLIC_CERT is invalid:', e.message);
    process.exit(1);
  }

  // Log key sizes — mismatched key sizes are the #1 cause of "data too large for modulus"
  const privKeyDetails = privKeyObj.asymmetricKeyDetails;
  const pubKeyDetails = pubKeyObj.asymmetricKeyDetails;
  const privBits = privKeyDetails?.modulusLength ?? '?';
  const pubBits = pubKeyDetails?.modulusLength ?? '?';
  console.log(`[STARTUP] ICICI_PRIVATE_KEY: ${privBits}-bit RSA private key`);
  console.log(`[STARTUP] ICICI_PUBLIC_CERT: ${pubBits}-bit RSA public key`);

  if (privBits !== pubBits) {
    console.error(`[STARTUP] FATAL: Key size mismatch — private key is ${privBits}-bit but public cert is ${pubBits}-bit. They must match.`);
    process.exit(1);
  }
  if (privBits !== 4096) {
    console.warn(`[STARTUP] WARNING: ICICI requires a 4096-bit key (section 1.5 of Ecollection_Validation_v1.pdf). Current key is ${privBits}-bit. ICICI will encrypt the session key with the 4096-bit cert you provided to them — decryption will fail if this key doesn't match.`);
  }

  console.log('[STARTUP] ICICI keys validated OK');
})();

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`[cnk-flight] Server running on port ${PORT} | provider: ${process.env.FLIGHT_PROVIDER || 'tripjack'} | env: ${process.env.NODE_ENV || 'development'}`);
});
