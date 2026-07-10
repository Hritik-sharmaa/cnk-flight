/**
 * Verifies whether ICICI_PRIVATE_KEY in .env matches a given public key.
 *
 * Usage:
 *   node scripts/verifyIciciKeys.js
 *
 * Set ICICI_PUBLIC_KEY_TO_VERIFY in .env to the public key you want to verify against.
 */

require('dotenv').config();
const crypto = require('crypto');

const privateKeyPem = process.env.ICICI_PRIVATE_KEY;
const publicKeyToVerify = process.env.ICICI_PUBLIC_KEY_FROM_PRIVATE_KEY;

if (!privateKeyPem) {
  console.error('❌ ICICI_PRIVATE_KEY is missing in .env');
  process.exit(1);
}

if (!publicKeyToVerify) {
  console.error('❌ ICICI_PUBLIC_KEY_TO_VERIFY is missing in .env');
  console.error('   Add the public key you want to verify in .env as ICICI_PUBLIC_KEY_TO_VERIFY');
  process.exit(1);
}

try {
  // Derive public key from private key
  const derivedPublicKey = crypto
    .createPublicKey(privateKeyPem)
    .export({ type: 'spki', format: 'pem' });

  // Normalize — strip all whitespace and headers, reformat to 64-char lines
  const stripped = publicKeyToVerify.trim().replace(/\s+/g, '');
  const isCert = stripped.includes('BEGINCERTIFICATE') || stripped.length > 800;

  let normalizedInputKey;

  if (isCert) {
    // It's an X.509 certificate — extract public key from it
    const certBase64 = stripped
      .replace(/-----BEGINCERTIFICATE-----/g, '')
      .replace(/-----ENDCERTIFICATE-----/g, '');
    const chunked = certBase64.match(/.{1,64}/g).join('\n');
    const certPem = `-----BEGIN CERTIFICATE-----\n${chunked}\n-----END CERTIFICATE-----`;
    normalizedInputKey = crypto
      .createPublicKey(certPem)
      .export({ type: 'spki', format: 'pem' });
  } else {
    // It's a raw public key
    const chunked = stripped.match(/.{1,64}/g).join('\n');
    const pubPem = `-----BEGIN PUBLIC KEY-----\n${chunked}\n-----END PUBLIC KEY-----`;
    normalizedInputKey = crypto
      .createPublicKey(pubPem)
      .export({ type: 'spki', format: 'pem' });
  }

  console.log('\n--- ICICI Key Verification ---\n');

  if (derivedPublicKey === normalizedInputKey) {
    console.log('✅ MATCH — The public key belongs to your private key.');
    console.log('   Safe to send this public key to ICICI.\n');
  } else {
    console.log('❌ NO MATCH — The public key does NOT belong to your private key.');
    console.log('   Do not send this to ICICI — check which key pair you are using.\n');
  }

  console.log('Public key derived from your private key:');
  console.log(derivedPublicKey);

} catch (err) {
  console.error('❌ Error:', err.message);
  console.error('   Check that both keys are valid PEM format.');
}
