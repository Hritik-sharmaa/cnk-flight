const { Router } = require('express');
const auth = require('../middleware/auth');
const c = require('../controllers/flight');
const syncRoutes = require('../flights/routes/syncRoutes');

const router = Router();

router.use(auth);

router.use('/sync',               syncRoutes);

router.post('/search',            c.search);
router.post('/review',            c.review);
router.post('/fare-rule',         c.fareRule);
router.post('/seat-map',          c.seatMap);
router.post('/book',              c.book);
router.post('/fare-validate',     c.fareValidate);
router.post('/confirm-fare',      c.confirmFare);
router.post('/confirm-book',      c.confirmBook);
router.post('/booking-details',   c.bookingDetails);
router.post('/unhold',            c.unhold);
router.post('/amendment/charges', c.amendmentCharges);
router.post('/amendment/submit',  c.submitAmendment);
router.post('/amendment/details', c.amendmentDetails);
router.get('/balance',            c.userBalance);

module.exports = router;
