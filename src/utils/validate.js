/**
 * Reusable request-validation helpers.
 *
 * These throw plain Errors tagged with `statusCode = 400`, which the global
 * errorHandler middleware turns into a standardized `{ success:false, message }`
 * response. Use them inside asyncHandler-wrapped controllers.
 */

/**
 * Build a 400 Bad Request error.
 * @param {string} message
 * @returns {Error}
 */
const badRequest = (message) => {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
};

/**
 * Throw if any listed field is missing/empty on the given object.
 * @param {Object} body
 * @param {string[]} fields
 */
const requireFields = (body, fields) => {
  for (const f of fields) {
    const v = body?.[f];
    if (v === undefined || v === null || v === '') throw badRequest(`${f} is required`);
  }
};

/**
 * Throw if the value is not a non-empty array.
 * @param {*} value
 * @param {string} name
 */
const requireNonEmptyArray = (value, name) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw badRequest(`${name} is required and must be a non-empty array`);
  }
};

module.exports = { badRequest, requireFields, requireNonEmptyArray };
