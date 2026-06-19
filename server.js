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

  // Log key sizes — a wrong-sized ICICI_PRIVATE_KEY is the #1 cause of "data too large for modulus".
  // ICICI_PRIVATE_KEY = OUR private key (decrypts ICICI's callbacks to us) → must be 4096-bit per spec.
  // ICICI_PUBLIC_CERT = ICICI's cert (encrypts our responses to them) → size is theirs to decide.
  const privBits = privKeyObj.asymmetricKeyDetails?.modulusLength ?? '?';
  const iciciPubBits = pubKeyObj.asymmetricKeyDetails?.modulusLength ?? '?';
  console.log(`[STARTUP] ICICI_PRIVATE_KEY: ${privBits}-bit RSA (our private key — ICICI uses matching cert to encrypt session keys)`);
  console.log(`[STARTUP] ICICI_PUBLIC_CERT: ${iciciPubBits}-bit RSA (ICICI's public key — we use this to encrypt responses)`);

  if (privBits !== 4096) {
    console.error(
      `[STARTUP] FATAL: ICICI_PRIVATE_KEY is ${privBits}-bit. ` +
      `ICICI Bank requires a 4096-bit key (section 1.5 of Ecollection_Validation_v1.pdf). ` +
      `They will encrypt every session key with the 4096-bit cert you gave them during onboarding — decryption will always fail with a smaller key.`
    );
    process.exit(1);
  }

  console.log('[STARTUP] ICICI keys validated OK');
})();

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`[cnk-flight] Server running on port ${PORT} | provider: ${process.env.FLIGHT_PROVIDER || 'tripjack'} | env: ${process.env.NODE_ENV || 'development'}`);
});
