const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const logger = require('../../utils/logger');
const { searchCitiesService } = require('../services/cityService');

/**
 * Search cities and regions
 * @route GET /api/v1/hotels/cities/search
 * @access Private (x-api-key required)
 * @description Full-text search on the regions table using the query string.
 *              Returns matching cities with their supplier region IDs for use
 *              in downstream hotel search queries.
 * @param {Object} req - Express request object
 * @param {Object} req.query.q - Search query string (min 2 characters)
 * @param {Object} req.query.limit - Max results to return (default: 20, max: 100)
 * @param {Object} res - Express response object
 * @returns {Object} JSON response with matching city records and count
 */
const searchCities = asyncHandler(async (req, res) => {
  const { q, limit = '20' } = req.query;

  if (!q || q.trim().length < 2) {
    logger.warn('City search attempt with missing or too-short query', { q });
    return response(res, false, 400, 'Query must be at least 2 characters');
  }

  const cities = await searchCitiesService({ q: q.trim(), limit: parseInt(limit, 10) });

  logger.info(`City search for "${q}" returned ${cities.length} results`);

  return response(res, true, 200, 'Cities fetched successfully', {
    count: cities.length,
    cities,
  });
});

module.exports = { searchCities };
