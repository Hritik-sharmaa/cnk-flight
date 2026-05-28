const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const logger = require('../../utils/logger');
const { syncCities, syncHotels } = require('../services/syncService');

/**
 * Trigger city sync from TripJack static API
 * @route POST /api/v1/hotels/sync/cities
 * @access Internal (x-api-key required)
 * @description Fetches all cities/regions from TripJack's paginated static endpoint
 *              and upserts them into the regions table. Writes a sync log on completion.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} JSON response with sync result and total records processed
 */
const triggerCitySync = asyncHandler(async (req, res) => {
  logger.info('City sync triggered');

  const result = await syncCities();

  logger.info(`City sync completed — ${result.recordsProcessed} records processed`);

  return response(res, true, 200, 'City sync completed successfully', {
    recordsProcessed: result.recordsProcessed,
  });
});

/**
 * Trigger hotel sync from TripJack static API
 * @route POST /api/v1/hotels/sync/hotels
 * @access Internal (x-api-key required)
 * @description Fetches all hotels from TripJack's paginated static endpoint
 *              and upserts them into the hotels table. Writes a sync log on completion.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} JSON response with sync result and total records processed
 */
const triggerHotelSync = asyncHandler(async (req, res) => {
  logger.info('Hotel sync triggered');

  const result = await syncHotels();

  logger.info(`Hotel sync completed — ${result.recordsProcessed} records processed`);

  return response(res, true, 200, 'Hotel sync completed successfully', {
    recordsProcessed: result.recordsProcessed,
  });
});

module.exports = { triggerCitySync, triggerHotelSync };
