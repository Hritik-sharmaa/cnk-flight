const { Router } = require('express');
const auth = require('../../middleware/auth');
const {
  validateHotelSearch,
  validateLiveSearch,
  validateHotelDetail,
  validateHotelReview,
  validateHotelBook,
  validateConfirmBooking,
  validateBookingDetails,
  validateCancelBooking,
} = require('../validators/hotelValidator');
const {
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
} = require('../controllers/hotelController');

const router = Router();

router.use(auth);

// ─── DB search ───────────────────────────────────────────────────────────────
// GET  /hotels/search?cityId=&page=&limit=
router.get('/search', validateHotelSearch, searchHotels);

// ─── Booking flow ────────────────────────────────────────────────────────────
// Step 1 — Live search (TripJack Listing)
// POST /hotels/search/live
router.post('/search/live', validateLiveSearch, liveSearchHotels);

// Step 2 — Dynamic pricing / detail
// POST /hotels/detail
router.post('/detail', validateHotelDetail, hotelDetail);

// Step 3 — Review (confirm price + availability before booking)
// POST /hotels/review
router.post('/review', validateHotelReview, hotelReview);

// Step 4 — Book
// POST /hotels/book
router.post('/book', validateHotelBook, hotelBook);

// ─── Booking management ───────────────────────────────────────────────────────
// POST /hotels/booking/confirm — confirm an ON_HOLD booking (attach payment)
router.post('/booking/confirm', validateConfirmBooking, confirmBooking);

// POST /hotels/booking/details  — poll status after booking
router.post('/booking/details', validateBookingDetails, bookingDetails);

// POST /hotels/booking/cancel — cancel a confirmed booking
router.post('/booking/cancel', validateCancelBooking, cancelBooking);

// ─── Static DB lookup ────────────────────────────────────────────────────────
// GET  /hotels/detail/:hid — by TripJack hotel ID (from live search results;
//                            seeds the inventory row on first view if missing)
router.get('/detail/:hid', getHotelByTripjackId);

// GET  /hotels/:id — by internal id (already known, e.g. from DB search)
router.get('/:id', getHotelById);

module.exports = router;
