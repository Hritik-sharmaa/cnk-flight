const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const flightService = require('../../services/flightService');
const { requireFields } = require('../../utils/validate');

const bookingDetails = asyncHandler(async (req, res) => {
  requireFields(req.body, ['bookingId']);

  const result = await flightService.bookingDetails(
    req.body.bookingId,
    req.body.requirePaxPricing
  );

  return response(res, true, 200, 'Booking details fetched successfully', result);
});

module.exports = bookingDetails;
