const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const logger = require('../../utils/logger');
const { searchHotelsService, getHotelByIdService, liveSearchHotelsService } = require('../services/hotelService');

/**
 * Search hotels by city
 * @route GET /api/v1/hotels/search
 * @access Private (x-api-key required)
 * @description Returns a paginated list of hotels for a given internal region ID.
 *              Data is served entirely from the local database — no live TripJack calls.
 * @param {Object} req - Express request object
 * @param {Object} req.query.cityId - Internal region ID (required)
 * @param {Object} req.query.page - Page number for pagination (default: 1)
 * @param {Object} req.query.limit - Results per page (default: 20, max: 100)
 * @param {Object} res - Express response object
 * @returns {Object} JSON response with paginated hotel list and count
 */
const searchHotels = asyncHandler(async (req, res) => {
  const { cityId, page = '1', limit = '20' } = req.query;

  if (!cityId) {
    logger.warn('Hotel search attempt without cityId');
    return response(res, false, 400, 'cityId is required');
  }

  const hotels = await searchHotelsService({
    cityId: parseInt(cityId, 10),
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
  });

  logger.info(`Hotel search for cityId=${cityId} returned ${hotels.length} results`);

  return response(res, true, 200, 'Hotels fetched successfully', {
    count: hotels.length,
    page: parseInt(page, 10),
    hotels,
  });
});

/**
 * Get hotel by ID
 * @route GET /api/v1/hotels/:id
 * @access Private (x-api-key required)
 * @description Fetches full hotel detail including images and facilities
 *              from the local database by internal hotel ID.
 * @param {Object} req - Express request object
 * @param {Object} req.params.id - Internal hotel ID
 * @param {Object} res - Express response object
 * @returns {Object} JSON response with hotel detail, images, and facilities
 */
const getHotelById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const hotel = await getHotelByIdService(parseInt(id, 10));

  if (!hotel) {
    logger.warn(`Hotel not found for id=${id}`);
    return response(res, false, 404, 'Hotel not found');
  }

  logger.info(`Hotel detail fetched for id=${id}`);

  return response(res, true, 200, 'Hotel fetched successfully', { hotel });
});

const liveSearchHotels = asyncHandler(async (req, res) => {
  const { cityId, checkIn, checkOut, rooms, currency, nationality, timeoutMs } = req.body;

  logger.info(`Live hotel search: cityId=${cityId}, checkIn=${checkIn}, checkOut=${checkOut}`);

  const result = await liveSearchHotelsService({ cityId, checkIn, checkOut, rooms, currency, nationality, timeoutMs });

  logger.info(`Live hotel search returned ${result.totalResults} hotels for cityId=${cityId}`);

  return response(res, true, 200, 'Hotels fetched successfully', result);
});

module.exports = { searchHotels, getHotelById, liveSearchHotels };
