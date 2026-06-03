const flightService = require('../services/flightService');

const wrap = (fn) => async (req, res, next) => {
  try {
    const result = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

const search = wrap(async (req) => flightService.search(req.body));

const review = wrap(async (req) => flightService.review(req.body.priceIds));

const fareRule = wrap(async (req) => flightService.fareRule(req.body.id, req.body.flowType));

const seatMap = wrap(async (req) => flightService.seatMap(req.body.bookingId));

const book = wrap(async (req) => flightService.book(req.body));

const fareValidate = wrap(async (req) => flightService.fareValidate(req.body.bookingId));

const confirmFare = wrap(async (req) => flightService.confirmFare(req.body.bookingId));

const confirmBook = wrap(async (req) =>
  flightService.confirmBook(req.body.bookingId, req.body.paymentInfos, req.body.gstInfo)
);

const bookingDetails = wrap(async (req) =>
  flightService.bookingDetails(req.body.bookingId, req.body.requirePaxPricing)
);

const unhold = wrap(async (req) => flightService.unhold(req.body.bookingId, req.body.pnrs));

const amendmentCharges = wrap(async (req) => flightService.amendmentCharges(req.body));

const submitAmendment = wrap(async (req) => flightService.submitAmendment(req.body));

const amendmentDetails = wrap(async (req) => flightService.amendmentDetails(req.body.amendmentId));

const userBalance = wrap(async () => flightService.userBalance());

module.exports = {
  search,
  review,
  fareRule,
  seatMap,
  book,
  fareValidate,
  confirmFare,
  confirmBook,
  bookingDetails,
  unhold,
  amendmentCharges,
  submitAmendment,
  amendmentDetails,
  userBalance,
};
