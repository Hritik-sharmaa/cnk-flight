const logger = require('../utils/logger');
const supabase = require('../db/supabase');
// TODO: ICICI APPROVAL — uncomment these when real keys are received and stub handlers below are removed
// const { decryptIciciPayload, encryptIciciResponse } = require('../utils/iciciCrypto');

/**
 * ICICI eCollections — MSG HOLD
 *
 * ICICI Bank calls this synchronously when a payer initiates a transfer
 * to one of our virtual account numbers. Must respond within:
 *   UPI/IMPS: 5s  |  NEFT/RTGS: 10s  |  FT: 15s
 *
 * Response Y (Code 11) → ICICI credits our account
 * Response N (Code 12) → ICICI refunds the payer
 *
 * If we don't respond in time, the configured "Deemed" action takes effect
 * (set to Deemed Accept during ICICI onboarding).
 */

// TODO: ICICI APPROVAL — remove this stub and uncomment the real handler below
const msgHold = async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
  const response = { AcceptOrReject: 'Y', Message: 'Accept', Code: '11' };
  let logError = null;
  try {
    const { error } = await supabase.from('icici_request_logs').insert({ endpoint: 'msg-hold', ip, raw_body: req.body || {}, response_body: response });
    logError = error ? error.message : null;
  } catch (err) {
    logError = err.message;
  }
  if (logError) {
    logger.error(`[ICICI MSG HOLD STUB] DB log failed: ${logError}`);
    await supabase.from('icici_request_logs').insert({ endpoint: 'msg-hold', ip, raw_body: req.body || {}, response_body: response, error: logError });
  }
  logger.info(`[ICICI MSG HOLD STUB] IP=${ip} response=${JSON.stringify(response)}`);
  return res.status(200).json(response);
};

// TODO: ICICI APPROVAL — uncomment this real handler (and remove the stub above)
// const msgHold = async (req, res) => {
//   const startMs = Date.now();
//   try {
//     // Optional IP whitelist — ICICI_WHITELISTED_IPS is a comma-separated list
//     const allowedIps = process.env.ICICI_WHITELISTED_IPS;
//     if (allowedIps) {
//       const callerIp =
//         (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
//         req.headers['x-real-ip'] ||
//         req.ip ||
//         '';
//       if (!allowedIps.split(',').map((s) => s.trim()).includes(callerIp)) {
//         logger.warn(`[ICICI MSG HOLD] Rejected request from unexpected IP: ${callerIp}`);
//         return res.status(200).json({ AcceptOrReject: 'N', Message: 'Unauthorized source', Code: '12' });
//       }
//     }
//
//     let payload;
//     try {
//       payload = await decryptIciciPayload(req.body);
//     } catch (cryptoErr) {
//       logger.error('[ICICI MSG HOLD] Decryption failed:', cryptoErr);
//       return res.status(200).json({ AcceptOrReject: 'N', Message: 'Decryption failed', Code: '12' });
//     }
//
//     const {
//       ClientCode, VirtualAccountNumber, Mode, UTR, SenderRemark,
//       ClientAccountNo, Amount, PayerName, PayerAccNumber, PayerBankIFSC,
//       PayerPaymentDate, BankInternalTransactionNumber,
//     } = payload;
//
//     if (!VirtualAccountNumber || !UTR || !Amount || !Mode) {
//       logger.error('[ICICI MSG HOLD] Missing required fields in decrypted payload');
//       return res.status(200).json({ AcceptOrReject: 'N', Message: 'Missing required fields', Code: '12' });
//     }
//
//     const amountNum = parseFloat(Amount);
//
//     // Look up the virtual account
//     const { data: va, error: vaErr } = await supabase
//       .from('virtual_accounts')
//       .select('id, booking_id, payment_order_id, generic_payment_link_id, expected_amount, status, expires_at')
//       .eq('van', VirtualAccountNumber)
//       .maybeSingle();
//
//     if (vaErr) {
//       logger.error('[ICICI MSG HOLD] DB error looking up VAN:', vaErr);
//       return res.status(200).json({ AcceptOrReject: 'N', Message: 'Internal error', Code: '12' });
//     }
//
//     // Determine accept/reject
//     let decision = 'Y';
//     let rejectReason = '';
//
//     if (!va) {
//       decision = 'N';
//       rejectReason = 'Unknown VAN';
//     } else if (va.status !== 'active') {
//       decision = 'N';
//       rejectReason = `VAN status is ${va.status}`;
//     } else if (va.expires_at && new Date(va.expires_at) < new Date()) {
//       decision = 'N';
//       rejectReason = 'VAN expired';
//       supabase.from('virtual_accounts').update({ status: 'expired' }).eq('id', va.id).then(() => {});
//     } else if (va.expected_amount !== null && Math.abs(amountNum - va.expected_amount) > 1) {
//       decision = 'N';
//       rejectReason = `Amount mismatch: expected ${va.expected_amount}, received ${amountNum}`;
//     }
//
//     if (decision === 'N') {
//       logger.warn(`[ICICI MSG HOLD] Rejecting VAN=${VirtualAccountNumber} UTR=${UTR}: ${rejectReason}`);
//     }
//
//     // Upsert the transaction record (UTR is unique — handles retries gracefully)
//     await supabase.from('icici_ecollection_transactions').upsert(
//       {
//         virtual_account_id: va?.id ?? null,
//         van: VirtualAccountNumber,
//         client_code: ClientCode ?? '',
//         mode: Mode,
//         utr: UTR,
//         sender_remark: SenderRemark ?? null,
//         client_account_no: ClientAccountNo ?? null,
//         amount: amountNum,
//         payer_name: PayerName ?? null,
//         payer_acc_number: PayerAccNumber ?? null,
//         payer_bank_ifsc: PayerBankIFSC ?? null,
//         payer_payment_date: PayerPaymentDate ?? null,
//         bank_internal_txn_number: BankInternalTransactionNumber ?? null,
//         msg_hold_decision: decision,
//         msg_hold_at: new Date().toISOString(),
//         msg_hold_raw_payload: payload,
//         payment_status: decision === 'Y' ? 'accepted' : 'rejected',
//       },
//       { onConflict: 'utr' }
//     );
//
//     logger.info(
//       `[ICICI MSG HOLD] VAN=${VirtualAccountNumber} UTR=${UTR} Mode=${Mode} Amount=${Amount} Decision=${decision} (${Date.now() - startMs}ms)`
//     );
//
//     const responsePayload =
//       decision === 'Y'
//         ? { AcceptOrReject: 'Y', Message: 'Accept', Code: '11' }
//         : { AcceptOrReject: 'N', Message: 'Reject', Code: '12' };
//
//     try {
//       const encrypted = encryptIciciResponse(responsePayload);
//       return res.status(200).json(encrypted);
//     } catch {
//       return res.status(200).json(responsePayload);
//     }
//   } catch (err) {
//     logger.error('[ICICI MSG HOLD] Unhandled error:', err);
//     return res.status(200).json({ AcceptOrReject: 'N', Message: 'Internal server error', Code: '12' });
//   }
// };

/**
 * ICICI eCollections — MIS POSTING
 *
 * ICICI Bank calls this after funds are credited to our account.
 * This is the final confirmation — we record the credit and confirm the booking.
 *
 * Success:       { Response: "Success",      Code: "11" }
 * Duplicate UTR: { Response: "Duplicate UTR", Code: "06" }
 */

// TODO: ICICI APPROVAL — remove this stub and uncomment the real handler below
const misPosting = async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
  const response = { Response: 'Success', Code: '11' };
  let logError = null;
  try {
    const { error } = await supabase.from('icici_request_logs').insert({ endpoint: 'mis-posting', ip, raw_body: req.body || {}, response_body: response });
    logError = error ? error.message : null;
  } catch (err) {
    logError = err.message;
  }
  if (logError) {
    logger.error(`[ICICI MIS POSTING STUB] DB log failed: ${logError}`);
    await supabase.from('icici_request_logs').insert({ endpoint: 'mis-posting', ip, raw_body: req.body || {}, response_body: response, error: logError });
  }
  logger.info(`[ICICI MIS POSTING STUB] IP=${ip} response=${JSON.stringify(response)}`);
  return res.status(200).json(response);
};

// TODO: ICICI APPROVAL — uncomment this real handler (and remove the stub above)
// const misPosting = async (req, res) => {
//   try {
//     // Optional IP whitelist
//     const allowedIps = process.env.ICICI_WHITELISTED_IPS;
//     if (allowedIps) {
//       const callerIp =
//         (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
//         req.headers['x-real-ip'] ||
//         req.ip ||
//         '';
//       if (!allowedIps.split(',').map((s) => s.trim()).includes(callerIp)) {
//         logger.warn(`[ICICI MIS POSTING] Rejected request from unexpected IP: ${callerIp}`);
//         return res.status(200).json({ Response: 'Unauthorized source', Code: '99' });
//       }
//     }
//
//     let payload;
//     try {
//       payload = await decryptIciciPayload(req.body);
//     } catch (cryptoErr) {
//       logger.error('[ICICI MIS POSTING] Decryption failed:', cryptoErr);
//       return res.status(200).json({ Response: 'Decryption failed', Code: '99' });
//     }
//
//     const {
//       ClientCode, VirtualAccountNumber, Mode, UTR, SenderRemark,
//       ClientAccountNo, Amount, PayerName, PayerAccNumber, PayerBankIFSC,
//       PayerPaymentDate, BankInternalTransactionNumber,
//     } = payload;
//
//     if (!VirtualAccountNumber || !UTR || !Amount || !Mode) {
//       return res.status(200).json({ Response: 'Missing required fields', Code: '99' });
//     }
//
//     const amountNum = parseFloat(Amount);
//
//     // Duplicate UTR check — the UNIQUE constraint on utr prevents double-processing
//     const { data: existingTxn } = await supabase
//       .from('icici_ecollection_transactions')
//       .select('id, payment_status, mis_posted_at')
//       .eq('utr', UTR)
//       .maybeSingle();
//
//     if (existingTxn?.mis_posted_at) {
//       logger.warn(`[ICICI MIS POSTING] Duplicate UTR received: ${UTR}`);
//       try {
//         const encrypted = encryptIciciResponse({ Response: 'Duplicate UTR', Code: '06' });
//         return res.status(200).json(encrypted);
//       } catch {
//         return res.status(200).json({ Response: 'Duplicate UTR', Code: '06' });
//       }
//     }
//
//     // Upsert transaction with MIS data (may be first time if MSG HOLD was Deemed Accept)
//     const now = new Date().toISOString();
//
//     let vanId = existingTxn ? undefined : null;
//     if (!existingTxn) {
//       const { data: vaRow } = await supabase
//         .from('virtual_accounts')
//         .select('id')
//         .eq('van', VirtualAccountNumber)
//         .maybeSingle();
//       vanId = vaRow?.id ?? null;
//     }
//
//     const { data: txn, error: upsertErr } = await supabase
//       .from('icici_ecollection_transactions')
//       .upsert(
//         {
//           virtual_account_id: vanId,
//           van: VirtualAccountNumber,
//           client_code: ClientCode ?? '',
//           mode: Mode,
//           utr: UTR,
//           sender_remark: SenderRemark ?? null,
//           client_account_no: ClientAccountNo ?? null,
//           amount: amountNum,
//           payer_name: PayerName ?? null,
//           payer_acc_number: PayerAccNumber ?? null,
//           payer_bank_ifsc: PayerBankIFSC ?? null,
//           payer_payment_date: PayerPaymentDate ?? null,
//           bank_internal_txn_number: BankInternalTransactionNumber ?? null,
//           mis_posted_at: now,
//           mis_raw_payload: payload,
//           payment_status: 'credited',
//         },
//         { onConflict: 'utr' }
//       )
//       .select('id, virtual_account_id')
//       .single();
//
//     if (upsertErr) {
//       logger.error('[ICICI MIS POSTING] Transaction upsert error:', upsertErr);
//       return res.status(200).json({ Response: 'Internal error', Code: '99' });
//     }
//
//     // Mark virtual account as paid
//     const vaId = txn?.virtual_account_id;
//     if (vaId) {
//       const { data: va } = await supabase
//         .from('virtual_accounts')
//         .update({ status: 'paid', updated_at: now })
//         .eq('id', vaId)
//         .select('booking_id, payment_order_id, generic_payment_link_id')
//         .single();
//
//       if (va) {
//         await confirmDownstreamRecords(va, now);
//       }
//     }
//
//     // Acknowledge MIS receipt
//     await supabase
//       .from('icici_ecollection_transactions')
//       .update({ mis_acknowledged_at: now })
//       .eq('id', txn.id);
//
//     logger.info(
//       `[ICICI MIS POSTING] Credited VAN=${VirtualAccountNumber} UTR=${UTR} Amount=${Amount} Mode=${Mode}`
//     );
//
//     try {
//       const encrypted = encryptIciciResponse({ Response: 'Success', Code: '11' });
//       return res.status(200).json(encrypted);
//     } catch {
//       return res.status(200).json({ Response: 'Success', Code: '11' });
//     }
//   } catch (err) {
//     logger.error('[ICICI MIS POSTING] Unhandled error:', err);
//     return res.status(200).json({ Response: 'Internal server error', Code: '99' });
//   }
// };
//
// async function confirmDownstreamRecords(va, now) {
//   const updates = [];
//
//   if (va.booking_id) {
//     updates.push(
//       supabase
//         .from('bookings')
//         .update({ payment_status: 'paid', booking_status: 'confirmed', updated_at: now })
//         .eq('id', va.booking_id)
//         .then()
//     );
//   }
//
//   if (va.payment_order_id) {
//     updates.push(
//       supabase
//         .from('payment_orders')
//         .update({ status: 'success', updated_at: now })
//         .eq('id', va.payment_order_id)
//         .then()
//     );
//   }
//
//   if (va.generic_payment_link_id) {
//     updates.push(
//       supabase
//         .from('generic_payment_links')
//         .update({ status: 'paid', updated_at: now })
//         .eq('id', va.generic_payment_link_id)
//         .then()
//     );
//   }
//
//   await Promise.all(updates);
// }

module.exports = { msgHold, misPosting };
