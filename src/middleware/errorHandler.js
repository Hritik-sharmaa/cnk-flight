const logger = require('../utils/logger');
const response = require('../utils/response');

/**
 * Global error handler middleware
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} _next - Express next function
 * @returns {Object} Standardized JSON error response
 */
const errorHandler = (err, req, res, _next) => {
  logger.error(`${req.method} ${req.path} — ${err.message}`, { stack: err.stack });

  // Axios / provider HTTP errors
  if (err.response) {
    return response(res, false, err.response.status || 502, 'Provider API error', {
      details: err.response.data,
    });
  }

  // Supabase unique violation (23505)
  if (err.code === '23505') {
    logger.warn(`Supabase unique violation: ${err.message}`);
    return response(res, false, 409, 'Duplicate record — resource already exists');
  }

  // Supabase foreign key violation (23503)
  if (err.code === '23503') {
    return response(res, false, 400, 'Invalid reference — related record not found');
  }

  // Supabase row-level security / permission errors
  if (err.code === '42501') {
    return response(res, false, 403, 'Insufficient permissions');
  }

  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal server error';

  return response(res, false, statusCode, message);
};

module.exports = errorHandler;
