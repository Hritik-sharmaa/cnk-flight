const Joi = require('joi');

const upsertNationalitySchema = Joi.object({
  supplier_nationality_id: Joi.string().trim().min(1).max(20).required(),
  country_name: Joi.string().trim().min(1).max(200).required(),
  iso_code: Joi.string().trim().length(2).uppercase().optional(),
  is_default: Joi.boolean().optional(),
});

const searchNationalitySchema = Joi.object({
  q: Joi.string().trim().min(1).max(100).optional(),
  limit: Joi.number().integer().min(1).max(100).default(50),
});

function validateUpsertNationality(req, res, next) {
  const { error, value } = upsertNationalitySchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({ success: false, error: error.details.map((d) => d.message).join(', ') });
  }
  req.body = value;
  next();
}

function validateSearchNationality(req, res, next) {
  const { error, value } = searchNationalitySchema.validate(req.query, { abortEarly: false });
  if (error) {
    return res.status(400).json({ success: false, error: error.details.map((d) => d.message).join(', ') });
  }
  req.query = value;
  next();
}

module.exports = { validateUpsertNationality, validateSearchNationality };
