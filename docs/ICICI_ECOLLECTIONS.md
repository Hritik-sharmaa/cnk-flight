# ICICI eCollections — Complete Guide

## Table of Contents
1. [What is eCollections?](#1-what-is-ecollections)
2. [The Big Picture Flow](#2-the-big-picture-flow)
3. [MSG HOLD — Accept or Reject](#3-msg-hold--accept-or-reject)
4. [MIS POSTING — Final Credit Confirmation](#4-mis-posting--final-credit-confirmation)
5. [Deemed Accept / Deemed Reject](#5-deemed-accept--deemed-reject)
6. [Duplicate UTR Handling](#6-duplicate-utr-handling)
7. [Encryption & Decryption — Full Breakdown](#7-encryption--decryption--full-breakdown)
8. [Keys — Who Holds What](#8-keys--who-holds-what)
9. [Database Tables](#9-database-tables)
10. [Code Walkthrough — iciciController.js](#10-code-walkthrough--icicicontrollerjs)
11. [Code Walkthrough — iciciCrypto.js](#11-code-walkthrough--icicCryptoojs)
12. [Environment Variables](#12-environment-variables)
13. [What Still Needs to Come From ICICI](#13-what-still-needs-to-come-from-icici)

---

## 1. What is eCollections?

eCollections is an ICICI Bank product that lets companies (like Cox & Kings) collect payments using **Virtual Account Numbers (VAN)**.

Instead of giving a customer your real bank account number, you give them a unique Virtual Account Number. When they pay to that VAN (via NEFT, RTGS, UPI, IMPS, or FT), ICICI:
1. Asks us first — "Should I accept this money?" (**MSG HOLD**)
2. If accepted, credits our account
3. Then tells us — "Money has been credited" (**MIS POSTING**)

The entire request/response between ICICI and our server is **encrypted**. Plain text is never sent.

---

## 2. The Big Picture Flow

```
Customer/Payer
    |
    | pays ₹10,000 to VAN "CNK100000001"
    ↓
ICICI Bank
    |
    | POST /api/v1/icici/msg-hold  ← encrypted body
    ↓
Our Server (flights.coxandkings.com)
    |
    | decrypts, checks VAN in DB, decides Y or N
    | returns encrypted { AcceptOrReject: "Y", Code: "11" }
    ↓
ICICI Bank
    |
    | Credits ₹10,000 to CNK's actual bank account
    |
    | POST /api/v1/icici/mis-posting  ← encrypted body
    ↓
Our Server
    |
    | decrypts, marks booking as PAID, updates DB
    | returns encrypted { Response: "Success", Code: "11" }
    ↓
ICICI Bank
    |
    Done
```

**Key rule**: ICICI calls US. We never call ICICI for these two APIs. They push data to us.

---

## 3. MSG HOLD — Accept or Reject

**ICICI asks us: "Should I credit this money?"**

ICICI sends us all details about the incoming payment — who paid, how much, from which account, via which mode. We validate and respond YES or NO.

### Request (what ICICI sends us)

| Field | Meaning |
|---|---|
| `ClientCode` | Our client code at ICICI (`CNK1`) |
| `VirtualAccountNumber` | The VAN the customer paid to (e.g. `CNK100000001`) |
| `Mode` | How they paid — UPI, IMPS, NEFT, RTGS, FT |
| `USERID` | User ID under our corporate account in ICICI's CIB portal |
| `UTR` | Unique Transaction Reference — like a receipt number for this payment |
| `SenderRemark` | Any note the sender added |
| `ClientAccountNo` | Our account number at ICICI |
| `Amount` | How much was paid |
| `PayerName` | Who paid |
| `PayerAccNumber` | Their bank account number |
| `PayerBankIFSC` | Their bank's IFSC code |
| `PayerPaymentDate` | When they initiated the payment |
| `BankInternalTransactionNumber` | ICICI's internal tracking number |

### Response (what we send back)

| Response | Meaning | JSON |
|---|---|---|
| **Accept** | Credit the money to CNK's account | `{ "AcceptOrReject": "Y", "Message": "Accept", "Code": "11" }` |
| **Reject** | Refund the payer | `{ "AcceptOrReject": "N", "Message": "Reject", "Code": "12" }` |

### Our accept/reject logic

```
VAN not found in our DB          → Reject (Unknown VAN)
VAN status is not "active"       → Reject (already paid / expired)
VAN has expired (expires_at)     → Reject (VAN expired)
Amount doesn't match expected    → Reject (Amount mismatch, tolerance ±₹1)
Everything OK                    → Accept
```

### Time limits — this is critical

ICICI waits for our response. If we don't reply in time, **Deemed Accept** kicks in (see section 5).

| Mode | Time limit |
|---|---|
| UPI | 5 seconds |
| IMPS | 5 seconds |
| NEFT | 10 seconds |
| RTGS | 10 seconds |
| FT | 15 seconds |

---

## 4. MIS POSTING — Final Credit Confirmation

**ICICI tells us: "Money has been credited to your account."**

This is the final confirmation. This fires ONLY for payments that were accepted (or Deemed Accepted). ICICI credits their own account first, then calls this API.

### Request (same fields as MSG HOLD)

Same payload structure as MSG HOLD.

### Response (what we send back)

| Scenario | JSON |
|---|---|
| First time seeing this UTR | `{ "Response": "Success", "Code": "11" }` |
| Already processed (duplicate) | `{ "Response": "Duplicate UTR", "Code": "06" }` |

### What we do when MIS POSTING arrives

1. Check if we've already processed this UTR (duplicate check)
2. Save the transaction to `icici_ecollection_transactions`
3. Mark the Virtual Account as `paid`
4. Update downstream records:
   - If linked to a booking → `bookings.payment_status = 'paid'`, `booking_status = 'confirmed'`
   - If linked to a payment order → `payment_orders.status = 'success'`
   - If linked to a payment link → `generic_payment_links.status = 'paid'`
5. Return Success

---

## 5. Deemed Accept / Deemed Reject

### What is it?

When ICICI sends a MSG HOLD request and our server **doesn't respond in time** (timeout, server down, etc.), ICICI can't just leave money hanging. So before going live, ICICI asks you to choose a default behavior:

- **Deemed Accept** — ICICI credits the money automatically, as if we said YES
- **Deemed Reject** — ICICI refunds the payer automatically, as if we said NO

**We configured: Deemed Accept** — so if our server is slow or down, ICICI still credits the money.

### What happens in code when Deemed Accept fires?

MSG HOLD is skipped entirely. ICICI just credits the money and calls **MIS POSTING** directly.

When MIS POSTING arrives for a UTR that never had a MSG HOLD:
- `existingTxn` will be `null` (no row in `icici_ecollection_transactions`)
- Our code handles this specifically:

```js
// misPosting handler, line ~200
let vanId = existingTxn ? undefined : null;
if (!existingTxn) {
  // MSG HOLD never ran — look up the VAN directly
  const { data: vaRow } = await supabase
    .from('virtual_accounts')
    .select('id')
    .eq('van', VirtualAccountNumber)
    .maybeSingle();
  vanId = vaRow?.id ?? null;
}

// upsert creates a fresh row since UTR doesn't exist yet
await supabase.from('icici_ecollection_transactions').upsert(
  { ..., mis_posted_at: now, payment_status: 'credited' },
  { onConflict: 'utr' }
)
```

The `upsert` with `onConflict: 'utr'` means:
- If row exists (MSG HOLD ran) → update it with MIS data
- If row doesn't exist (Deemed Accept, MSG HOLD skipped) → create it fresh

---

## 6. Duplicate UTR Handling

**UTR** (Unique Transaction Reference) is like a serial number for each payment. Every payment has exactly one UTR — ICICI guarantees this.

ICICI can retry calling our MIS POSTING API if they don't get a response (network issues, etc.). If we process the same UTR twice, we'd double-confirm a payment and potentially double-credit a booking.

### How we prevent it

**Layer 1 — Application check:**
```js
// misPosting handler
const { data: existingTxn } = await supabase
  .from('icici_ecollection_transactions')
  .select('id, payment_status, mis_posted_at')
  .eq('utr', UTR)
  .maybeSingle();

if (existingTxn?.mis_posted_at) {
  // Already processed — return duplicate response immediately
  return res.status(200).json(encryptIciciResponse({
    Response: 'Duplicate UTR',
    Code: '06'
  }));
}
```

**Layer 2 — Database constraint (hard stop):**
```sql
utr TEXT NOT NULL UNIQUE
```
The `UNIQUE` constraint on the `utr` column means even if two concurrent requests somehow passed the application check at the same millisecond, the database will reject the second insert with a constraint violation. The `upsert` with `onConflict: 'utr'` handles this gracefully by updating instead of inserting.

---

## 7. Encryption & Decryption — Full Breakdown

This is the most complex part. ICICI uses **Hybrid Encryption** — a combination of RSA and AES.

### Why Hybrid? Why not just RSA?

- **RSA** (asymmetric) is very secure but **slow** and can only encrypt small data (limited by key size)
- **AES** (symmetric) is very fast and can encrypt any size data, but both sides need the same key — how do you securely share the key?
- **Solution (Hybrid)**: Use AES to encrypt the actual data (fast), then use RSA to encrypt the AES key (secure key sharing)

### The Two Keys Involved

```
Our RSA Key Pair (4096-bit):
  ┌─────────────────────┐     ┌──────────────────────┐
  │  ICICI_PRIVATE_KEY  │     │  Our Certificate      │
  │  (stays on server)  │     │  (sent to ICICI)      │
  │  -----BEGIN         │     │  -----BEGIN           │
  │  PRIVATE KEY-----   │     │  CERTIFICATE-----     │
  └─────────────────────┘     └──────────────────────┘
          ↑                              ↑
  We use this to DECRYPT          ICICI uses this to
  what ICICI sends us             ENCRYPT what they send us

ICICI's Certificate (4096-bit):
  ┌─────────────────────┐
  │  ICICI_PUBLIC_CERT  │
  │  (in our .env)      │
  │  -----BEGIN         │
  │  PUBLIC KEY-----    │
  └─────────────────────┘
          ↑
  We use this to ENCRYPT our responses to ICICI
  ICICI uses their private key to decrypt
```

---

### Part A — Decrypting ICICI's Request (incoming to us)

When ICICI hits our MSG HOLD or MIS POSTING, the body looks like:

```json
{
  "requestId": "",
  "service": "",
  "encryptedKey": "pKY7abA+qRizRdYd....(very long base64 string)",
  "oaepHashingAlgorithm": "NONE",
  "iv": "",
  "encryptedData": "mtlktFRBPPs6SVxh....(another long base64 string)",
  "clientInfo": "",
  "optionalParam": ""
}
```

The actual payment details (VAN, amount, payer name, etc.) are hidden inside `encryptedData`. To read them, we need to decrypt in 2 steps:

#### Step 1 — Decrypt the session key using our RSA Private Key

```
encryptedKey (base64 string)
      ↓  base64 decode
  encrypted bytes
      ↓  RSA decrypt using ICICI_PRIVATE_KEY (RSA/ECB/PKCS1 padding)
  sessionKey (16 or 32 raw bytes)
```

The `sessionKey` is a randomly generated AES key that ICICI created just for this one request. ICICI encrypted it with **our public certificate** (which we sent to them). Only our private key can decrypt it.

```js
// iciciCrypto.js
const encryptedKeyBuf = Buffer.from(body.encryptedKey, 'base64');
const sessionKey = crypto.privateDecrypt(
  { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
  encryptedKeyBuf
);
// sessionKey is now the raw AES key bytes
```

#### Step 2 — Extract IV from encryptedData

The IV (Initialization Vector) is a 16-byte random value needed for AES-CBC decryption. ICICI always embeds the IV as the **first 16 bytes** of `encryptedData` (their `"iv"` field is always empty `""`).

```
encryptedData (base64 string)
      ↓  base64 decode → raw bytes
  [  IV (bytes 0–15)  |  ciphertext (bytes 16 onwards)  ]
```

```js
const encryptedDataBuf = Buffer.from(body.encryptedData, 'base64');

if (body.iv && body.iv.length > 0) {
  // IV sent separately (edge case)
  iv = Buffer.from(body.iv, 'base64');
  ciphertext = encryptedDataBuf;
} else {
  // IV is first 16 bytes (normal case for ICICI's requests to us)
  iv = encryptedDataBuf.subarray(0, 16);
  ciphertext = encryptedDataBuf.subarray(16);
}
```

#### Step 3 — Decrypt the actual payload with AES

```
ciphertext + sessionKey + IV
      ↓  AES-128-CBC decrypt (or AES-256 if sessionKey is 32 bytes)
  JSON string
      ↓  JSON.parse
  { VirtualAccountNumber, Amount, UTR, PayerName, ... }
```

```js
const algo = sessionKey.length === 32 ? 'aes-256-cbc' : 'aes-128-cbc';
const decipher = crypto.createDecipheriv(algo, sessionKey, iv);
const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
return JSON.parse(decrypted.toString('utf8'));
```

#### Visual summary of decryption

```
ICICI sends:
┌─────────────────────────────────────────────────────────┐
│  encryptedKey: "pKY7abA+..."  (base64)                  │
│  encryptedData: "mtlkt..."    (base64)                  │
│  iv: ""                       (empty — IV is in data)   │
└─────────────────────────────────────────────────────────┘
                    ↓
Step 1: Decrypt encryptedKey with our PRIVATE KEY
┌─────────────────────────────────────────────────────────┐
│  sessionKey = RSA_DECRYPT(encryptedKey, PRIVATE_KEY)    │
│  → raw bytes: [a4 3f 9c 12 ...] (16 bytes)             │
└─────────────────────────────────────────────────────────┘
                    ↓
Step 2: Split encryptedData
┌─────────────────────────────────────────────────────────┐
│  decoded = base64_decode(encryptedData)                 │
│  iv         = decoded[0:16]   ← first 16 bytes          │
│  ciphertext = decoded[16:]    ← rest                    │
└─────────────────────────────────────────────────────────┘
                    ↓
Step 3: AES-CBC Decrypt
┌─────────────────────────────────────────────────────────┐
│  plaintext = AES_DECRYPT(ciphertext, sessionKey, iv)    │
│  → '{"VirtualAccountNumber":"CNK100000001","Amount":    │
│      "10000.00","UTR":"ICIC52011...",...}'               │
└─────────────────────────────────────────────────────────┘
                    ↓
         JSON.parse → usable object
```

---

### Part B — Encrypting Our Response (outgoing from us)

After we decide Accept/Reject or Success, we encrypt the response back to ICICI using **ICICI's public key** (stored in `ICICI_PUBLIC_CERT` in our `.env`).

Same hybrid approach — but reversed:

#### Step 1 — Generate a new random session key and IV

```js
const sessionKey = crypto.randomBytes(16);  // fresh 16-byte AES key
const iv = crypto.randomBytes(16);          // fresh 16-byte IV
```

Every response uses a **new** random session key. One-time use only.

#### Step 2 — Encrypt the response JSON with AES

```js
const cipher = crypto.createCipheriv('aes-128-cbc', sessionKey, iv);
const encrypted = Buffer.concat([
  cipher.update(JSON.stringify(payload), 'utf8'),
  cipher.final(),
]);
// encrypted = ciphertext bytes
```

The `payload` is something like `{ AcceptOrReject: 'Y', Message: 'Accept', Code: '11' }`.

#### Step 3 — Encrypt the session key with ICICI's public key

```js
const encryptedKey = crypto.publicEncrypt(
  { key: iciciCert, padding: crypto.constants.RSA_PKCS1_PADDING },
  sessionKey
);
```

Only ICICI's private key (which they keep secret) can decrypt this `encryptedKey`.

#### Step 4 — Build the response JSON

```js
return {
  requestId: '',
  service: '',
  encryptedKey: encryptedKey.toString('base64'),
  oaepHashingAlgorithm: 'NONE',
  iv: iv.toString('base64'),      // we send IV separately (recommended approach)
  encryptedData: encrypted.toString('base64'),
  clientInfo: '',
  optionalParam: '',
};
```

Note: We send the `iv` separately in the `"iv"` field (not embedded in `encryptedData`). This is the **recommended approach** per ICICI's doc. ICICI knows to use this IV when decrypting.

#### Visual summary of encryption

```
We want to send: { AcceptOrReject: "Y", Message: "Accept", Code: "11" }

Step 1: Generate fresh random values
┌───────────────────────────────────────────┐
│  sessionKey = random 16 bytes             │
│  iv         = random 16 bytes             │
└───────────────────────────────────────────┘
                    ↓
Step 2: Encrypt response with AES
┌───────────────────────────────────────────┐
│  encryptedData = AES_ENCRYPT(             │
│    '{"AcceptOrReject":"Y",...}',           │
│    sessionKey, iv                         │
│  ) → base64                               │
└───────────────────────────────────────────┘
                    ↓
Step 3: Encrypt sessionKey with ICICI's public key
┌───────────────────────────────────────────┐
│  encryptedKey = RSA_ENCRYPT(              │
│    sessionKey,                            │
│    ICICI_PUBLIC_CERT                      │
│  ) → base64                               │
└───────────────────────────────────────────┘
                    ↓
Step 4: Return full response
┌───────────────────────────────────────────┐
│  {                                        │
│    encryptedKey: "...",                   │
│    iv: "...",                             │
│    encryptedData: "...",                  │
│    oaepHashingAlgorithm: "NONE",          │
│    requestId: "", service: "",            │
│    clientInfo: "", optionalParam: ""      │
│  }                                        │
└───────────────────────────────────────────┘
                    ↓
         ICICI decrypts using their private key
```

---

### Why AES needs an IV (Initialization Vector)

AES in CBC mode links each encrypted block to the previous one — but the very first block has no previous block, so we provide a random "fake previous block" called the IV.

If you encrypt the same data twice with the same key but different IVs, you get completely different ciphertext. This prevents pattern analysis attacks.

**16 bytes = 128 bits = one AES block size.** Always random, never reused.

---

## 8. Keys — Who Holds What

```
                    OUR SIDE                    ICICI's SIDE
                ┌─────────────┐              ┌─────────────┐
Our Private Key │ server .env │              │             │ — ICICI never sees this
                └─────────────┘              └─────────────┘

Our Certificate │  sent to ICICI  ──────────→│ ICICI holds │ — used to encrypt their requests to us
                └─────────────┘              └─────────────┘

ICICI Public Key│ our .env        ←──────────│ ICICI sent  │ — used to encrypt our responses to them
                └─────────────┘              └─────────────┘

ICICI Private Key│             │              │ ICICI holds │ — used to decrypt our encrypted responses
                 └─────────────┘              └─────────────┘
```

**Rule**: A public key encrypts. The matching private key decrypts. You can share the public key freely — it's useless for decryption.

---

## 9. Database Tables

### `virtual_accounts`
One row per VAN we create. Links a VAN to a booking/payment.

| Column | Purpose |
|---|---|
| `van` | The virtual account number (e.g. `CNK100000001`) |
| `status` | `active` / `expired` / `paid` |
| `expected_amount` | If set, we reject payments that don't match (±₹1 tolerance) |
| `expires_at` | After this timestamp, VAN is expired and we reject |
| `booking_id` | Links to a flight booking |
| `payment_order_id` | Links to a payment order |
| `generic_payment_link_id` | Links to a payment link |

### `icici_ecollection_transactions`
One row per payment (per UTR). Created/updated by both MSG HOLD and MIS POSTING.

| Column | Purpose |
|---|---|
| `utr` | Unique, prevents duplicate processing |
| `msg_hold_decision` | `Y` or `N` — what we responded at MSG HOLD |
| `msg_hold_at` | When MSG HOLD arrived |
| `mis_posted_at` | When MIS POSTING arrived (null = not yet credited) |
| `payment_status` | `accepted` → `credited` (or `rejected`) |
| `userid` | ICICI's CIB user ID sent in the request |

### `icici_request_logs`
Logs every raw encrypted request ICICI sends us. Useful for debugging — if something fails you can see the raw body.

---

## 10. Code Walkthrough — iciciController.js

### msgHold function

```
1. Record start time (to measure response speed — must be under 5-10s)
2. Extract client IP
3. IP whitelist check (if ICICI_WHITELISTED_IPS is set in .env)
4. Fire-and-forget: save raw encrypted body to icici_request_logs
5. Decrypt the payload → get VAN, UTR, Amount, Mode, etc.
6. Validate required fields
7. Look up the VAN in virtual_accounts table
8. Decision logic:
   - VAN not found → Reject
   - VAN not active → Reject
   - VAN expired → Reject (also mark as expired in DB)
   - Amount mismatch → Reject
   - All OK → Accept
9. Save to icici_ecollection_transactions (upsert on UTR)
10. Encrypt and return the response
```

### misPosting function

```
1. Extract IP
2. IP whitelist check
3. Fire-and-forget: save raw encrypted body to icici_request_logs
4. Decrypt the payload
5. Validate required fields
6. DUPLICATE CHECK: if this UTR's mis_posted_at is already set → return "Duplicate UTR"
7. Check if MSG HOLD row exists (if not → Deemed Accept scenario)
8. If no existing row → look up VAN to get virtual_account_id
9. Upsert to icici_ecollection_transactions
10. Mark virtual_account as paid
11. confirmDownstreamRecords → update bookings/payment_orders/generic_payment_links
12. Mark mis_acknowledged_at
13. Return "Success"
```

### confirmDownstreamRecords function

Runs all downstream updates in parallel:
```js
await Promise.all([
  update bookings (payment_status=paid, booking_status=confirmed),
  update payment_orders (status=success),
  update generic_payment_links (status=paid),
])
```
Only updates tables that have a linked ID — if `booking_id` is null, that update is skipped.

---

## 11. Code Walkthrough — iciciCrypto.js

### `decryptIciciPayload(body)`

Takes the raw request body (encrypted JSON from ICICI) and returns a plain JavaScript object.

```
body.encryptedKey  →  RSA decrypt with our private key  →  sessionKey
body.encryptedData →  base64 decode  →  [IV (0-15)] + [ciphertext (16+)]
ciphertext + sessionKey + IV  →  AES-CBC decrypt  →  JSON string  →  object
```

### `encryptIciciResponse(payload)`

Takes a plain JavaScript object and returns an encrypted JSON structure for ICICI.

```
Random sessionKey (16 bytes)
Random IV (16 bytes)
payload (object)  →  JSON.stringify  →  AES-CBC encrypt with sessionKey+IV  →  encryptedData (base64)
sessionKey  →  RSA encrypt with ICICI's public key  →  encryptedKey (base64)
Return { encryptedKey, iv, encryptedData, oaepHashingAlgorithm: "NONE", ... }
```

---

## 12. Environment Variables

| Variable | What it is | Where it comes from |
|---|---|---|
| `ICICI_PRIVATE_KEY` | Our 4096-bit RSA private key | Generated by us with `openssl genpkey` |
| `ICICI_PUBLIC_CERT` | ICICI's public key/certificate | ICICI shared via email |
| `ICICI_CLIENT_CODE` | Our client code at ICICI | ICICI assigned (`CNK1`) |
| `ICICI_WHITELISTED_IPS` | ICICI's server IPs | ICICI shares this — currently blank (pending) |

---

## 13. What Still Needs to Come From ICICI

| Item | Status | What happens without it |
|---|---|---|
| ICICI's server IPs | **Pending** | `ICICI_WHITELISTED_IPS` is empty so all IPs allowed (safe for UAT, enable before prod) |
| Production ICICI certificate | **Pending** | Currently using the cert from their test logs. When they share the prod cert, update `ICICI_PUBLIC_CERT` in `.env` |
| Confirmation of Deemed Accept | **Pending** | We assumed Deemed Accept is configured — need written confirmation |
| UAT sign-off from ICICI | **Pending** | They test all scenarios, we go live after |
