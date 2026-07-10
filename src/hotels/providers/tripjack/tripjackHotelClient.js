const axios = require('axios');
const { randomUUID } = require('crypto');
const logger = require('../../../utils/logger');
const logToDB = require('../../../utils/logToDB');
const { BASE_URLS } = require('./tripjackHotelConfig');

const makeClient = (baseURL) =>
  axios.create({
    baseURL,
    headers: {
      apikey: process.env.HOTEL_API_KEY,
      'Content-Type': 'application/json',
    },
    timeout: 120000, // 2 min — TripJack content batches can be slow
  });

/**
 * Resolve final mode with priority:
 *   1. Explicit param passed by caller ('test' | 'live')
 *   2. HOTEL_MODE env var
 *   3. 'live' as hard fallback
 */
function resolveMode(mode) {
  if (mode === 'test' || mode === 'live') return mode;
  return process.env.HOTEL_MODE === 'test' ? 'test' : 'live';
}

function getBaseUrl(resolvedMode, service) {
  const url = BASE_URLS[service]?.[resolvedMode];
  if (!url) {
    const key = service === 'static' ? 'HOTEL_STATIC_API_BASE_URL' : 'HOTEL_HMS_API_BASE_URL';
    throw new Error(`${key}_${resolvedMode.toUpperCase()} is not set in .env`);
  }
  if (!process.env.HOTEL_API_KEY) throw new Error('HOTEL_API_KEY is not set in .env');
  return url;
}

function checkTripjackError(data, path) {
  if (data?.status?.success === false) {
    const error = data.errors?.[0] ?? {};
    const code = error.errCode ?? '?';
    const msg = error.errMsg ?? error.details ?? error.message ?? 'no message returned';
    logger.warn(`[tripjackHotelClient] TripJack error on ${path}`, { status: data.status, errors: data.errors });
    throw new Error(`[${code}] ${msg}`);
  }
}

/**
 * GET request to TripJack hotel API.
 * @param {string} path
 * @param {Object} queryParams
 * @param {'live'|'test'} [mode]
 * @param {'hms'|'static'} [service='hms']
 * @param {string} [clientType='hotel-booking'] - 'hotel-sync' calls are never logged to hotels_api_logs
 */
async function get(path, queryParams = {}, mode, service = 'hms', clientType = 'hotel-booking') {
  const resolvedMode = resolveMode(mode);
  const baseUrl = getBaseUrl(resolvedMode, service);
  const traceId = randomUUID();
  const start = Date.now();
  let responseStatus = null;
  let responseData = null;
  let success = false;
  let errorMessage = null;

  logger.info(`[tripjackHotelClient] GET ${baseUrl}${path}`, { params: queryParams, mode: resolvedMode });

  try {
    const res = await makeClient(baseUrl).get(path, { params: queryParams });
    responseStatus = res.status;
    responseData = res.data;
    checkTripjackError(responseData, path);
    success = true;
    logger.info(`[tripjackHotelClient] GET ${path} → ${responseStatus} (${Date.now() - start}ms)`);
    return responseData;
  } catch (err) {
    responseStatus = responseStatus ?? err.response?.status ?? null;
    errorMessage = err.message;
    logger.error(`[tripjackHotelClient] GET ${path} failed → ${responseStatus}`, {
      errorMessage,
      responseBody: err.response?.data ?? null,
    });
    throw err;
  } finally {
    // Sync-job traffic is already logged to Winston above — skip the DB audit
    // trail for it so hotels_api_logs doesn't grow unbounded from bulk jobs.
    if (clientType !== 'hotel-sync') {
      logToDB({ traceId, clientType, endpoint: path, method: 'GET', requestBody: queryParams, responseBody: responseData, responseStatus, responseTimeMs: Date.now() - start, success, errorMessage });
    }
  }
}

/**
 * POST request to TripJack hotel API.
 * @param {string} path
 * @param {Object} body
 * @param {'live'|'test'} [mode]
 * @param {'hms'|'static'} [service='hms']
 * @param {number} [retries=1]
 * @param {string} [clientType='hotel-booking'] - 'hotel-sync' calls are never logged to hotels_api_logs
 */
async function post(path, body = {}, mode, service = 'hms', retries = 1, clientType = 'hotel-booking') {
  const resolvedMode = resolveMode(mode);
  const baseUrl = getBaseUrl(resolvedMode, service);
  const traceId = randomUUID();
  const start = Date.now();
  let responseStatus = null;
  let responseData = null;
  let success = false;
  let errorMessage = null;

  logger.info(`[tripjackHotelClient] POST ${baseUrl}${path}`, { body, mode: resolvedMode });

  const attempt = async () => {
    const res = await makeClient(baseUrl).post(path, body);
    responseStatus = res.status;
    responseData = res.data;
    checkTripjackError(responseData, path);
    success = true;
    logger.info(`[tripjackHotelClient] POST ${path} → ${responseStatus} (${Date.now() - start}ms)`);
    return responseData;
  };

  try {
    return await attempt();
  } catch (err) {
    const isRetryable = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.message?.includes('timeout');

    if (retries > 0 && isRetryable) {
      logger.warn(`[tripjackHotelClient] POST ${path} timed out — retrying (${retries} left)`);
      await new Promise((r) => setTimeout(r, 3000)); // 3s back-off before retry
      return post(path, body, mode, service, retries - 1, clientType);
    }

    responseStatus = responseStatus ?? err.response?.status ?? null;
    errorMessage = err.message;
    logger.error(`[tripjackHotelClient] POST ${path} failed → ${responseStatus}`, {
      errorMessage,
      responseBody: err.response?.data ?? null,
    });
    throw err;
  } finally {
    if (clientType !== 'hotel-sync') {
      logToDB({ traceId, clientType, endpoint: path, method: 'POST', requestBody: body, responseBody: responseData, responseStatus, responseTimeMs: Date.now() - start, success, errorMessage });
    }
  }
}

module.exports = { get, post };
