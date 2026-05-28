const { Router } = require('express');
const auth = require('../../middleware/auth');
const { validateCitySearch } = require('../validators/cityValidator');
const { searchCities } = require('../controllers/cityController');

const router = Router();

router.use(auth);

router.get('/search', validateCitySearch, searchCities);

module.exports = router;
