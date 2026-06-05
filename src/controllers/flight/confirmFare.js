const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const flightService = require('../../services/flightService');
const { requireFields } = require('../../utils/validate');

const confirmFare = asyncHandler(async (req, res) => {
  requireFields(req.body, ['bookingId']);

  const result = await flightService.confirmFare(req.body.bookingId);

  return response(res, true, 200, 'Fare confirmed successfully', result);
});

module.exports = confirmFare;
