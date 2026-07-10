const asyncHandler = require('../../utils/asyncHandler');
const response = require('../../utils/response');
const logger = require('../../utils/logger');
const {
  searchHotelsService,
  getHotelByIdService,
  getHotelByTripjackIdService,
  liveSearchHotelsService,
  hotelDetailService,
  hotelReviewService,
  hotelBookService,
  confirmBookingService,
  bookingDetailsService,
  cancelBookingService,
} = require('../services/hotelService');

// ─── Step 0: DB hotel search ─────────────────────────────────────────────────

const searchHotels = asyncHandler(async (req, res) => {
  const { q, cityId, cityName, minRating, sortBy, page, limit } = req.query;

  const result = await searchHotelsService({
    q:         q ?? null,
    cityId:    cityId ? parseInt(cityId, 10) : null,
    cityName:  cityName ?? null,
    minRating: minRating ? parseFloat(minRating) : null,
    sortBy:    sortBy ?? 'rating_desc',
    page:      parseInt(page, 10),
    limit:     parseInt(limit, 10),
  });

  logger.info(`Hotel search q="${q ?? ''}" city="${cityName ?? cityId ?? 'N/A'}" rating>=${minRating ?? 0} → ${result.hotels.length}/${result.pagination.total}`);

  return response(res, true, 200, 'Hotels fetched successfully', result);
});

// ─── DB: single hotel by ID ──────────────────────────────────────────────────

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

// ─── DB: single hotel by TripJack hotel ID ───────────────────────────────────
// Used when a hotel comes from live search results (which carry tjHotelId,
// not an internal id) and may not have a hotels_inventory row yet.

const getHotelByTripjackId = asyncHandler(async (req, res) => {
  const { hid } = req.params;

  const hotel = await getHotelByTripjackIdService(hid);

  if (!hotel) {
    logger.warn(`Hotel not found for hid=${hid}`);
    return response(res, false, 404, 'Hotel not found');
  }

  logger.info(`Hotel detail fetched for hid=${hid}`);

  return response(res, true, 200, 'Hotel fetched successfully', { hotel });
});

// ─── Step 1: Live search ─────────────────────────────────────────────────────

const liveSearchHotels = asyncHandler(async (req, res) => {
  const { cityId, hids, checkIn, checkOut } = req.body;
  logger.info(`Live hotel search: cityId=${cityId ?? 'N/A'}, hids=${hids?.length ?? 0}, checkIn=${checkIn}, checkOut=${checkOut}`);

  // Pass full body — service spreads it straight to TripJack
  const result = await liveSearchHotelsService(req.body);

  logger.info(`Live hotel search returned ${result.pagination.total} total hotels`);

  return response(res, true, 200, 'Hotels fetched successfully', result);
});

// ─── Step 2: Dynamic Detail / Pricing ───────────────────────────────────────

const hotelDetail = asyncHandler(async (req, res) => {
  logger.info(`Hotel detail request: hid=${req.body.hid}`);

  const result = await hotelDetailService(req.body);

  return response(res, true, 200, 'Hotel detail fetched successfully', result);
});

// ─── Step 3: Review ─────────────────────────────────────────────────────────

const hotelReview = asyncHandler(async (req, res) => {
  logger.info(`Hotel review request: optionId=${req.body.optionId}, hid=${req.body.hid}`);

  const result = await hotelReviewService(req.body);

  return response(res, true, 200, 'Hotel review completed successfully', result);
});

// ─── Step 4: Book ───────────────────────────────────────────────────────────

const hotelBook = asyncHandler(async (req, res) => {
  logger.info(`Hotel book request: bookingId=${req.body.bookingId}`);

  const result = await hotelBookService(req.body);

  return response(res, true, 200, 'Hotel booking initiated successfully', result);
});

// ─── Confirm Booking (ON_HOLD → confirmed) ───────────────────────────────────

const confirmBooking = asyncHandler(async (req, res) => {
  logger.info(`Confirm booking request: bookingId=${req.body.bookingId}`);

  const result = await confirmBookingService(req.body);

  return response(res, true, 200, 'Booking confirmation initiated successfully', result);
});

// ─── Booking Details (poll) ──────────────────────────────────────────────────

const bookingDetails = asyncHandler(async (req, res) => {
  logger.info(`Booking details request: bookingId=${req.body.bookingId}`);

  const result = await bookingDetailsService(req.body);

  return response(res, true, 200, 'Booking details fetched successfully', result);
});

// ─── Cancel Booking ──────────────────────────────────────────────────────────

const cancelBooking = asyncHandler(async (req, res) => {
  logger.info(`Cancel booking request: bookingId=${req.body.bookingId}`);

  const result = await cancelBookingService(req.body);

  return response(res, true, 200, 'Booking cancelled successfully', result);
});

module.exports = {
  searchHotels,
  getHotelById,
  getHotelByTripjackId,
  liveSearchHotels,
  hotelDetail,
  hotelReview,
  hotelBook,
  confirmBooking,
  bookingDetails,
  cancelBooking,
};
