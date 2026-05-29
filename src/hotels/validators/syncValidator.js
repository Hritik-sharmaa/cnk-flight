// Sync endpoints take no request body for Phase 1.
// This module is a placeholder for future validation (e.g. date-range or city-scoped sync).
function validateSync(req, res, next) {
  next();
}

module.exports = { validateSync };
