/**
 * All TripJack hotel API constants in one place.
 * Import from here — never hardcode URLs or paths elsewhere.
 *
 * TripJack uses three separate services:
 *   HMS    — live search, pricing, review  (hms.tripjack.com)
 *   Static — hotel inventory sync          (tripjack.com)
 *   Booker — booking, details, cancel      (hotel-booker.tripjack.com)
 */

const BASE_URLS = {
  hms: {
    test: process.env.HOTEL_HMS_API_BASE_URL_TEST,
    live: process.env.HOTEL_HMS_API_BASE_URL_LIVE,
  },
  static: {
    test: process.env.HOTEL_STATIC_API_BASE_URL_TEST,
    live: process.env.HOTEL_STATIC_API_BASE_URL_LIVE,
  },
  booker: {
    test: process.env.HOTEL_BOOKER_API_BASE_URL_TEST,
    live: process.env.HOTEL_BOOKER_API_BASE_URL_LIVE,
  },
};

const ENDPOINTS = {
  // Static content sync
  CITY_LIST:       '/hms/v3/content/fetch-city-regionIds', // GET  — HMS
  HOTEL_LIST:      '/hms/v3/fetch-static-hotels',          // POST — Static

  // Booking flow (Steps 1–4)
  LISTING:         '/hms/v3/hotel/listing',                // POST — HMS  (Step 1: Search)
  DETAIL:          '/hms/v3/hotel/pricing',                // POST — HMS  (Step 2: Dynamic Detail/Pricing)
  REVIEW:          '/hms/v3/hotel/review',                 // POST — HMS  (Step 3: Review)
  BOOK:            '/oms/v3/hotel/book',                   // POST — Booker (Step 4: Book)

  // Booking management
  BOOKING_DETAILS: '/oms/v3/hotel/booking-details',        // POST — Booker
  CANCEL_BOOKING:  '/oms/v3/hotel/cancel-booking',         // POST — Booker (append /{bookingId})
};

const PAGINATION = {
  CITY_LIMIT: 2000,  // max records per city page (cursor-based)
};

module.exports = { BASE_URLS, ENDPOINTS, PAGINATION };
