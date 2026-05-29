/**
 * Utility function to send standardized JSON responses
 *
 * @param {Object} res - Express response object (REQUIRED)
 * @param {boolean} [success=true] - Indicates if the request was successful
 * @param {number} [statusCode=200] - HTTP status code for the response
 * @param {string} [message] - Optional response message
 * @param {*} [data] - Optional data to include in the response
 * @returns {Object} Express response object with formatted JSON
 */
function response(res, success = true, statusCode = 200, message, data) {
  const result = { success };

  if (message !== undefined && message !== null) result.message = message;
  if (data !== undefined && data !== null) result.data = data;

  return res.status(statusCode).json(result);
}

module.exports = response;
