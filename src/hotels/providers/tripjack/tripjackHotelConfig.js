/**
 * All TripJack hotel API constants in one place.
 * Import from here — never hardcode URLs or paths elsewhere.
 *
 * TripJack uses three separate services (v3 production URLs confirmed by TripJack):
 *   HMS    — live search, pricing, review, static content, nationality  (hms-search.tripjack.com)
 *   Static — hotel inventory sync                                       (hms-search.tripjack.com)
 *   Booker — booking, details, cancel                                   (hms-booker.tripjack.com)
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
  // Static content sync (HMS service)
  CITY_LIST:                 '/hms/v3/content/fetch-city-regionIds',          // GET  — HMS
  HOTEL_MAPPING_SYNC:        '/hms/v3/content/fetch-hotel-mapping-sync',       // POST — HMS type:NEW|UPDATE
  HOTEL_DELETED_MAPPING_SYNC: '/hms/v3/content/fetch-deleted-hotel-mapping',   // POST — HMS type:DELETE
  HOTEL_CONTENT:             '/hms/v3/content/fetch-hotel-content',            // POST — HMS (full content, max 100 IDs/req)
  HOTEL_STATIC_DETAIL:       '/hms/v3/hotel/static-detail',                    // POST — HMS (single hotel, full content — on-demand detail cache)
  NATIONALITY_LIST:          '/hms/v3/nationality-info',                       // GET  — HMS (full nationality/country list, no pagination)

  // Booking flow (Steps 1–4)
  LISTING:             '/hms/v3/hotel/listing',                   // POST — HMS  (Step 1: Search)
  DETAIL:              '/hms/v3/hotel/pricing',                   // POST — HMS  (Step 2: Dynamic Detail/Pricing)
  REVIEW:              '/hms/v3/hotel/review',                    // POST — HMS  (Step 3: Review)
  BOOK:                '/oms/v3/hotel/book',                      // POST — Booker (Step 4: Book)

  // Booking management
  CONFIRM_BOOKING:     '/oms/v3/hotel/confirm-book',              // POST — Booker (Step 5: Confirm ON_HOLD booking)
  BOOKING_DETAILS:     '/oms/v3/hotel/booking-details',           // POST — Booker
  CANCEL_BOOKING:      '/oms/v3/hotel/cancel-booking',            // POST — Booker (append /{bookingId})
};

const PAGINATION = {
  CITY_LIMIT:         2000,  // max records per city page
  HOTEL_MAPPING_SIZE: 2000,  // IDs returned per fetch-hotel-mapping-sync page
  HOTEL_CONTENT_SIZE: 100,   // max IDs per fetch-hotel-content request
};

module.exports = { BASE_URLS, ENDPOINTS, PAGINATION };
