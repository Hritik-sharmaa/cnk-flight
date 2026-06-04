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

  try {
    crypto.createPrivateKey(privateKey);
  } catch (e) {
    console.error('[STARTUP] FATAL: ICICI_PRIVATE_KEY is invalid:', e.message);
    process.exit(1);
  }

  try {
    crypto.createPublicKey(publicCert);
  } catch (e) {
    console.error('[STARTUP] FATAL: ICICI_PUBLIC_CERT is invalid:', e.message);
    process.exit(1);
  }

  console.log('[STARTUP] ICICI keys validated OK');
})();

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`[cnk-flight] Server running on port ${PORT} | provider: ${process.env.FLIGHT_PROVIDER || 'tripjack'} | env: ${process.env.NODE_ENV || 'development'}`);
});
