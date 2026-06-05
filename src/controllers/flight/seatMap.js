const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const flightService = require('../../services/flightService');
const { requireFields } = require('../../utils/validate');

const seatMap = asyncHandler(async (req, res) => {
  requireFields(req.body, ['bookingId']);

  const result = await flightService.seatMap(req.body.bookingId);

  return response(res, true, 200, 'Seat map fetched successfully', result);
});

module.exports = seatMap;
