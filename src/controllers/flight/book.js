const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const flightService = require('../../services/flightService');
const { requireFields, requireNonEmptyArray } = require('../../utils/validate');

const book = asyncHandler(async (req, res) => {
  requireFields(req.body, ['bookingId']);
  requireNonEmptyArray(req.body.travellerInfo, 'travellerInfo');

  const result = await flightService.book(req.body);

  return response(res, true, 200, 'Booking initiated successfully', result);
});

module.exports = book;
