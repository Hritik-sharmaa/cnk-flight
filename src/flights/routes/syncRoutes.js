const { Router } = require('express');
const auth = require('../../middleware/auth');
const { triggerDelhiFareSync, getSyncStatus } = require('../controllers/syncController');

const router = Router();

router.use(auth);

router.post('/delhi-fares', triggerDelhiFareSync);
router.get('/status/:logId', getSyncStatus);

module.exports = router;
