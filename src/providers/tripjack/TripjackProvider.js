const axios = require('axios');
const FlightProvider = require('../base/FlightProvider');
const logger = require('../../utils/logger');
const logFlightApiCall = require('../../utils/flightApiLogger');

const PROVIDER = 'tripjack';

class TripjackProvider extends FlightProvider {
  constructor(config) {
    super(config);
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        apikey: this.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  async _post(path, body, logMeta = {}) {
    const endpoint = `${this.baseUrl}${path}`;
    const correlationId = logMeta.correlationId ?? null;
    const start = Date.now();
    let httpStatus = null;
    let responseData = null;
    let isError = false;
    let errorMessage = null;

    logger.info(`[TripjackProvider] POST ${endpoint}`);

    try {
      const res = await this.client.post(path, body);
      httpStatus = res.status;
      responseData = res.data;
      logger.info(`[TripjackProvider] POST ${path} → ${httpStatus} (${Date.now() - start}ms)`);
      return responseData;
    } catch (err) {
      httpStatus = httpStatus ?? err.response?.status ?? null;
      responseData = err.response?.data ?? null;
      isError = true;
      errorMessage = err.message;
      logger.error(`[TripjackProvider] POST ${path} failed → ${httpStatus}`, { errorMessage });
      throw err;
    } finally {
      logFlightApiCall({
        provider: PROVIDER,
        stage: logMeta.stage ?? path.split('/').pop(),
        endpoint,
        httpMethod: 'POST',
        httpStatus,
        requestPayload: body,
        responsePayload: responseData,
        durationMs: Date.now() - start,
        isError,
        errorMessage,
        correlationId,
        providerBookingId: logMeta.providerBookingId ?? null,
        flightBookingId: logMeta.flightBookingId ?? null,
        quoteId: logMeta.quoteId ?? null,
        bookingId: logMeta.bookingId ?? null,
        createdBy: logMeta.createdBy ?? null,
      });
    }
  }

  async _get(path, logMeta = {}) {
    const endpoint = `${this.baseUrl}${path}`;
    const start = Date.now();
    let httpStatus = null;
    let responseData = null;
    let isError = false;
    let errorMessage = null;

    logger.info(`[TripjackProvider] GET ${endpoint}`);

    try {
      const res = await this.client.get(path);
      httpStatus = res.status;
      responseData = res.data;
      logger.info(`[TripjackProvider] GET ${path} → ${httpStatus} (${Date.now() - start}ms)`);
      return responseData;
    } catch (err) {
      httpStatus = httpStatus ?? err.response?.status ?? null;
      responseData = err.response?.data ?? null;
      isError = true;
      errorMessage = err.message;
      logger.error(`[TripjackProvider] GET ${path} failed → ${httpStatus}`, { errorMessage });
      throw err;
    } finally {
      logFlightApiCall({
        provider: PROVIDER,
        stage: logMeta.stage ?? path.split('/').pop(),
        endpoint,
        httpMethod: 'GET',
        httpStatus,
        requestPayload: null,
        responsePayload: responseData,
        durationMs: Date.now() - start,
        isError,
        errorMessage,
        correlationId: logMeta.correlationId ?? null,
        createdBy: logMeta.createdBy ?? null,
      });
    }
  }

  async search(params, logMeta) {
    return this._post('/fms/v1/air-search-all', { searchQuery: params }, { stage: 'search', ...logMeta });
  }

  async review(priceIds, logMeta) {
    return this._post('/fms/v1/review', { priceIds }, { stage: 'review', ...logMeta });
  }

  async fareRule(id, flowType, logMeta) {
    return this._post('/fms/v2/farerule', { id, flowType }, { stage: 'fare-rule', ...logMeta });
  }

  async seatMap(bookingId, logMeta) {
    return this._post('/fms/v1/seat', { bookingId }, { stage: 'seat-map', ...logMeta });
  }

  async book(bookingData, logMeta) {
    return this._post('/oms/v1/air/book', bookingData, { stage: 'book', ...logMeta });
  }

  async fareValidate(bookingId, logMeta) {
    return this._post('/oms/v1/air/book/fare-validate', { bookingId }, { stage: 'fare-validate', ...logMeta });
  }

  async confirmFare(bookingId, logMeta) {
    return this._post('/oms/v1/air/fare-validate', { bookingId }, { stage: 'fare-validate', ...logMeta });
  }

  async confirmBook(bookingId, paymentInfos, gstInfo, logMeta) {
    const body = { bookingId, paymentInfos };
    if (gstInfo) body.gstInfo = gstInfo;
    return this._post('/oms/v1/air/confirm-book', body, { stage: 'confirm-book', ...logMeta });
  }

  async bookingDetails(bookingId, requirePaxPricing = true, logMeta) {
    return this._post('/oms/v1/booking-details', { bookingId, requirePaxPricing }, { stage: 'booking-details', ...logMeta });
  }

  async unhold(bookingId, pnrs, logMeta) {
    return this._post('/oms/v1/air/unhold', { bookingId, pnrs }, { stage: 'unhold', ...logMeta });
  }

  async amendmentCharges(data, logMeta) {
    return this._post('/oms/v1/air/amendment/amendment-charges', data, { stage: 'amendment-charges', ...logMeta });
  }

  async submitAmendment(data, logMeta) {
    return this._post('/oms/v1/air/amendment/submit-amendment', data, { stage: 'submit-amendment', ...logMeta });
  }

  async amendmentDetails(amendmentId, logMeta) {
    return this._post('/oms/v1/air/amendment/amendment-details', { amendmentId }, { stage: 'amendment-details', ...logMeta });
  }

  async userBalance(logMeta) {
    return this._get('/ums/v1/user-detail', { stage: 'user-balance', ...logMeta });
  }
}

module.exports = TripjackProvider;
