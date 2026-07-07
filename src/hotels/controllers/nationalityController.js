const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const logger = require('../../utils/logger');
const { upsertNationalityService, searchNationalitiesService } = require('../services/nationalityService');

/**
 * @route POST /api/v1/hotels/nationalities
 * @access Private (x-api-key required)
 * @description Add or update a TripJack nationality/country ID. There is no
 *              documented TripJack "fetch nationality list" API, so entries
 *              are maintained manually as they're confirmed.
 */
const upsertNationality = asyncHandler(async (req, res) => {
  const nationality = await upsertNationalityService(req.body);
  logger.info(`Nationality upserted: ${nationality.country_name} (${nationality.supplier_nationality_id})`);
  return response(res, true, 200, 'Nationality saved successfully', { nationality });
});

/**
 * @route GET /api/v1/hotels/nationalities/search?q=&limit=
 * @access Private (x-api-key required)
 * @description List/search nationalities for the agent-facing selector. With
 *              no q, returns all rows (default nationality first).
 */
const searchNationalities = asyncHandler(async (req, res) => {
  const { q, limit } = req.query;
  const nationalities = await searchNationalitiesService({ q, limit });
  return response(res, true, 200, 'Nationalities fetched successfully', {
    count: nationalities.length,
    nationalities,
  });
});

module.exports = { upsertNationality, searchNationalities };
