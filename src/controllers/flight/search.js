const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const flightService = require('../../services/flightService');
const { requireFields, requireNonEmptyArray } = require('../../utils/validate');

const search = asyncHandler(async (req, res) => {
  requireFields(req.body, ['paxInfo', 'routeInfos']);
  requireNonEmptyArray(req.body.routeInfos, 'routeInfos');

  const result = await flightService.search(req.body);

  return response(res, true, 200, 'Flights fetched successfully', result);
});

module.exports = search;
