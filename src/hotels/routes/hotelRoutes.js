const { Router } = require('express');
const auth = require('../../middleware/auth');
const { validateHotelSearch, validateLiveSearch } = require('../validators/hotelValidator');
const { searchHotels, getHotelById, liveSearchHotels } = require('../controllers/hotelController');

const router = Router();

router.use(auth);

router.get('/search', validateHotelSearch, searchHotels);
router.post('/search/live', validateLiveSearch, liveSearchHotels);
router.get('/:id', getHotelById);

module.exports = router;
