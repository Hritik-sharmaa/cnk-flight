const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const flightService = require('../../services/flightService');

const userBalance = asyncHandler(async (req, res) => {
  const result = await flightService.userBalance();

  return response(res, true, 200, 'User balance fetched successfully', result);
});

module.exports = userBalance;
