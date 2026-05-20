const FlightProvider = require('../base/FlightProvider');

// TBO integration is not yet implemented.
// All methods throw a 501 error so the calling code fails clearly
// rather than silently doing nothing.
class TBOProvider extends FlightProvider {
  _notImplemented(method) {
    const err = new Error(`TBOProvider.${method}() is not yet implemented.`);
    err.statusCode = 501;
    throw err;
  }

  async search() { this._notImplemented('search'); }
  async review() { this._notImplemented('review'); }
  async fareRule() { this._notImplemented('fareRule'); }
  async seatMap() { this._notImplemented('seatMap'); }
  async book() { this._notImplemented('book'); }
  async fareValidate() { this._notImplemented('fareValidate'); }
  async confirmBook() { this._notImplemented('confirmBook'); }
  async bookingDetails() { this._notImplemented('bookingDetails'); }
  async unhold() { this._notImplemented('unhold'); }
  async amendmentCharges() { this._notImplemented('amendmentCharges'); }
  async submitAmendment() { this._notImplemented('submitAmendment'); }
  async amendmentDetails() { this._notImplemented('amendmentDetails'); }
  async userBalance() { this._notImplemented('userBalance'); }
}

module.exports = TBOProvider;
