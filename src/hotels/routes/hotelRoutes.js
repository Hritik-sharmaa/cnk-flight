const { Router } = require('express');
const auth = require('../../middleware/auth');
const {
  validateHotelSearch,
  validateLiveSearch,
  validateHotelDetail,
  validateHotelReview,
  validateHotelBook,
  validateBookingDetails,
  validateCancelBooking,
} = require('../validators/hotelValidator');
const {
  searchHotels,
  getHotelById,
  liveSearchHotels,
  hotelDetail,
  hotelReview,
  hotelBook,
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
// POST /hotels/booking/details  — poll status after booking
router.post('/booking/details', validateBookingDetails, bookingDetails);

// POST /hotels/booking/cancel — cancel a confirmed booking
router.post('/booking/cancel', validateCancelBooking, cancelBooking);

// ─── Static DB lookup ────────────────────────────────────────────────────────
// GET  /hotels/:id
router.get('/:id', getHotelById);

module.exports = router;
