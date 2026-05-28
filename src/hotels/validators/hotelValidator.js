const Joi = require('joi');

const searchHotelsSchema = Joi.object({
  cityId: Joi.number().integer().required(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

function validateHotelSearch(req, res, next) {
  const { error, value } = searchHotelsSchema.validate(req.query, { abortEarly: false });
  if (error) {
    return res.status(400).json({ success: false, error: error.details.map((d) => d.message).join(', ') });
  }
  req.query = value;
  next();
}

module.exports = { validateHotelSearch };
