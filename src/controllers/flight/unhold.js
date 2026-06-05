const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const flightService = require('../../services/flightService');
const { requireFields, requireNonEmptyArray } = require('../../utils/validate');

const unhold = asyncHandler(async (req, res) => {
  requireFields(req.body, ['bookingId']);
  requireNonEmptyArray(req.body.pnrs, 'pnrs');

  const result = await flightService.unhold(req.body.bookingId, req.body.pnrs);

  return response(res, true, 200, 'Booking unheld successfully', result);
});

module.exports = unhold;
