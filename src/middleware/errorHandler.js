function errorHandler(err, req, res, next) {
  const status = err.statusCode || err.status || 500;

  // Axios errors from provider HTTP calls
  if (err.response) {
    return res.status(err.response.status || 502).json({
      success: false,
      error: 'Provider API error',
      details: err.response.data,
    });
  }

  console.error(`[error] ${req.method} ${req.path} —`, err.message);

  res.status(status).json({
    success: false,
    error: err.message || 'Internal server error',
  });
}

module.exports = errorHandler;
