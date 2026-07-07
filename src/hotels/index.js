const { Router } = require('express');
const syncRoutes = require('./routes/syncRoutes');
const cityRoutes = require('./routes/cityRoutes');
const nationalityRoutes = require('./routes/nationalityRoutes');
const hotelRoutes = require('./routes/hotelRoutes');

const router = Router();

router.use('/sync', syncRoutes);
router.use('/cities', cityRoutes);
router.use('/nationalities', nationalityRoutes);
router.use('/', hotelRoutes);

module.exports = router;
