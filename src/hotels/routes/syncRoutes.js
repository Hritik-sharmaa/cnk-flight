const { Router } = require('express');
const auth = require('../../middleware/auth');
const { validateSync } = require('../validators/syncValidator');
const {
  triggerCitySync,
  triggerSingleCitySync,
  triggerHotelSync,
  triggerDeletedHotelSync,
  triggerNationalitySync,
  purgeDetailCache,
  getSyncStatus,
} = require('../controllers/syncController');

const router = Router();

router.use(auth);

router.post('/cities', validateSync, triggerCitySync);
router.post('/city', validateSync, triggerSingleCitySync);
router.post('/hotels', validateSync, triggerHotelSync);
router.post('/hotels-deleted', validateSync, triggerDeletedHotelSync);
router.post('/nationalities', validateSync, triggerNationalitySync);
router.post('/purge-detail-cache', purgeDetailCache);
router.get('/status/:logId', getSyncStatus);

module.exports = router;
