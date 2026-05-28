const { Router } = require('express');
const auth = require('../../middleware/auth');
const { validateHotelSearch } = require('../validators/hotelValidator');
const { searchHotels, getHotelById } = require('../controllers/hotelController');

const router = Router();

router.use(auth);

router.get('/search', validateHotelSearch, searchHotels);
router.get('/:id', getHotelById);

module.exports = router;
