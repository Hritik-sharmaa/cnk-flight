const Joi = require('joi');

// ─── Shared sub-schemas ─────────────────────────────────────────────────────

const roomSchema = Joi.object({
  adults: Joi.number().integer().min(1).max(9).required(),
  children: Joi.number().integer().min(0).max(6).default(0),
  childAge: Joi.array().items(Joi.number().integer().min(0).max(17)).default([]),
}).unknown(true); // allow TripJack room fields we haven't explicitly listed

// ─── DB search ──────────────────────────────────────────────────────────────
// At least one of q or cityId is required.
// q uses GIN full-text index; cityId uses B-tree region_id index.
// Both can be sent together to narrow a city search by keyword.

const searchHotelsSchema = Joi.object({
  q:         Joi.string().min(1).max(200).trim().optional(),
  cityId:    Joi.number().integer().optional(),
  cityName:  Joi.string().min(1).max(200).trim().optional(),
  minRating: Joi.number().min(1).max(5).optional(),
  sortBy:    Joi.string().valid('rating_desc', 'name_asc').default('rating_desc'),
  page:      Joi.number().integer().min(1).default(1),
  limit:     Joi.number().integer().min(1).max(100).default(20),
});

// ─── Step 1: Live search (Listing API) ──────────────────────────────────────
// cityId OR hids must be present (both can be sent together)
// All other TripJack fields (e.g. future additions) pass through via unknown(true)

const liveSearchSchema = Joi.object({
  cityId: Joi.number().integer().optional(),
  hids: Joi.array().items(Joi.string()).max(100).optional(),
  checkIn: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  checkOut: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  rooms: Joi.array().items(roomSchema).min(1).max(5).required(),
  currency: Joi.string().length(3).uppercase().default('INR'),
  nationality: Joi.string().default('100'),
  correlationId: Joi.string().optional(),
  timeoutMs: Joi.number().integer().min(5000).max(35000).optional(),
}).or('cityId', 'hids').unknown(true);

// ─── Step 2: Detail / Dynamic Pricing ───────────────────────────────────────

const hotelDetailSchema = Joi.object({
  correlationId: Joi.string().optional(),
  hid: Joi.string().required(),
  checkIn: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  checkOut: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  rooms: Joi.array().items(roomSchema).min(1).max(5).required(),
  currency: Joi.string().length(3).uppercase().default('INR'),
  nationality: Joi.string().default('100'),
  timeoutMs: Joi.number().integer().min(5000).max(35000).optional(),
}).unknown(true);

// ─── Step 3: Review ─────────────────────────────────────────────────────────

const hotelReviewSchema = Joi.object({
  correlationId: Joi.string().required(),
  optionId: Joi.string().required(),
  reviewHash: Joi.string().required(),
  hid: Joi.string().required(),
}).unknown(true);

// ─── Step 4: Book ───────────────────────────────────────────────────────────

const travelerInfoSchema = Joi.object({
  ti: Joi.string().valid('Mr', 'Mrs', 'Ms', 'Miss', 'Master').required(),
  pt: Joi.string().valid('ADULT', 'CHILD').required(),
  fN: Joi.string().required(),
  lN: Joi.string().required(),
  dob: Joi.string().optional(),
  pan: Joi.string().optional(),
  pNum: Joi.string().optional(),
  eD: Joi.string().optional(),
  iN: Joi.string().optional(),
  gstInfo: Joi.object({
    gstNumber: Joi.string().required(),
    registeredName: Joi.string().required(),
  }).unknown(true).optional(),
}).unknown(true);

const roomTravelerSchema = Joi.object({
  travellerInfo: Joi.array().items(travelerInfoSchema).min(1).required(),
}).unknown(true);

const gstInfoSchema = Joi.object({
  gstNumber: Joi.string().required(),
  registeredName: Joi.string().required(),
  bookingId: Joi.string().optional(),
  info: Joi.array().items(Joi.object().unknown(true)).optional(),
}).unknown(true);

const hotelBookSchema = Joi.object({
  bookingId: Joi.string().required(),
  type: Joi.string().valid('HOTEL').default('HOTEL'),
  roomTravellerInfo: Joi.array().items(roomTravelerSchema).min(1).required(),
  deliveryInfo: Joi.object({
    emails: Joi.array().items(Joi.string().email()).required(),
    contacts: Joi.array().items(Joi.string()).required(),
    code: Joi.array().items(Joi.string()).optional(),
  }).unknown(true).required(),
  paymentInfos: Joi.array().items(
    Joi.object({
      amount: Joi.number().required(),
      type: Joi.string().valid('HOTEL').default('HOTEL'),
    }).unknown(true)
  ).optional(),
  gstInfo: gstInfoSchema.optional(),
}).unknown(true);

// ─── Confirm booking (ON_HOLD → confirmed) ───────────────────────────────────

const confirmBookingSchema = Joi.object({
  bookingId: Joi.string().required(),
  paymentInfos: Joi.array().items(
    Joi.object({
      amount: Joi.number().required(),
      type: Joi.string().valid('HOTEL').default('HOTEL'),
    }).unknown(true)
  ).min(1).required(),
}).unknown(true);

// ─── Booking details (poll) ──────────────────────────────────────────────────

const bookingDetailsSchema = Joi.object({
  bookingId: Joi.string().required(),
}).unknown(true);

// ─── Cancel booking ──────────────────────────────────────────────────────────

const cancelBookingSchema = Joi.object({
  bookingId: Joi.string().required(),
}).unknown(true);

// ─── Middleware factories ────────────────────────────────────────────────────

function makeQueryValidator(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, { abortEarly: false });
    if (error) {
      return res.status(400).json({ success: false, error: error.details.map((d) => d.message).join(', ') });
    }
    req.query = value;
    next();
  };
}

function makeBodyValidator(schema) {
  return (req, res, next) => {
    // allowUnknown handled per-schema via .unknown(true); no stripUnknown here
    // so every extra TripJack field the client sends passes through unchanged
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({ success: false, error: error.details.map((d) => d.message).join(', ') });
    }
    req.body = value;
    next();
  };
}

module.exports = {
  validateHotelSearch:      makeQueryValidator(searchHotelsSchema),
  validateLiveSearch:       makeBodyValidator(liveSearchSchema),
  validateHotelDetail:      makeBodyValidator(hotelDetailSchema),
  validateHotelReview:      makeBodyValidator(hotelReviewSchema),
  validateHotelBook:        makeBodyValidator(hotelBookSchema),
  validateConfirmBooking:   makeBodyValidator(confirmBookingSchema),
  validateBookingDetails:   makeBodyValidator(bookingDetailsSchema),
  validateCancelBooking:    makeBodyValidator(cancelBookingSchema),
};
