const { randomUUID } = require('crypto');
const logger = require('../utils/logger');
const supabase = require('../db/supabase');
const { decryptIciciPayload, encryptIciciResponse } = require('../utils/iciciCrypto');

// Encrypts every response. Returns 500 if encryption fails — never sends plain.
// A 500 is safer than leaking payment data unencrypted.
// ICICI handles non-response via Deemed Accept (MSG HOLD) or retry (MIS POSTING).
function sendResponse(res, payload, requestId = '', service = '') {
  try {
    return res.status(200).json(encryptIciciResponse(payload, requestId, service));
  } catch (encErr) {
    logger.error('[ICICI] Response encryption failed — refusing to send plain response:', encErr.message);
    return res.status(500).end();
  }
}

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
const msgHold = async (req, res) => {
  const startMs = Date.now();
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.headers['x-real-ip'] || req.ip || '';
  const logId = randomUUID();

  // Insert log immediately — before IP check so even rejected requests are captured
  supabase.from('icici_request_logs').insert({
    id: logId,
    endpoint: 'msg-hold',
    ip,
    raw_body: req.body || {},
    response_body: null,
    error: null,
  }).then();

  // Helper — updates the log row on every exit path (fire-and-forget, never blocks response)
  const finishLog = (response, error = null, van = null, utr = null) => {
    supabase.from('icici_request_logs')
      .update({ response_body: response ?? null, error: error ?? null, ...(van && { van }), ...(utr && { utr }) })
      .eq('id', logId)
      .then();
  };

  try {
    const reqId = req.body?.requestId || '';
    const svcName = req.body?.service || '';

    // Optional IP whitelist — ICICI_WHITELISTED_IPS is a comma-separated list
    const allowedIps = process.env.ICICI_WHITELISTED_IPS;
    if (allowedIps) {
      if (!allowedIps.split(',').map((s) => s.trim()).includes(ip)) {
        logger.warn(`[ICICI MSG HOLD] Rejected request from unexpected IP: ${ip}`);
        const resp = { AcceptOrReject: 'N', Message: 'Unauthorized source', Code: '12' };
        finishLog(resp, `IP not whitelisted: ${ip}`);
        return sendResponse(res, resp, reqId, svcName);
      }
    }

    let payload;
    try {
      payload = await decryptIciciPayload(req.body);
    } catch (cryptoErr) {
      logger.error('[ICICI MSG HOLD] Decryption failed:', cryptoErr);
      const resp = { AcceptOrReject: 'N', Message: 'Decryption failed', Code: '12' };
      finishLog(resp, `Decryption failed: ${cryptoErr.message}`);
      return sendResponse(res, resp, reqId, svcName);
    }

    const {
      ClientCode, VirtualAccountNumber, Mode, UTR, USERID, SenderRemark,
      ClientAccountNo, Amount, PayerName, PayerAccNumber, PayerBankIFSC,
      PayerPaymentDate, BankInternalTransactionNumber,
    } = payload;

    if (!VirtualAccountNumber || !UTR || !Amount || !Mode) {
      logger.error('[ICICI MSG HOLD] Missing required fields in decrypted payload');
      const resp = { AcceptOrReject: 'N', Message: 'Missing required fields', Code: '12' };
      finishLog(resp, `Missing required fields. Present keys: ${Object.keys(payload).join(', ')}`);
      return sendResponse(res, resp, reqId, svcName);
    }

    const amountNum = parseFloat(Amount);
    if (isNaN(amountNum)) {
      const resp = { AcceptOrReject: 'N', Message: 'Invalid amount', Code: '12' };
      finishLog(resp, `Invalid amount value: ${Amount}`);
      return sendResponse(res, resp, reqId, svcName);
    }

    // Look up the virtual account
    const { data: va, error: vaErr } = await supabase
      .from('virtual_accounts')
      .select('id, booking_id, payment_order_id, generic_payment_link_id, expected_amount, status, expires_at')
      .eq('van', VirtualAccountNumber)
      .maybeSingle();

    if (vaErr) {
      logger.error('[ICICI MSG HOLD] DB error looking up VAN:', vaErr);
      const resp = { AcceptOrReject: 'N', Message: 'Internal error', Code: '12' };
      finishLog(resp, `DB error on VAN lookup: ${vaErr.message}`);
      return sendResponse(res, resp, reqId, svcName);
    }

    // Determine accept/reject
    let decision = 'Y';
    let rejectReason = '';

    if (!va) {
      decision = 'N';
      rejectReason = 'Unknown VAN';
    } else if (va.status !== 'active') {
      decision = 'N';
      rejectReason = `VAN status is ${va.status}`;
    } else if (va.expires_at && new Date(va.expires_at) < new Date()) {
      decision = 'N';
      rejectReason = 'VAN expired';
      supabase.from('virtual_accounts').update({ status: 'expired' }).eq('id', va.id).then(() => {});
    } else if (va.expected_amount !== null && Math.abs(amountNum - va.expected_amount) > 1) {
      decision = 'N';
      rejectReason = `Amount mismatch: expected ${va.expected_amount}, received ${amountNum}`;
    }

    if (decision === 'N') {
      logger.warn(`[ICICI MSG HOLD] Rejecting VAN=${VirtualAccountNumber} UTR=${UTR}: ${rejectReason}`);
    }

    const responsePayload =
      decision === 'Y'
        ? { AcceptOrReject: 'Y', Message: 'Accept', Code: '11' }
        : { AcceptOrReject: 'N', Message: 'Reject', Code: '12' };

    // Upsert the transaction record (UTR is unique — handles retries gracefully)
    const { error: txnErr } = await supabase.from('icici_ecollection_transactions').upsert(
      {
        virtual_account_id: va?.id ?? null,
        van: VirtualAccountNumber,
        client_code: ClientCode ?? '',
        mode: Mode,
        utr: UTR,
        sender_remark: SenderRemark ?? null,
        client_account_no: ClientAccountNo ?? null,
        amount: amountNum,
        payer_name: PayerName ?? null,
        payer_acc_number: PayerAccNumber ?? null,
        payer_bank_ifsc: PayerBankIFSC ?? null,
        payer_payment_date: PayerPaymentDate ?? null,
        bank_internal_txn_number: BankInternalTransactionNumber ?? null,
        userid: USERID ?? null,
        msg_hold_decision: decision,
        msg_hold_reject_reason: rejectReason || null,
        msg_hold_at: new Date().toISOString(),
        msg_hold_raw_payload: payload,
        payment_status: decision === 'Y' ? 'accepted' : 'rejected',
      },
      { onConflict: 'utr' }
    );

    if (txnErr) {
      logger.error('[ICICI MSG HOLD] Transaction upsert error:', txnErr);
      finishLog(responsePayload, `Transaction upsert failed: ${txnErr.message}`, VirtualAccountNumber, UTR);
    } else {
      finishLog(responsePayload, rejectReason || null, VirtualAccountNumber, UTR);
    }

    logger.info(
      `[ICICI MSG HOLD] VAN=${VirtualAccountNumber} UTR=${UTR} Mode=${Mode} Amount=${Amount} Decision=${decision} (${Date.now() - startMs}ms)`
    );

    return sendResponse(res, responsePayload, reqId, svcName);
  } catch (err) {
    logger.error('[ICICI MSG HOLD] Unhandled error:', err);
    const resp = { AcceptOrReject: 'N', Message: 'Internal server error', Code: '12' };
    finishLog(resp, `Unhandled error: ${err.message}`);
    return sendResponse(res, resp, req.body?.requestId || '', req.body?.service || '');
  }
};

/**
 * ICICI eCollections — MIS POSTING
 *
 * ICICI Bank calls this after funds are credited to our account.
 * This is the final confirmation — we record the credit and confirm the booking.
 *
 * Success:       { Response: "Success",      Code: "11" }
 * Duplicate UTR: { Response: "Duplicate UTR", Code: "06" }
 */
const misPosting = async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.headers['x-real-ip'] || req.ip || '';
  const logId = randomUUID();

  // Insert log immediately — before IP check so even rejected requests are captured
  supabase.from('icici_request_logs').insert({
    id: logId,
    endpoint: 'mis-posting',
    ip,
    raw_body: req.body || {},
    response_body: null,
    error: null,
  }).then();

  const finishLog = (response, error = null, van = null, utr = null) => {
    supabase.from('icici_request_logs')
      .update({ response_body: response ?? null, error: error ?? null, ...(van && { van }), ...(utr && { utr }) })
      .eq('id', logId)
      .then();
  };

  try {
    const reqId = req.body?.requestId || '';
    const svcName = req.body?.service || '';

    // Optional IP whitelist
    const allowedIps = process.env.ICICI_WHITELISTED_IPS;
    if (allowedIps) {
      if (!allowedIps.split(',').map((s) => s.trim()).includes(ip)) {
        logger.warn(`[ICICI MIS POSTING] Rejected request from unexpected IP: ${ip}`);
        const resp = { Response: 'Unauthorized source', Code: '99' };
        finishLog(resp, `IP not whitelisted: ${ip}`);
        return sendResponse(res, resp, reqId, svcName);
      }
    }

    let payload;
    try {
      payload = await decryptIciciPayload(req.body);
    } catch (cryptoErr) {
      logger.error('[ICICI MIS POSTING] Decryption failed:', cryptoErr);
      const resp = { Response: 'Decryption failed', Code: '99' };
      finishLog(resp, `Decryption failed: ${cryptoErr.message}`);
      return sendResponse(res, resp, reqId, svcName);
    }

    const {
      ClientCode, VirtualAccountNumber, Mode, UTR, USERID, SenderRemark,
      ClientAccountNo, Amount, PayerName, PayerAccNumber, PayerBankIFSC,
      PayerPaymentDate, BankInternalTransactionNumber,
    } = payload;

    if (!VirtualAccountNumber || !UTR || !Amount || !Mode) {
      const resp = { Response: 'Missing required fields', Code: '99' };
      finishLog(resp, `Missing required fields. Present keys: ${Object.keys(payload).join(', ')}`);
      return sendResponse(res, resp, reqId, svcName);
    }

    const amountNum = parseFloat(Amount);
    if (isNaN(amountNum)) {
      const resp = { Response: 'Invalid amount', Code: '99' };
      finishLog(resp, `Invalid amount value: ${Amount}`);
      return sendResponse(res, resp, reqId, svcName);
    }

    // Duplicate UTR check — the UNIQUE constraint on utr prevents double-processing
    const { data: existingTxn } = await supabase
      .from('icici_ecollection_transactions')
      .select('id, payment_status, mis_posted_at')
      .eq('utr', UTR)
      .maybeSingle();

    if (existingTxn?.mis_posted_at) {
      logger.warn(`[ICICI MIS POSTING] Duplicate UTR received: ${UTR}`);
      const resp = { Response: 'Duplicate UTR', Code: '06' };
      finishLog(resp, `Duplicate UTR: ${UTR}`);
      return sendResponse(res, resp, reqId, svcName);
    }

    // Upsert transaction with MIS data (may be first time if MSG HOLD was Deemed Accept)
    const now = new Date().toISOString();

    let vanId = existingTxn ? undefined : null;
    if (!existingTxn) {
      const { data: vaRow } = await supabase
        .from('virtual_accounts')
        .select('id')
        .eq('van', VirtualAccountNumber)
        .maybeSingle();
      vanId = vaRow?.id ?? null;
    }

    const { data: txn, error: upsertErr } = await supabase
      .from('icici_ecollection_transactions')
      .upsert(
        {
          virtual_account_id: vanId,
          van: VirtualAccountNumber,
          client_code: ClientCode ?? '',
          mode: Mode,
          utr: UTR,
          sender_remark: SenderRemark ?? null,
          client_account_no: ClientAccountNo ?? null,
          amount: amountNum,
          payer_name: PayerName ?? null,
          payer_acc_number: PayerAccNumber ?? null,
          payer_bank_ifsc: PayerBankIFSC ?? null,
          payer_payment_date: PayerPaymentDate ?? null,
          bank_internal_txn_number: BankInternalTransactionNumber ?? null,
          userid: USERID ?? null,
          mis_posted_at: now,
          mis_raw_payload: payload,
          payment_status: 'credited',
        },
        { onConflict: 'utr' }
      )
      .select('id, virtual_account_id')
      .single();

    if (upsertErr) {
      logger.error('[ICICI MIS POSTING] Transaction upsert error:', upsertErr);
      const resp = { Response: 'Internal error', Code: '99' };
      finishLog(resp, `Transaction upsert failed: ${upsertErr.message}`);
      return sendResponse(res, resp, reqId, svcName);
    }

    // Collect all flags and data needed — no DB calls yet
    const isDeemedAccept = !existingTxn;
    const vaId = txn?.virtual_account_id;
    let amountMismatchNote = null;
    const txnUpdate = { mis_acknowledged_at: now };

    if (isDeemedAccept) {
      txnUpdate.manual_review = true;
      txnUpdate.manual_review_reason = `Deemed Accept — MIS POSTING received with no prior MSG HOLD for UTR ${UTR}`;
      logger.warn(`[ICICI MIS POSTING] Deemed Accept — no prior MSG HOLD VAN=${VirtualAccountNumber} UTR=${UTR}`);
    }

    if (!vaId) {
      txnUpdate.manual_review = true;
      txnUpdate.manual_review_reason = `No VAN found in DB for ${VirtualAccountNumber} — payment unlinked, manual reconciliation needed`;
      logger.warn(`[ICICI MIS POSTING] No VAN found in DB VAN=${VirtualAccountNumber} UTR=${UTR} Amount=${amountNum}`);
    }

    if (vaId) {
      const { data: vaLookup } = await supabase
        .from('virtual_accounts')
        .select('expected_amount, booking_id, payment_order_id, generic_payment_link_id, status')
        .eq('id', vaId)
        .single();

      const amountMatches = vaLookup?.expected_amount === null || vaLookup?.expected_amount === undefined ||
        Math.abs(amountNum - vaLookup.expected_amount) <= 1;

      const alreadyPaid = vaLookup?.status === 'paid';
      const newStatus = amountMatches ? 'paid' : 'paid_partial';

      // VAN status update — critical, must happen before response
      const { data: va } = await supabase
        .from('virtual_accounts')
        .update({ status: alreadyPaid ? 'paid' : newStatus, updated_at: now })
        .eq('id', vaId)
        .select('id, booking_id, payment_order_id, generic_payment_link_id, quote_id, expected_amount')
        .single();

      if (va && amountMatches && !alreadyPaid) {
        confirmDownstreamRecords(va, now).catch((e) =>
          logger.error('[ICICI MIS POSTING] confirmDownstreamRecords error:', e.message)
        );
      }

      if (vaLookup?.expected_amount) txnUpdate.expected_amount_at_credit = vaLookup.expected_amount;

      if (alreadyPaid && !amountMatches) {
        txnUpdate.manual_review = true;
        txnUpdate.manual_review_reason = `Second payment on already-paid VAN with amount mismatch — expected ${vaLookup.expected_amount}, received ${amountNum}, VAN was already settled`;
      } else if (!amountMatches) {
        txnUpdate.manual_review = true;
        txnUpdate.manual_review_reason = `Amount mismatch: expected ${vaLookup.expected_amount}, received ${amountNum}`;
        amountMismatchNote = `Amount mismatch: expected ${vaLookup.expected_amount}, received ${amountNum} — VAN marked paid_partial, manual review needed`;
        logger.warn(`[ICICI MIS POSTING] ${amountMismatchNote} VAN=${VirtualAccountNumber}`);
      } else if (alreadyPaid) {
        txnUpdate.manual_review = true;
        txnUpdate.manual_review_reason = `Second payment on already-paid VAN — received ${amountNum}, VAN was already settled`;
        logger.warn(`[ICICI MIS POSTING] Second payment on already-paid VAN=${VirtualAccountNumber} UTR=${UTR} Amount=${amountNum}`);
      }
    }

    // Send response immediately — all remaining DB writes are fire-and-forget
    logger.info(`[ICICI MIS POSTING] Credited VAN=${VirtualAccountNumber} UTR=${UTR} Amount=${Amount} Mode=${Mode}`);
    const resp = { Response: 'Success', Code: '11' };
    finishLog(resp, amountMismatchNote || null, VirtualAccountNumber, UTR);
    const response = sendResponse(res, resp, reqId, svcName);

    // Fire-and-forget — non-critical updates after response
    supabase.from('icici_ecollection_transactions').update(txnUpdate).eq('id', txn.id).then();

    return response;
  } catch (err) {
    logger.error('[ICICI MIS POSTING] Unhandled error:', err);
    const resp = { Response: 'Internal server error', Code: '99' };
    finishLog(resp, `Unhandled error: ${err.message}`);
    return sendResponse(res, resp, req.body?.requestId || '', req.body?.service || '');
  }
};

async function confirmDownstreamRecords(va, now) {
  const updates = [];

  if (va.booking_id) {
    updates.push(
      supabase
        .from('bookings')
        .update({ payment_status: 'paid', booking_status: 'confirmed', updated_at: now })
        .eq('id', va.booking_id)
        .then()
    );
  }

  if (va.payment_order_id) {
    updates.push(
      supabase
        .from('payment_orders')
        .update({ status: 'success', updated_at: now })
        .eq('id', va.payment_order_id)
        .then()
    );
  }

  if (va.generic_payment_link_id) {
    updates.push(
      supabase
        .from('generic_payment_links')
        .update({ status: 'paid', updated_at: now })
        .eq('id', va.generic_payment_link_id)
        .then()
    );
  }

  await Promise.all(updates);

  // Notify cnkb2b to handle booking creation (quote→booking), installment
  // reconciliation, and email dispatch. Non-blocking — ICICI response already sent.
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceKey && va.id) {
    const edgeFnUrl = process.env.CONFIRM_VAN_PAYMENT_URL || `${supabaseUrl}/functions/v1/confirm-van-payment`;
    logger.info(`[confirm-van-payment] calling: ${edgeFnUrl} for va.id=${va.id}`);
    fetch(edgeFnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
      },
      body: JSON.stringify({ virtual_account_id: va.id }),
    }).catch((err) => logger.error('[confirm-van-payment] call failed:', err));
  }
}

module.exports = { msgHold, misPosting };
