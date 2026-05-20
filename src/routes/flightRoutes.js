const { Router } = require('express');
const auth = require('../middleware/auth');
const validate = require('../middleware/validateRequest');
const c = require('../controllers/flightController');

const router = Router();

router.use(auth);

router.post('/search',           validate('search'),           c.search);
router.post('/review',           validate('review'),           c.review);
router.post('/fare-rule',        validate('fareRule'),         c.fareRule);
router.post('/seat-map',         validate('seatMap'),          c.seatMap);
router.post('/book',             validate('book'),             c.book);
router.post('/fare-validate',    validate('fareValidate'),     c.fareValidate);
router.post('/confirm-book',     validate('confirmBook'),      c.confirmBook);
router.post('/booking-details',  validate('bookingDetails'),   c.bookingDetails);
router.post('/unhold',           validate('unhold'),           c.unhold);
router.post('/amendment/charges',validate('amendmentCharges'), c.amendmentCharges);
router.post('/amendment/submit', validate('amendmentCharges'), c.submitAmendment);
router.post('/amendment/details',validate('amendmentDetails'), c.amendmentDetails);
router.get('/balance',                                         c.userBalance);

module.exports = router;
