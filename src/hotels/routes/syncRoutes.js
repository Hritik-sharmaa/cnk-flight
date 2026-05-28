const { Router } = require('express');
const auth = require('../../middleware/auth');
const { validateSync } = require('../validators/syncValidator');
const { triggerCitySync, triggerHotelSync } = require('../controllers/syncController');

const router = Router();

router.use(auth);

router.post('/cities', validateSync, triggerCitySync);
router.post('/hotels', validateSync, triggerHotelSync);

module.exports = router;
