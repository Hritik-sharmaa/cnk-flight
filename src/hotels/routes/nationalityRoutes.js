const { Router } = require('express');
const auth = require('../../middleware/auth');
const { validateUpsertNationality, validateSearchNationality } = require('../validators/nationalityValidator');
const { upsertNationality, searchNationalities } = require('../controllers/nationalityController');

const router = Router();

router.use(auth);

router.get('/search', validateSearchNationality, searchNationalities);
router.post('/', validateUpsertNationality, upsertNationality);

module.exports = router;
