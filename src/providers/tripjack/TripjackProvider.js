const axios = require('axios');
const FlightProvider = require('../base/FlightProvider');

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

  async _post(path, body) {
    const response = await this.client.post(path, body);
    return response.data;
  }

  async _get(path) {
    const response = await this.client.get(path);
    return response.data;
  }

  async search(params) {
    return this._post('/fms/v1/air-search-all', { searchQuery: params });
  }

  async review(priceIds) {
    return this._post('/fms/v1/review', { priceIds });
  }

  async fareRule(id, flowType) {
    return this._post('/fms/v2/farerule', { id, flowType });
  }

  async seatMap(bookingId) {
    return this._post('/fms/v1/seat', { bookingId });
  }

  async book(bookingData) {
    return this._post('/oms/v1/air/book', bookingData);
  }

  async fareValidate(bookingId) {
    return this._post('/oms/v1/air/book/fare-validate', { bookingId });
  }

  /** Pre-ticket confirm fare (step 7 in Hold flow) — different from pre-book fareValidate (step 5). */
  async confirmFare(bookingId) {
    return this._post('/oms/v1/air/fare-validate', { bookingId });
  }

  async confirmBook(bookingId, paymentInfos) {
    return this._post('/oms/v1/air/confirm-book', { bookingId, paymentInfos });
  }

  async bookingDetails(bookingId, requirePaxPricing = true) {
    return this._post('/oms/v1/booking-details', { bookingId, requirePaxPricing });
  }

  async unhold(bookingId, pnrs) {
    return this._post('/oms/v1/air/unhold', { bookingId, pnrs });
  }

  async amendmentCharges(data) {
    return this._post('/oms/v1/air/amendment/amendment-charges', data);
  }

  async submitAmendment(data) {
    return this._post('/oms/v1/air/amendment/submit-amendment', data);
  }

  async amendmentDetails(amendmentId) {
    return this._post('/oms/v1/air/amendment/amendment-details', { amendmentId });
  }

  async userBalance() {
    return this._get('/ums/v1/user-detail');
  }
}

module.exports = TripjackProvider;
