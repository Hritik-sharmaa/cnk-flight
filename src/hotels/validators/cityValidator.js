const Joi = require('joi');

const searchCitiesSchema = Joi.object({
  q: Joi.string().min(2).max(100).required(),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

function validateCitySearch(req, res, next) {
  const { error, value } = searchCitiesSchema.validate(req.query, { abortEarly: false });
  if (error) {
    return res.status(400).json({ success: false, error: error.details.map((d) => d.message).join(', ') });
  }
  req.query = value;
  next();
}

module.exports = { validateCitySearch };
