const { Router } = require('express');
const { msgHold, misPosting } = require('../controllers/iciciController');

const router = Router();

// No auth middleware — ICICI Bank calls these endpoints directly
router.post('/msg-hold', msgHold);
router.post('/mis-posting', misPosting);

module.exports = router;
