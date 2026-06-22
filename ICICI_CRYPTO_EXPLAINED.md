# ICICI eCollections — Encryption & Decryption: Complete Guide for New Joiners

> **Who is this for?**
> Anyone new to the team who needs to understand how ICICI Bank sends us payment data and how our server reads it. No prior cryptography knowledge needed. Read top to bottom.

---

## Table of Contents

1. [Why does encryption exist?](#1-why-does-encryption-exist)
2. [The three problems encryption solves](#2-the-three-problems-encryption-solves)
3. [RSA — The Padlock System](#3-rsa--the-padlock-system)
4. [AES — The Combination Lock](#4-aes--the-combination-lock)
5. [IV — The Salt](#5-iv--the-salt)
6. [Base64 — The Translator](#6-base64--the-translator)
7. [Hybrid Encryption — How RSA and AES work together](#7-hybrid-encryption--how-rsa-and-aes-work-together)
8. [What ICICI actually sends us](#8-what-icici-actually-sends-us)
9. [Complete Flow Diagram](#9-complete-flow-diagram)
10. [Decryption Code — Line by Line](#10-decryption-code--line-by-line)
11. [Encryption Code — Line by Line](#11-encryption-code--line-by-line)
12. [Glossary of Every Term](#12-glossary-of-every-term)
13. [Current Bug and Status](#13-current-bug-and-status)

---

## 1. Why does encryption exist?

When ICICI Bank calls our server with a payment, the data travels across the internet:

```
ICICI Bank Server
      │
      │  (travels through internet)
      │  ← anyone sitting in the middle can read this
      │
Our Server
```

Without encryption, this is what the interceptor sees:

```json
{
  "Amount": "50000",
  "PayerAccNumber": "0008429324",
  "VirtualAccountNumber": "TEL9834191192"
}
```

Real account numbers, real amounts — completely exposed.

**Encryption scrambles this** so the interceptor sees:

```
mtIktFRBPPs6SVxh0RWWvsa9bj/W/M56QwvbY/vgYAIolB...
```

Completely unreadable garbage. Only our server — with the right keys — can unscramble it.

---

## 2. The three problems encryption solves

| Problem | What it means | How it's solved |
|---------|--------------|-----------------|
| **Confidentiality** | Nobody else should read the data | Scramble data with AES |
| **Key sharing** | How do we share the AES password securely? | Lock the AES key with RSA |
| **Pattern recognition** | Same amount → same encrypted output → hacker spots patterns | Add a random IV (salt) |

---

## 3. RSA — The Padlock System

### The mental model

Imagine you manufacture padlocks. You make 1000 identical open padlocks and give one to ICICI. You keep the **only master key** that opens all of them.

```
You create:
  ┌─────────────────┐        ┌──────────────────┐
  │   PADLOCK       │        │   MASTER KEY     │
  │  (Public Key /  │        │  (Private Key)   │
  │   Certificate)  │        │                  │
  │                 │        │  Only YOU have   │
  │  Give to ICICI  │        │  this. Keep it   │
  │  → anyone can   │        │  SECRET always.  │
  │    lock with it │        │                  │
  └─────────────────┘        └──────────────────┘
```

ICICI wants to send you a secret:

```
ICICI:
  1. Puts the secret inside a box
  2. Locks it with YOUR padlock (only your master key opens it)
  3. Sends the locked box to you

You:
  1. Receive the locked box
  2. Open with your master key (only you can)
  3. Read the secret
```

Even if someone intercepts the locked box — **they cannot open it**. They don't have your master key.

### RSA in numbers

RSA works by doing mathematical operations on very large numbers.

- **512-bit RSA** → small, weak, easily broken today
- **2048-bit RSA** → decent, used by many
- **4096-bit RSA** → very strong, what ICICI uses with us

"4096-bit" means the mathematical key is a number with 4096 binary digits. Brute-forcing this would take longer than the age of the universe.

### Two padding modes — PKCS1 vs OAEP

When RSA encrypts 32 bytes of data into a 512-byte block, the remaining 480 bytes need to be filled with something. This filling is called **padding**. Two standards exist:

```
PKCS1 (older):
  [0x00][0x02][random non-zero bytes...][0x00][your data]
  Simple, widely supported, ICICI uses this → oaepHashingAlgorithm: "NONE"

OAEP with SHA1 (newer):
  More complex filling using SHA1 hashing, harder to attack
  → oaepHashingAlgorithm: "SHA1"
```

ICICI tells us which they used. We must use the same mode to decrypt.
If they locked with PKCS1 and we try OAEP → wrong key, decryption fails.

---

## 4. AES — The Combination Lock

### The problem with RSA alone

RSA is powerful but **extremely slow** for large data. A payment payload might be 500 bytes. Encrypting 500 bytes with RSA on every transaction would be too slow for real-time banking.

Solution: Use a fast cipher for the actual data.

### AES is a fast scrambler

AES (Advanced Encryption Standard) is like a **combination lock for data**:

```
Data + Key → AES Encrypt → Scrambled Data
Scrambled Data + Key → AES Decrypt → Original Data
```

It's blazingly fast. Banks, WhatsApp, your browser — everything uses AES.

### Key sizes

```
AES-128:
  Key = 16 bytes = 128 bits
  Like a 128-character binary password
  Example key bytes: H7x$mK9pL2qR8nWv  (16 characters)

AES-256:
  Key = 32 bytes = 256 bits
  Like a 256-character binary password
  Example key bytes: H7x$mK9pL2qR8nWvT4uY6jE1cB3sA5dF  (32 characters)
```

The AES key is called the **Session Key** because:
- It is randomly generated fresh for **every single transaction**
- It is used once and thrown away
- Next transaction gets a completely different key

### CBC mode

AES works in blocks of 16 bytes at a time. CBC (Cipher Block Chaining) means each block is mixed with the previous encrypted block before encrypting:

```
Block 1:  PaymentData_part1 XOR iv          → Encrypted_Block_1
Block 2:  PaymentData_part2 XOR Encrypted_Block_1 → Encrypted_Block_2
Block 3:  PaymentData_part3 XOR Encrypted_Block_2 → Encrypted_Block_3
...
```

This chaining means:
- Changing one byte of input changes ALL subsequent blocks
- Makes it exponentially harder to crack

---

## 5. IV — The Salt

### The problem without IV

Imagine AES without IV:

```
Transaction 1: Amount=10000, Account=ABC → always produces → "mK9pL2qR..."
Transaction 2: Amount=10000, Account=ABC → always produces → "mK9pL2qR..."
```

Same input + same key = same output. A hacker watching traffic can say:
> "Every time I see mK9pL2qR..., someone is transferring ₹10,000 to account ABC."

### IV fixes this

IV (Initialization Vector) is a **16-byte random number** generated fresh every transaction. It's mixed into the very first AES block:

```
Transaction 1: Amount=10000, Account=ABC + IV=X7k2... → "mK9pL2qR..."
Transaction 2: Amount=10000, Account=ABC + IV=P3h8... → "xQ7rN4sY..."
```

Same data + same key + **different IV** = completely different output every time.

IV is NOT secret. It travels with the encrypted data. Its only job is to be **random and unique** per transaction.

### How ICICI sends the IV

ICICI can send it two ways:

```
Way 1 — Separate field:
  {
    "encryptedData": "scrambled data only...",
    "iv": "base64-encoded IV here"
  }

Way 2 — Prepended to encryptedData:
  {
    "encryptedData": "[16 bytes IV][scrambled data]",
    "iv": ""    ← empty
  }
  → We take first 16 bytes as IV, rest as ciphertext
```

ICICI uses Way 2 (empty `iv` field, IV is inside `encryptedData`).

---

## 6. Base64 — The Translator

### The problem

Encrypted data is raw binary — bytes like `0xFF`, `0x00`, `0x1A`. These bytes:
- Cannot safely be put in JSON
- May contain characters that break HTTP
- Are not printable text

### The solution: Base64

Base64 converts any binary bytes to a safe text alphabet of only 64 characters: `A-Z`, `a-z`, `0-9`, `+`, `/`, `=`

```
Raw bytes:  [0xFF][0x00][0x1A][0x3C]...
Base64:     /wAaPA==...
```

The name "Base64" comes from using 64 safe characters.

### How it works

Every 3 bytes of binary → 4 characters of Base64:

```
3 bytes = 24 bits
24 bits ÷ 6 bits each = 4 Base64 characters

Example:
Binary:  01001000 01100101 01101100
Base64:  S        G        V        s
```

This means Base64 output is always 33% larger than the input.

```
16 bytes  → 24 Base64 chars
32 bytes  → 44 Base64 chars
512 bytes → 684 Base64 chars
```

### In our code

```javascript
// Base64 text → raw bytes (for decrypting what ICICI sent)
const encryptedKeyBuf = Buffer.from(body.encryptedKey, 'base64');

// Raw bytes → Base64 text (for sending our response back to ICICI)
encryptedKey.toString('base64')
```

---

## 7. Hybrid Encryption — How RSA and AES work together

Using both RSA and AES together solves all three problems:

```
RSA  → Slow but can securely share a key with anyone
AES  → Fast but both sides need to already know the key

Solution:
  Use RSA to securely share the AES key
  Use AES to encrypt the actual data
```

### ICICI encrypting a payment (their side):

```
Step 1: Generate random session key
        sessionKey = random 16 bytes → "H7x$mK9pL2qR8nWv"

Step 2: Generate random IV
        iv = random 16 bytes → "AbCdEfGhIjKlMnOp"

Step 3: Scramble payment data with AES
        encryptedData = AES_encrypt(paymentJSON, sessionKey, iv)

Step 4: Lock the session key with OUR padlock (our public cert)
        encryptedKey = RSA_encrypt(sessionKey, our_public_cert)

Step 5: Base64-encode everything and send to us
```

### Us decrypting it (our side):

```
Step 1: Base64-decode everything back to raw bytes

Step 2: RSA-unlock the session key using our private key
        sessionKey = RSA_decrypt(encryptedKey, our_private_key)
        → should give back "H7x$mK9pL2qR8nWv" (16 bytes)

Step 3: Extract IV from first 16 bytes of encryptedData
        iv = encryptedData[0..16]

Step 4: AES-unscramble the payment data
        paymentJSON = AES_decrypt(encryptedData[16..], sessionKey, iv)

Step 5: Parse JSON → get payment fields
```

---

## 8. What ICICI actually sends us

ICICI calls our `/api/v1/icici/msg-hold` endpoint with this JSON body:

```json
{
  "requestId": "REQ20213000001",
  "service": "MSG_HOLD",
  "encryptedKey": "pKY7abA+qRizRdYdAmZ8P+O0Pli+4NQSo...(684 chars)",
  "oaepHashingAlgorithm": "NONE",
  "iv": "",
  "encryptedData": "mtIktFRBPPs6SVxh0RWWvsa9bj/W/M56...(many chars)",
  "clientInfo": "",
  "optionalParam": ""
}
```

| Field | What it is | Size |
|-------|-----------|------|
| `encryptedKey` | Our session key, locked with our RSA padlock | 684 Base64 chars = 512 raw bytes (4096-bit RSA output) |
| `oaepHashingAlgorithm` | Which RSA padding mode ICICI used | `"NONE"` = PKCS1, `"SHA1"` = OAEP |
| `iv` | The AES salt — empty means it's inside encryptedData | Empty string |
| `encryptedData` | IV (16 bytes) + scrambled payment JSON | Variable |

After we decrypt, we should get:

```json
{
  "ClientCode": "ABC",
  "VirtualAccountNumber": "TEL9834191192",
  "Mode": "RTGS",
  "UTR": "ICIC52011986928310711",
  "SenderRemark": "Testing",
  "ClientAccountNo": "TEL9834191192",
  "Amount": "10000.00",
  "PayerName": "-",
  "PayerAccNumber": "0008429324",
  "PayerBankIFSC": "ICIC00000",
  "PayerPaymentDate": "20251202",
  "BankInternalTransactionNumber": "REQ20213000001"
}
```

We respond with accept or reject (also encrypted).

---

## 9. Complete Flow Diagram

### Full Transaction Flow

```
                        PAYER
                          │
                          │ Sends ₹10,000 to Virtual Account
                          ▼
                     ICICI BANK
                          │
                          │ 1. Generates session key (16 random bytes)
                          │ 2. Generates IV (16 random bytes)
                          │ 3. AES-encrypts payment data
                          │ 4. RSA-encrypts session key with CNK's public cert
                          │ 5. Base64 encodes everything
                          │
                          │ HTTP POST /api/v1/icici/msg-hold
                          │ {encryptedKey, encryptedData, oaepHashingAlgorithm, iv}
                          ▼
                     OUR SERVER
                     (iciciCrypto.js)
                          │
                          │ 1. Base64 decode encryptedKey → 512 raw bytes
                          │ 2. RSA decrypt with ICICI_PRIVATE_KEY → session key (16B)
                          │ 3. Base64 decode encryptedData → raw bytes
                          │ 4. Take first 16 bytes → IV
                          │ 5. AES decrypt rest with session key + IV → JSON
                          │ 6. Parse JSON → payment fields
                          │
                          ▼
                    BUSINESS LOGIC
                    (iciciController.js)
                          │
                          │ Check VirtualAccountNumber exists in our database
                          │ Decide: Accept (Y) or Reject (N)
                          │
                          │ Encrypt response using ICICI's public cert
                          │ {AcceptOrReject: "Y", Message: "Accept", Code: "11"}
                          │
                          │ HTTP 200 response (encrypted)
                          ▼
                     ICICI BANK
                          │
                          │ Decrypts our response
                          │ If Y → credits money to our account
                          │ If N → refunds payer
```

---

### Encryption Detail (ICICI encrypting before sending to us)

```
PLAIN TEXT PAYMENT JSON
{Amount: "10000", UTR: "ICIC...", ...}
         │
         │
         ▼
┌─────────────────────────────────────┐
│          AES-128-CBC ENCRYPT         │
│                                     │
│  Input:  Payment JSON bytes         │
│  Key:    sessionKey (16 random B)   │  ← one-time random password
│  IV:     iv (16 random bytes)       │  ← one-time random salt
│                                     │
│  Output: scrambled bytes            │
└─────────────────────────────────────┘
         │
         │  prepend IV to output
         ▼
[IV 16B][scrambled payment bytes]
         │
         │  Base64 encode
         ▼
"mtIktFRBPPs6SVxh..."   ← encryptedData field


sessionKey (16 bytes)
         │
         ▼
┌─────────────────────────────────────┐
│          RSA-4096-PKCS1 ENCRYPT     │
│                                     │
│  Input:  sessionKey (16 bytes)      │
│  Key:    CNK's public certificate   │  ← our padlock
│                                     │
│  Output: 512 bytes of RSA ciphertext│
└─────────────────────────────────────┘
         │
         │  Base64 encode
         ▼
"pKY7abA+qRizRd..."   ← encryptedKey field
```

---

### Decryption Detail (us decrypting what ICICI sent)

```
RECEIVED FROM ICICI:
{
  encryptedKey:  "pKY7abA+qRizRd..."   (Base64)
  encryptedData: "mtIktFRBPPs6SV..."   (Base64)
  iv:            ""                    (empty = IV is inside encryptedData)
  oaepHashingAlgorithm: "NONE"         (PKCS1 mode)
}
         │
         │
         ▼
STEP 1 — Base64 Decode

"pKY7abA+qRizRd..."  →  [512 raw bytes]   (encryptedKeyBuf)
"mtIktFRBPPs6SV..."  →  [400 raw bytes]   (encryptedDataBuf)

         │
         ▼
STEP 2 — RSA Decrypt the session key

[512 raw bytes]
         │
         │  crypto.privateDecrypt(ICICI_PRIVATE_KEY, encryptedKeyBuf)
         ▼
[16 raw bytes]   ← sessionKey
"H7x$mK9pL2qR8nWv"

         │
         ▼
STEP 3 — Extract IV from encryptedData

[400 raw bytes]
 ├─ [0..15]  = IV         (16 bytes)
 └─ [16..399] = ciphertext (384 bytes)

         │
         ▼
STEP 4 — AES Decrypt

[384 bytes ciphertext]
         │
         │  crypto.createDecipheriv('aes-128-cbc', sessionKey, iv)
         │  decipher.update(ciphertext) + decipher.final()
         ▼
[raw bytes of JSON]

         │
         │  .toString('utf8')  →  JSON string
         │  JSON.parse()       →  JavaScript object
         ▼
{
  Amount: "10000.00",
  UTR: "ICIC52011986928310711",
  VirtualAccountNumber: "TEL9834191192",
  PayerName: "...",
  ...
}
```

---

## 10. Decryption Code — Line by Line

```javascript
// src/utils/iciciCrypto.js
async function decryptIciciPayload(body) {
```
`body` = the raw JSON object ICICI sent in the HTTP POST request.  
`async` = this function can wait for things (though crypto operations here are actually synchronous).

---

```javascript
  const privateKeyPem = process.env.ICICI_PRIVATE_KEY;
  if (!privateKeyPem) throw new Error('ICICI_PRIVATE_KEY env var is not set');
```
Our RSA private key lives in the `.env` file as `ICICI_PRIVATE_KEY`.  
PEM = a text format for keys. Looks like:
```
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASC...
-----END PRIVATE KEY-----
```
If it's missing → crash immediately with a clear message. Silent failures are worse than loud failures.

---

```javascript
  const oaep = (body.oaepHashingAlgorithm || 'NONE').toUpperCase();
  const rsaPadding = oaep === 'SHA1'
    ? crypto.constants.RSA_PKCS1_OAEP_PADDING
    : crypto.constants.RSA_PKCS1_PADDING;
```
ICICI tells us which RSA padding mode they used:
- `"NONE"` → use PKCS1 mode
- `"SHA1"` → use OAEP mode

We pick the matching mode. Using wrong mode = decryption fails even with the right key.  
`|| 'NONE'` = default to NONE if field is missing.  
`? :` = shorthand if/else (ternary operator).

---

```javascript
  const encryptedKeyBuf = Buffer.from(body.encryptedKey || '', 'base64');
  const encryptedDataBuf = Buffer.from(body.encryptedData || '', 'base64');
```
Convert Base64 text → raw bytes.

```
body.encryptedKey = "pKY7abA+qRizRd..."  (text, 684 chars)
      ↓  Buffer.from(..., 'base64')
encryptedKeyBuf   = <Buffer a9 2b 7a 1b...> (raw bytes, 512 bytes)
```

`Buffer` = Node.js's container for raw bytes.  
`|| ''` = use empty string if field is missing (so Buffer.from doesn't crash).

---

```javascript
  const privKeyObj = crypto.createPrivateKey(privateKeyPem);
  const modulusBytes = (privKeyObj.asymmetricKeyDetails?.modulusLength ?? 0) / 8;
```
Load our private key into Node.js's crypto engine and read its size.

```
4096-bit RSA key
  modulusLength = 4096  (in bits)
  modulusBytes  = 4096 / 8 = 512  (in bytes)
```

`?.` = optional chaining — if `asymmetricKeyDetails` is null/undefined, don't crash, return undefined.  
`?? 0` = if the result is null/undefined, use 0 instead.

---

```javascript
  logger.info(
    `[IciciCrypto] incoming: oaepHashingAlgorithm=${oaep} | ` +
    `RSA key=${modulusBytes * 8}-bit (${modulusBytes}B modulus) | ` +
    `encryptedKey=${encryptedKeyBuf.length}B | encryptedData=${encryptedDataBuf.length}B | ` +
    `iv field="${body.iv || ''}"`
  );
```
Log everything before touching crypto. This is how we diagnose problems without exposing secret data. We log sizes and modes — NOT the actual key bytes.

This produced the diagnostic output we used to find the current bug:
```
RSA key=4096-bit | encryptedKey=512B | encryptedData=400B
```

---

```javascript
  if (encryptedKeyBuf.length === 0) {
    throw new Error('encryptedKey field is missing or empty');
  }
  if (encryptedKeyBuf.length > modulusBytes) {
    throw new Error(
      `encryptedKey size (${encryptedKeyBuf.length}B) exceeds RSA key modulus (${modulusBytes}B)...`
    );
  }
```
Two safety checks before attempting RSA decrypt:

1. If `encryptedKey` is empty → ICICI sent malformed request
2. If `encryptedKey` is bigger than our RSA key can handle → key mismatch  
   (4096-bit RSA produces exactly 512 bytes. If we get 513+ bytes, something is wrong.)

---

```javascript
  const sessionKey = crypto.privateDecrypt(
    { key: privateKeyPem, padding: rsaPadding },
    encryptedKeyBuf
  );
```
**The RSA unlock.** This is the most important line.

```
encryptedKeyBuf (512 bytes, locked with our padlock)
      +
our privateKeyPem (the master key)
      +
rsaPadding (must match what ICICI used)
      ↓
sessionKey (should be 16 or 32 bytes — the AES combination)
```

---

```javascript
  logger.info(
    `[IciciCrypto] RSA decrypt OK — sessionKey=${sessionKey.length}B (${sessionKey.length * 8}-bit AES key)`
  );
```
Log the result size. This is where we caught the bug:
```
sessionKey=88B (704-bit AES key)   ← 88 bytes is wrong, should be 16 or 32
```

---

```javascript
  let iv;
  let ciphertext;

  if (body.iv && body.iv.length > 0) {
    iv = Buffer.from(body.iv, 'base64');
    ciphertext = encryptedDataBuf;
  } else {
    iv = encryptedDataBuf.subarray(0, 16);
    ciphertext = encryptedDataBuf.subarray(16);
  }
```
Extract the IV — it can come in two places:

```
If body.iv exists:
  iv        = decode body.iv from Base64
  ciphertext = all of encryptedData

If body.iv is empty (ICICI's default):
  [encryptedDataBuf decoded bytes] = [IV][ciphertext]
                                      ↑        ↑
                                   [0..15]  [16..end]

  iv         = first 16 bytes
  ciphertext = everything after byte 16
```

`subarray(0, 16)` = bytes from index 0 up to (not including) 16 = 16 bytes  
`subarray(16)` = bytes from index 16 to end = everything after IV

---

```javascript
  if (iv.length !== 16) {
    throw new Error(`IV must be exactly 16 bytes for AES-CBC, got ${iv.length}B.`);
  }
```
AES block size is always 16 bytes. IV must match block size exactly. If it doesn't → crash with explanation.

---

```javascript
  const aesAlgoMap = { 16: 'aes-128-cbc', 32: 'aes-256-cbc' };
  const algo = aesAlgoMap[sessionKey.length];
  if (!algo) {
    throw new Error(
      `Unexpected AES session key length: ${sessionKey.length}B. ` +
      `Expected 16B (AES-128) or 32B (AES-256).`
    );
  }
```
Map session key size to the AES algorithm name:

```
16 bytes → 'aes-128-cbc'   (AES 128-bit in CBC mode)
32 bytes → 'aes-256-cbc'   (AES 256-bit in CBC mode)
anything else → throw error with clear message

Current bug:
88 bytes → undefined → throws "Unexpected AES session key length: 88B"
```

---

```javascript
  const decipher = crypto.createDecipheriv(algo, sessionKey, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
```
**The AES unlock.**

```
crypto.createDecipheriv(
  'aes-128-cbc',   ← which algorithm
  sessionKey,      ← the combination (16 bytes)
  iv               ← the salt (16 bytes)
)
```

`decipher.update(ciphertext)` = decrypt all but the last block  
`decipher.final()` = decrypt the last block (handles PKCS5 padding removal)  
`Buffer.concat([...])` = join both results into one buffer

Why two calls? AES processes data in chunks. `.update()` handles full chunks, `.final()` handles the last padded chunk and strips the padding.

---

```javascript
  logger.info(`[IciciCrypto] AES decrypt OK — plaintext=${decrypted.length}B`);
  return JSON.parse(decrypted.toString('utf8'));
```
Convert the decrypted bytes to a JavaScript object:

```
decrypted                 = <Buffer 7b 22 43 6c...>  (raw bytes)
decrypted.toString('utf8') = '{"ClientCode":"ABC","Amount":"10000",...}'  (string)
JSON.parse(...)            = { ClientCode: 'ABC', Amount: '10000', ... }  (object)
```

---

## 11. Encryption Code — Line by Line

We use this when **we send our response back to ICICI** (accept/reject decision).

```javascript
function encryptIciciResponse(payload, requestId = '', service = '') {
```
`payload` = our response object, e.g. `{ AcceptOrReject: 'Y', Message: 'Accept', Code: '11' }`  
`requestId` = ICICI's request ID (we echo it back)  
`service` = service name (we echo it back)

---

```javascript
  const iciciCert = process.env.ICICI_PUBLIC_CERT;
  if (!iciciCert) throw new Error('ICICI_PUBLIC_CERT env var is not set');
```
ICICI's public certificate — this is ICICI's padlock. We use it to lock things only ICICI can open.

Note the difference:
```
ICICI_PRIVATE_KEY  = OUR private key  → we use to decrypt what ICICI sends us
ICICI_PUBLIC_CERT  = ICICI's public cert → we use to encrypt what we send to ICICI
```

---

```javascript
  const sessionKey = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);
```
Generate fresh random bytes for this response:

```
sessionKey = 16 completely random bytes  (our one-time AES password)
iv         = 16 completely random bytes  (our one-time salt)
```

`crypto.randomBytes(16)` = cryptographically secure random bytes (NOT Math.random() which is predictable).

---

```javascript
  const cipher = crypto.createCipheriv('aes-128-cbc', sessionKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
```
AES-encrypt our response:

```
JSON.stringify(payload) = '{"AcceptOrReject":"Y","Message":"Accept","Code":"11"}'
      ↓  cipher.update() + cipher.final()
encrypted = [scrambled bytes]
```

`cipher.update(data, 'utf8')` = encrypt the string (converting it to bytes with UTF-8 first)  
`cipher.final()` = encrypt + add PKCS5 padding to last block

---

```javascript
  const encryptedKey = crypto.publicEncrypt(
    { key: iciciCert, padding: crypto.constants.RSA_PKCS1_PADDING },
    sessionKey
  );
```
RSA-lock our session key with ICICI's padlock:

```
sessionKey (16 bytes, our one-time AES password)
      ↓  RSA encrypt with ICICI's public cert
encryptedKey (512 bytes, only ICICI can unlock with their private key)
```

`crypto.publicEncrypt` = encrypt using a PUBLIC key (to lock)  
`crypto.privateDecrypt` = decrypt using a PRIVATE key (to unlock)

---

```javascript
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
```
Build the response JSON that ICICI expects.

Note: For our responses, we send IV in the `iv` field (Way 1) rather than prepending it to encryptedData. Both are valid — ICICI's PDF documents both approaches.

Everything is Base64-encoded before sending (raw bytes → safe text for JSON).

---

## 12. Glossary of Every Term

| Term | Full Form | Plain English |
|------|-----------|---------------|
| **RSA** | Rivest–Shamir–Adleman | Padlock system. Encrypt with public key, decrypt with private key |
| **AES** | Advanced Encryption Standard | Fast scrambler. Same key to lock and unlock |
| **AES-128** | — | AES with 16-byte (128-bit) key |
| **AES-256** | — | AES with 32-byte (256-bit) key |
| **CBC** | Cipher Block Chaining | AES mode where each block depends on the previous |
| **IV** | Initialization Vector | Random 16-byte salt to make every encryption unique |
| **Session Key** | — | One-time random AES key generated per transaction |
| **Hybrid Encryption** | — | RSA protects the AES key, AES protects the data |
| **Public Key** | — | The padlock. Share with anyone. Used to lock/encrypt |
| **Private Key** | — | The master key. Keep secret. Used to unlock/decrypt |
| **Certificate (.cer/.pem)** | — | Public key in a standardized format with metadata |
| **PEM** | Privacy Enhanced Mail | Text format for keys (`-----BEGIN...-----`) |
| **Base64** | — | Converts binary bytes to safe text (A-Z, a-z, 0-9, +, /) |
| **Buffer** | — | Node.js container for raw bytes |
| **PKCS1** | Public Key Cryptography Standard #1 | Older RSA padding. ICICI uses this (`oaepHashingAlgorithm: "NONE"`) |
| **OAEP** | Optimal Asymmetric Encryption Padding | Newer, safer RSA padding (`oaepHashingAlgorithm: "SHA1"`) |
| **SHA-256** | Secure Hash Algorithm 256-bit | One-way fingerprint function. Same input → always same 64-char output |
| **Modulus** | — | The large number that defines an RSA key's strength |
| **4096-bit** | — | RSA key size. 4096 binary digits = very strong |
| **512B** | — | 512 bytes = 4096 bits = size of RSA-4096 output |
| **16B** | — | 16 bytes = 128 bits = AES-128 session key size |
| **32B** | — | 32 bytes = 256 bits = AES-256 session key size |
| **ciphertext** | — | The scrambled (encrypted) data |
| **plaintext** | — | The original readable data |
| **UTR** | Unique Transaction Reference | Bank's unique ID for each transaction |
| **MSG HOLD** | Message Hold | ICICI's API to ask us: accept or reject this payment? |
| **MIS POSTING** | Management Information System Posting | ICICI's API confirming a payment went through |
| **VAN** | Virtual Account Number | A virtual bank account number we create for each customer |

---

## 13. Current Bug and Status

### What's happening

```
Expected flow:
  ICICI RSA-encrypts 16 bytes (AES session key)
  We RSA-decrypt → get 16 bytes → valid AES-128 key ✓

Actual flow:
  ICICI RSA-encrypts ??? bytes
  We RSA-decrypt → get 88 bytes one time, 288 bytes another time ✗
  Neither 88 nor 288 is a valid AES key size
  Decryption fails
  We respond with Reject
  Payer's money is refunded
```

### What we verified

```
✓ Our ICICI_PRIVATE_KEY in .env is correct
✓ Our /tmp/cnk_cert.pem (submitted to ICICI) matches the private key
✓ RSA decryption itself works (no error thrown)
✓ IV extraction works (16 bytes)
✗ Session key size is 88 or 288 bytes — not 16 or 32
```

Key fingerprint (all three should match and do):
```
SHA2-256 = 2b2190d5f586a6032a04454cc57ca964917e5061c2fb0bf7b86af08d6e3296d4
```

### Why the varying size (88 vs 288) matters

If the RSA private key didn't match the public cert ICICI used → Node.js (OpenSSL 3.x) would silently return random synthetic bytes of unpredictable length rather than throwing an error (this is called "implicit rejection" — a security feature to prevent timing attacks).

The **changing sizes** (88 one request, 288 another) suggest ICICI may be using a different public certificate for our account in their system than the one we submitted. Or ICICI's implementation is generating session keys of inconsistent/wrong sizes.

### ICICI's own PDF says (page 11 and page 13)

> "Requirement is for a **128-bit key** (with 256-bit key supported as an option)"  
> "SessionKey = Randomly generated **string of length 16 (OR 32)**"

Their actual implementation contradicts their own specification.

### Status

Waiting for ICICI to respond to our support email with clarification on:
1. What format/encoding they use for the session key before RSA-encrypting
2. Which AES key size they're using (128-bit or 256-bit)
3. Whether they have the correct public certificate registered for our ClientCode

### Files involved

```
src/utils/iciciCrypto.js      ← crypto logic (this document explains it)
src/controllers/iciciController.js  ← calls decryptIciciPayload, handles business logic
.env                          ← ICICI_PRIVATE_KEY and ICICI_PUBLIC_CERT live here
/tmp/cnk_cert.pem             ← our public certificate (what we submitted to ICICI)
/tmp/cnk_private.pem          ← our private key (backup copy)
```
