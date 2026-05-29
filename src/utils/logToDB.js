const supabase = require('../db/supabase');
const logger = require('./logger');

/**
 * Universal async function to write a row to api_request_logs.
 * Always safe to fire-and-forget — internal errors are silently swallowed.
 *
 * @param {Object} params
 * @param {string} [params.traceId]        - UUID trace ID for the request
 * @param {string} [params.clientType]     - e.g. 'hotel-sync', 'hotel-search', 'flight'
 * @param {string} [params.clientId]       - caller identity if known
 * @param {string}  params.endpoint        - API path called
 * @param {string}  params.method          - HTTP method
 * @param {Object} [params.requestHeaders] - outbound request headers
 * @param {Object} [params.requestBody]    - outbound request body
 * @param {number} [params.responseStatus] - HTTP status received
 * @param {Object} [params.responseBody]   - response payload (optional, can be large)
 * @param {string} [params.ipAddress]      - caller IP
 * @param {number} [params.responseTimeMs] - round-trip time in ms
 * @param {boolean} params.success         - whether the call succeeded
 * @param {string} [params.errorMessage]   - error message if failed
 * @returns {Promise<void>}
 */
const logToDB = async ({
  traceId = null,
  clientType = null,
  clientId = null,
  endpoint,
  method,
  requestHeaders = null,
  requestBody = null,
  responseStatus = null,
  responseBody = null,
  ipAddress = null,
  responseTimeMs = null,
  success,
  errorMessage = null,
}) => {
  try {
    await supabase.from('hotels_api_logs').insert({
      trace_id: traceId,
      client_type: clientType,
      client_id: clientId,
      endpoint,
      method,
      request_headers: requestHeaders,
      request_body: requestBody,
      response_status: responseStatus,
      response_body: responseBody,
      ip_address: ipAddress,
      response_time_ms: responseTimeMs,
      success,
      error_message: errorMessage,
    });
  } catch (err) {
    logger.error('[logToDB] Failed to write api_request_log:', err.message);
  }
};

module.exports = logToDB;
