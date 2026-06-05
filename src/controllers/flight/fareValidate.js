const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const flightService = require('../../services/flightService');
const { requireFields } = require('../../utils/validate');

const fareValidate = asyncHandler(async (req, res) => {
  requireFields(req.body, ['bookingId']);

  const result = await flightService.fareValidate(req.body.bookingId);

  return response(res, true, 200, 'Fare validated successfully', result);
});

module.exports = fareValidate;
