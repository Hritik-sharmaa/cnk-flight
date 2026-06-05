const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const flightService = require('../../services/flightService');
const { requireFields, requireNonEmptyArray } = require('../../utils/validate');

const confirmBook = asyncHandler(async (req, res) => {
  requireFields(req.body, ['bookingId']);
  requireNonEmptyArray(req.body.paymentInfos, 'paymentInfos');

  const result = await flightService.confirmBook(
    req.body.bookingId,
    req.body.paymentInfos,
    req.body.gstInfo
  );

  return response(res, true, 200, 'Booking confirmed successfully', result);
});

module.exports = confirmBook;
