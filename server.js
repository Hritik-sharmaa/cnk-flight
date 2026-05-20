require('dotenv').config();
const app = require('./src/app');

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`[cnk-flight] Server running on port ${PORT} | provider: ${process.env.FLIGHT_PROVIDER || 'tripjack'} | env: ${process.env.NODE_ENV || 'development'}`);
});
