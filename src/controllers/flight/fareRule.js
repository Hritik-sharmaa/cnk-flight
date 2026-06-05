const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const flightService = require('../../services/flightService');
const { requireFields } = require('../../utils/validate');

const fareRule = asyncHandler(async (req, res) => {
  requireFields(req.body, ['id', 'flowType']);

  const result = await flightService.fareRule(req.body.id, req.body.flowType);

  return response(res, true, 200, 'Fare rule fetched successfully', result);
});

module.exports = fareRule;
