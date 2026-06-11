const supabase = require('../db/supabase');
const logger = require('./logger');

/**
 * Write one row to flight_api_logs.
 * Mirrors the logToDB pattern used by tripjackHotelClient — always safe to
 * fire-and-forget; internal errors are swallowed so logging never breaks an API call.
 *
 * @param {Object} params
 * @param {string}  params.provider           - e.g. 'tripjack'
 * @param {string}  params.stage              - search | review | fare-rule | seat-map | book | fare-validate | confirm-book | booking-details | unhold | order-status | cancel | ssr
 * @param {string}  params.endpoint           - full URL that was called
 * @param {string} [params.httpMethod]        - default 'POST'
 * @param {number} [params.httpStatus]        - HTTP status code received
 * @param {Object} [params.requestPayload]    - outbound request body
 * @param {Object} [params.responsePayload]   - parsed response body
 * @param {number} [params.durationMs]        - round-trip time in ms
 * @param {boolean} params.isError            - whether the call failed
 * @param {string} [params.errorMessage]      - error detail if failed
 * @param {string} [params.correlationId]     - ties search → review → book for one user flow
 * @param {string} [params.providerBookingId] - Tripjack bookingId once known
 * @param {string} [params.flightBookingId]   - UUID FK to flight_bookings.id
 * @param {string} [params.quoteId]           - UUID FK to quotes.id
 * @param {string} [params.bookingId]         - UUID FK to bookings.id
 * @param {string} [params.environment]       - production | uat | sandbox
 * @param {string} [params.createdBy]         - user email / id from calling app
 */
const logFlightApiCall = async ({
  provider,
  stage,
  endpoint,
  httpMethod = 'POST',
  httpStatus = null,
  requestPayload = null,
  responsePayload = null,
  durationMs = null,
  isError = false,
  errorMessage = null,
  correlationId = null,
  providerBookingId = null,
  flightBookingId = null,
  quoteId = null,
  bookingId = null,
  environment = null,
  createdBy = null,
}) => {
  try {
    await supabase.from('flight_api_logs').insert({
      provider,
      stage,
      endpoint,
      http_method: httpMethod,
      http_status: httpStatus,
      request_payload: requestPayload,
      response_payload: responsePayload,
      request_headers: { apikey: '[redacted]', 'Content-Type': 'application/json' },
      duration_ms: durationMs,
      is_error: isError,
      error_message: errorMessage,
      correlation_id: correlationId,
      provider_booking_id: providerBookingId,
      flight_booking_id: flightBookingId,
      quote_id: quoteId,
      booking_id: bookingId,
      environment: environment ?? deriveEnvironment(endpoint),
      created_by: createdBy,
    });
  } catch (err) {
    logger.error(`[flightApiLogger] insert failed (${stage}):`, err.message);
  }
};

function deriveEnvironment(endpoint) {
  if (!endpoint) return 'production';
  if (endpoint.includes('apitest')) return 'uat';
  if (endpoint.includes('sandbox')) return 'sandbox';
  return 'production';
}

module.exports = logFlightApiCall;
