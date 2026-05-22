/**
 * Abstract base class — every flight provider must extend this and implement all methods.
 * Calling any unimplemented method throws a clear error so incomplete integrations fail fast.
 */
class FlightProvider {
  constructor(config) {
    if (new.target === FlightProvider) {
      throw new Error('FlightProvider is abstract and cannot be instantiated directly.');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
  }

  async search(params) { throw new Error(`${this.constructor.name} does not implement search()`); }
  async review(priceIds) { throw new Error(`${this.constructor.name} does not implement review()`); }
  async fareRule(id, flowType) { throw new Error(`${this.constructor.name} does not implement fareRule()`); }
  async seatMap(bookingId) { throw new Error(`${this.constructor.name} does not implement seatMap()`); }
  async book(bookingData) { throw new Error(`${this.constructor.name} does not implement book()`); }
  async fareValidate(bookingId) { throw new Error(`${this.constructor.name} does not implement fareValidate()`); }
  /** Pre-ticket confirm fare — required step before confirmBook() in the Hold flow. */
  async confirmFare(bookingId) { throw new Error(`${this.constructor.name} does not implement confirmFare()`); }
  async confirmBook(bookingId, paymentInfos) { throw new Error(`${this.constructor.name} does not implement confirmBook()`); }
  async bookingDetails(bookingId, requirePaxPricing) { throw new Error(`${this.constructor.name} does not implement bookingDetails()`); }
  async unhold(bookingId, pnrs) { throw new Error(`${this.constructor.name} does not implement unhold()`); }
  async amendmentCharges(data) { throw new Error(`${this.constructor.name} does not implement amendmentCharges()`); }
  async submitAmendment(data) { throw new Error(`${this.constructor.name} does not implement submitAmendment()`); }
  async amendmentDetails(amendmentId) { throw new Error(`${this.constructor.name} does not implement amendmentDetails()`); }
  async userBalance() { throw new Error(`${this.constructor.name} does not implement userBalance()`); }
}

module.exports = FlightProvider;
