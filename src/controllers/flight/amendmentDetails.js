const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const flightService = require('../../services/flightService');
const { requireFields } = require('../../utils/validate');

const amendmentDetails = asyncHandler(async (req, res) => {
  requireFields(req.body, ['amendmentId']);

  const result = await flightService.amendmentDetails(req.body.amendmentId);

  return response(res, true, 200, 'Amendment details fetched successfully', result);
});

module.exports = amendmentDetails;
