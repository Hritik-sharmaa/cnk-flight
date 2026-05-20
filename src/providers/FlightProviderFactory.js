const TripjackProvider = require('./tripjack/TripjackProvider');
const TravclanProvider = require('./travclan/TravclanProvider');
const TBOProvider = require('./tbo/TBOProvider');

const PROVIDERS = {
  tripjack: TripjackProvider,
  travclan: TravclanProvider,
  tbo: TBOProvider,
};

let _instance = null;

function getProvider() {
  if (_instance) return _instance;

  const name = (process.env.FLIGHT_PROVIDER || 'tripjack').toLowerCase();
  const Provider = PROVIDERS[name];

  if (!Provider) {
    throw new Error(
      `Unknown FLIGHT_PROVIDER "${name}". Supported values: ${Object.keys(PROVIDERS).join(', ')}`
    );
  }

  _instance = new Provider({
    apiKey: process.env.FLIGHT_API_KEY,
    baseUrl: process.env.FLIGHT_API_BASE_URL,
  });

  return _instance;
}

// Allow resetting the singleton in tests or on .env reload
function resetProvider() {
  _instance = null;
}

module.exports = { getProvider, resetProvider };
