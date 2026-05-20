function auth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized — invalid or missing x-api-key' });
  }
  next();
}

module.exports = auth;
