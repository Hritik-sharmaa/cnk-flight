const axios = require('axios');
const { randomUUID } = require('crypto');
const supabase = require('../../../db/supabase');

const client = axios.create({
  baseURL: process.env.HOTEL_API_BASE_URL,
  headers: {
    apikey: process.env.HOTEL_API_KEY,
    'Content-Type': 'application/json',
  },
  timeout: 60000,
});

async function _logCall({ traceId, endpoint, method, requestBody, responseStatus, responseTimeMs, success, errorMessage }) {
  // fire-and-forget — errors here must never propagate to the caller
  supabase
    .from('api_request_logs')
    .insert({
      trace_id: traceId,
      endpoint,
      method,
      request_body: requestBody,
      response_status: responseStatus,
      response_time_ms: responseTimeMs,
      success,
      error_message: errorMessage ?? null,
      client_type: 'hotel-sync',
    })
    .then(({ error }) => {
      if (error) console.error('[hotel-client] Failed to write api_request_log:', error.message);
    });
}

async function post(path, body = {}) {
  const traceId = randomUUID();
  const start = Date.now();
  let responseStatus = null;
  let success = false;
  let errorMessage = null;

  try {
    const res = await client.post(path, body);
    responseStatus = res.status;
    success = true;
    return res.data;
  } catch (err) {
    responseStatus = err.response?.status ?? null;
    errorMessage = err.message;
    throw err;
  } finally {
    _logCall({ traceId, endpoint: path, method: 'POST', requestBody: body, responseStatus, responseTimeMs: Date.now() - start, success, errorMessage });
  }
}

module.exports = { post };
