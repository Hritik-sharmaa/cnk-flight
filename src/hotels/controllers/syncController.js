const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const logger = require('../../utils/logger');
const { syncCities, syncHotels } = require('../services/syncService');

/**
 * Trigger city sync from TripJack static API
 * @route POST /api/v1/hotels/sync/cities
 * @access Internal (x-api-key required)
 * @description Fetches all cities/regions from TripJack's paginated static endpoint
 *              and upserts them into the regions table. Pass ?mode=test to hit the
 *              TripJack sandbox; defaults to live.
 * @param {Object} req - Express request object
 * @param {Object} req.query.mode - 'test' | 'live' (default: 'live')
 * @param {Object} res - Express response object
 * @returns {Object} JSON response with sync result and total records processed
 */
const triggerCitySync = asyncHandler(async (req, res) => {
  const mode = req.query.mode; // undefined → client falls back to HOTEL_MODE env var → 'live'

  logger.info(`City sync triggered [mode=${mode ?? process.env.HOTEL_MODE ?? 'live'}]`);

  const result = await syncCities(mode);

  logger.info(`City sync completed [mode=${mode}] — ${result.recordsProcessed} records processed`);

  return response(res, true, 200, 'City sync completed successfully', {
    mode,
    recordsProcessed: result.recordsProcessed,
  });
});

/**
 * Trigger hotel sync from TripJack static API
 * @route POST /api/v1/hotels/sync/hotels
 * @access Internal (x-api-key required)
 * @description Fetches all hotels from TripJack's paginated static endpoint
 *              and upserts them into the hotels table. Pass ?mode=test to hit the
 *              TripJack sandbox; defaults to live.
 * @param {Object} req - Express request object
 * @param {Object} req.query.mode - 'test' | 'live' (default: 'live')
 * @param {Object} res - Express response object
 * @returns {Object} JSON response with sync result and total records processed
 */
const triggerHotelSync = asyncHandler(async (req, res) => {
  const mode = req.query.mode; // undefined → client falls back to HOTEL_MODE env var → 'live'

  logger.info(`Hotel sync triggered [mode=${mode ?? process.env.HOTEL_MODE ?? 'live'}]`);

  const result = await syncHotels(mode);

  logger.info(`Hotel sync completed [mode=${mode}] — ${result.recordsProcessed} records processed`);

  return response(res, true, 200, 'Hotel sync completed successfully', {
    mode,
    recordsProcessed: result.recordsProcessed,
  });
});

module.exports = { triggerCitySync, triggerHotelSync };
