const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const flightService = require('../../services/flightService');
const { requireFields, requireNonEmptyArray } = require('../../utils/validate');

const amendmentCharges = asyncHandler(async (req, res) => {
  requireFields(req.body, ['bookingId']);
  requireNonEmptyArray(req.body.trips, 'trips');

  const result = await flightService.amendmentCharges(req.body);

  return response(res, true, 200, 'Amendment charges fetched successfully', result);
});

module.exports = amendmentCharges;
