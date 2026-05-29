const Joi = require('joi');

const searchHotelsSchema = Joi.object({
  cityId: Joi.number().integer().required(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const roomSchema = Joi.object({
  adults: Joi.number().integer().min(1).max(9).required(),
  children: Joi.number().integer().min(0).max(6).default(0),
  childAge: Joi.array().items(Joi.number().integer().min(0).max(17)).default([]),
});

const liveSearchSchema = Joi.object({
  cityId: Joi.number().integer().required(),
  checkIn: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  checkOut: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  rooms: Joi.array().items(roomSchema).min(1).max(5).required(),
  currency: Joi.string().length(3).uppercase().default('INR'),
  nationality: Joi.string().default('100'),
  timeoutMs: Joi.number().integer().min(5000).max(35000).optional(),
});

function validateHotelSearch(req, res, next) {
  const { error, value } = searchHotelsSchema.validate(req.query, { abortEarly: false });
  if (error) {
    return res.status(400).json({ success: false, error: error.details.map((d) => d.message).join(', ') });
  }
  req.query = value;
  next();
}

function validateLiveSearch(req, res, next) {
  const { error, value } = liveSearchSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({ success: false, error: error.details.map((d) => d.message).join(', ') });
  }
  req.body = value;
  next();
}

module.exports = { validateHotelSearch, validateLiveSearch };
