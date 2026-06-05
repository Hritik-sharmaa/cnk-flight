const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const flightService = require('../../services/flightService');
const { requireNonEmptyArray } = require('../../utils/validate');

const review = asyncHandler(async (req, res) => {
  requireNonEmptyArray(req.body.priceIds, 'priceIds');

  const result = await flightService.review(req.body.priceIds);

  return response(res, true, 200, 'Flight review fetched successfully', result);
});

module.exports = review;
