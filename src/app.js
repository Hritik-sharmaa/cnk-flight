const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const healthRoutes = require('./routes/healthRoutes');
const flightRoutes = require('./routes/flightRoutes');
const iciciRoutes = require('./routes/iciciRoutes');
const hotelRoutes = require('./hotels/index');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors({
  // origin: (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean),
  origin: '*',
  credentials: true,
}));
app.use(express.json());
app.use(morgan('dev'));

app.use('/health', healthRoutes);
app.use('/api/v1/flights', flightRoutes);
app.use('/api/v1/icici', iciciRoutes);
app.use('/api/v1/hotels', hotelRoutes);

app.use(errorHandler);

module.exports = app;
