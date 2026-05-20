# cnk-flight — Flight Microservice

A standalone Node.js + Express flight API server for Cox & Kings. Supports search, review, booking, amendments, and cancellations. Built with a **factory pattern** — switching flight providers (Tripjack, Travclan, TBO) requires only two `.env` changes, no code changes.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in your values
cp .env.example .env

# 3. Run the Supabase migration (once)
#    Paste supabase/migrations/001_flight_tables.sql into your Supabase SQL editor and run it

# 4. Start the server
npm start          # production
npm run dev        # development (nodemon, auto-restart)
```

Server starts on `http://localhost:3001` by default.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port. Default: `3001` |
| `NODE_ENV` | No | `development` or `production` |
| `INTERNAL_API_KEY` | Yes | Shared secret — all calling apps must send this in the `x-api-key` header |
| `FLIGHT_PROVIDER` | Yes | Active provider: `tripjack` / `travclan` / `tbo` |
| `FLIGHT_API_KEY` | Yes | API key for the active provider |
| `FLIGHT_API_BASE_URL` | Yes | Base URL for the active provider |
| `SUPABASE_URL` | Yes | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (not the anon key) |

### Switching Providers

Change only these two lines in `.env` — nothing else:

```env
# Tripjack (UAT)
FLIGHT_PROVIDER=tripjack
FLIGHT_API_KEY=your_tripjack_key
FLIGHT_API_BASE_URL=https://apitest.tripjack.com

# Tripjack (Production)
FLIGHT_PROVIDER=tripjack
FLIGHT_API_KEY=your_tripjack_key
FLIGHT_API_BASE_URL=https://tripjack.com

# Travclan (when integrated)
FLIGHT_PROVIDER=travclan
FLIGHT_API_KEY=your_travclan_key
FLIGHT_API_BASE_URL=https://travclan-api-url

# TBO (when integrated)
FLIGHT_PROVIDER=tbo
FLIGHT_API_KEY=your_tbo_key
FLIGHT_API_BASE_URL=https://tbo-api-url
```

> Travclan and TBO are stubbed — they return `501 Not Implemented` until their providers are built out.

---

## Authentication

Every request (except `GET /health`) must include the internal API key in the header:

```
x-api-key: your_internal_api_key
```

This key is set in `INTERNAL_API_KEY` on the flight server and must be the same value on the calling side (cnkb2b / cnk-website).

---

## API Endpoints

Base URL: `http://localhost:3001` (or your deployed URL)

All endpoints return:
```json
{ "success": true, "data": { ... } }
```
On error:
```json
{ "success": false, "error": "...", "details": [...] }
```

---

### `GET /health`

No auth required. Use this to verify the server is up and check which provider is active.

**Response:**
```json
{
  "success": true,
  "status": "ok",
  "provider": "tripjack",
  "environment": "development",
  "timestamp": "2026-05-18T10:00:00.000Z"
}
```

---

### `POST /api/v1/flights/search`

Search for available flights. Returns fare options with `priceId` values needed for the next step.

**Request body:**
```json
{
  "cabinClass": "ECONOMY",
  "paxInfo": {
    "ADULT": "1",
    "CHILD": "0",
    "INFANT": "0"
  },
  "routeInfos": [
    {
      "fromCityOrAirport": { "code": "DEL" },
      "toCityOrAirport": { "code": "BOM" },
      "travelDate": "2026-06-15"
    }
  ],
  "searchModifiers": {
    "isDirectFlight": false,
    "isConnectingFlight": false,
    "pft": "REGULAR"
  },
  "preferredAirline": [{ "code": "6E" }]
}
```

**Key fields in `data`:**
- `data.onward[]` — list of onward flight options
- `data.onward[].segments[]` — flight segments (airline, times, duration)
- `data.onward[].fareOptions[]` — fare options with pricing
- `data.onward[].fareOptions[].priceId` — **save this for the Review call**
- `data.onward[].fareOptions[].adult.totalFare` — total fare per adult
- `data.onward[].fareOptions[].refundable` — `0`=No, `1`=Yes, `2`=Partial
- `data.raw` — full unmodified provider response

**Route rules:**
- One-way: 1 `routeInfos` entry
- Domestic return: 2 `routeInfos` entries
- International return / multi-city: 2–6 `routeInfos` entries

> Price IDs expire in 30 minutes.

---

### `POST /api/v1/flights/review`

Revalidates fare and creates a booking session. Returns a `bookingId` used in all following steps.

**Request body:**
```json
{
  "priceIds": ["PRICE_ID_FROM_SEARCH"]
}
```

> Send 2 `priceIds` for domestic return (one onward + one return). Send 1 for everything else.

**Key fields in `data`:**
- `data.bookingId` — **save this for all subsequent calls**
- `data.sessionValidSeconds` — booking session expires in this many seconds
- `data.totalFare` — amount to charge the customer
- `data.conditions` — object that determines what fields are mandatory in the Book call:

| Condition field | Meaning |
|---|---|
| `conditions.isBA` | Hold booking allowed? |
| `conditions.isa` | Seat selection available? |
| `conditions.iecr` | Emergency contact required? |
| `conditions.gst.igm` | GST mandatory? |
| `conditions.dob.adobr` | Adult DOB required? |
| `conditions.dob.cdobr` | Child DOB required? |
| `conditions.pcs.pm` | Passport mandatory? (international) |
| `conditions.ipa` | PAN card required? |

> Always check `conditions` before building the Book request — missing mandatory fields will cause booking failure.

---

### `POST /api/v1/flights/fare-rule` _(optional)_

Fetch cancellation, date change, and no-show charges.

**Request body:**
```json
{
  "id": "PRICE_ID_or_BOOKING_ID",
  "flowType": "SEARCH"
}
```

| `flowType` | When to use |
|---|---|
| `SEARCH` | Pass the `priceId` from Search |
| `REVIEW` | Pass the `bookingId` from Review |
| `BOOKING_DETAIL` | Pass the `bookingId` after booking |

---

### `POST /api/v1/flights/seat-map` _(optional)_

Get seat layout. Only call this when `conditions.isa = true` in the Review response.

**Request body:**
```json
{
  "bookingId": "BOOKING_ID_FROM_REVIEW"
}
```

Seat codes from the response are passed in `travellerInfo[].ssrSeatInfos` in the Book call.

---

### `POST /api/v1/flights/book`

Book a flight. Supports **instant booking** (with payment) and **hold booking** (without payment).

**Instant book — include `paymentInfos`:**
```json
{
  "bookingId": "BOOKING_ID_FROM_REVIEW",
  "paymentInfos": [{ "amount": 5000 }],
  "deliveryInfo": {
    "emails": ["customer@email.com"],
    "contacts": ["+919500112233"]
  },
  "travellerInfo": [
    {
      "ti": "Mr",
      "pt": "ADULT",
      "fN": "John",
      "lN": "Doe",
      "dob": "1990-01-15",
      "pan": "ABCDE1234F",
      "ssrSeatInfos": [{ "key": "SEGMENT_ID", "code": "SEAT_CODE" }],
      "ssrMealInfos": [{ "key": "SEGMENT_ID", "code": "MEAL_CODE" }],
      "ssrBaggageInfos": [{ "key": "SEGMENT_ID", "code": "BAGGAGE_CODE" }]
    }
  ],
  "_meta": {
    "createdBy": "agent@coxandkings.com",
    "searchParams": { }
  }
}
```

**Hold book — omit `paymentInfos`:**
```json
{
  "bookingId": "BOOKING_ID_FROM_REVIEW",
  "deliveryInfo": { ... },
  "travellerInfo": [ ... ]
}
```

**Traveller fields:**

| Field | Required | Description |
|---|---|---|
| `ti` | Yes | Title: `Mr` / `Mrs` / `Ms` / `Master` |
| `pt` | Yes | `ADULT` / `CHILD` / `INFANT` |
| `fN` | Yes | First name |
| `lN` | Yes | Last name |
| `dob` | Conditional | Required if `conditions.dob.adobr = true` |
| `pan` | Conditional | Required if `conditions.ipa = true` |
| `pNum` | Conditional | Passport number — required for international |
| `eD` | Conditional | Passport expiry `YYYY-MM-DD` |
| `pNat` | Conditional | Passport nationality (2-letter, e.g. `IN`) |
| `pid` | Conditional | Passport issue date `YYYY-MM-DD` |

**`_meta` field** — internal metadata, stripped before sending to the provider:

| Field | Description |
|---|---|
| `_meta.createdBy` | Email or user ID of the agent/user creating the booking |
| `_meta.searchParams` | Original search params to store alongside the booking |

> The `paymentInfos[].amount` must equal `data.totalFare` from the Review response.

> For hold bookings, follow up with `/fare-validate` → `/confirm-book` to ticket.

---

### `POST /api/v1/flights/fare-validate`

Check that fare is still valid before ticketing a held booking.

**Request body:**
```json
{
  "bookingId": "BOOKING_ID"
}
```

---

### `POST /api/v1/flights/confirm-book`

Ticket a held booking with payment.

**Request body:**
```json
{
  "bookingId": "BOOKING_ID",
  "paymentInfos": [{ "amount": 5000 }]
}
```

---

### `POST /api/v1/flights/booking-details`

Get current booking status, PNR, and ticket numbers.

**Request body:**
```json
{
  "bookingId": "BOOKING_ID",
  "requirePaxPricing": true
}
```

**Key fields in `data`:**
- `data.status` — `SUCCESS` / `ON_HOLD` / `PENDING` / `CANCELLED` / `FAILED` / `ABORTED` / `UNCONFIRMED`
- `data.bookingId` — provider booking reference
- `data.amount` — amount charged
- `data.travellers[].pnrDetails` — map of `DEP-ARR: PNR`
- `data.travellers[].ticketNumberDetails` — map of `DEP-ARR: TicketNo`

---

### `POST /api/v1/flights/unhold`

Release a held booking without ticketing.

**Request body:**
```json
{
  "bookingId": "BOOKING_ID",
  "pnrs": ["PNR1"]
}
```

After calling this, verify by calling `/booking-details` — status should be `UNCONFIRMED`.

---

### `POST /api/v1/flights/amendment/charges`

Get cancellation charges before submitting.

**Request body:**
```json
{
  "bookingId": "BOOKING_ID",
  "type": "CANCELLATION",
  "remarks": "Customer requested cancellation",
  "trips": [
    {
      "src": "DEL",
      "dest": "BOM",
      "departureDate": "2026-06-15",
      "travellers": [
        { "fn": "John", "ln": "Doe" }
      ]
    }
  ]
}
```

---

### `POST /api/v1/flights/amendment/submit`

Submit the cancellation. Returns an `amendmentId` to poll with `/amendment/details`.

Same request body as `/amendment/charges`.

---

### `POST /api/v1/flights/amendment/details`

Poll the status of a submitted amendment.

**Request body:**
```json
{
  "amendmentId": "AMENDMENT_ID"
}
```

Status values: `REQUESTED` / `PENDING` / `SUCCESS` / `REJECTED`

> Poll every 10 seconds, up to 4–5 times if status is `REQUESTED`.

---

### `GET /api/v1/flights/balance`

Get the provider wallet balance.

**Response `data` includes:** `totalBalance`, `walletBalance`, `creditBalance`, `totalOutStanding`

---

## Complete Booking Flows

### Instant Booking
```
POST /search  →  POST /review  →  (optional) POST /fare-rule
                                  (optional) POST /seat-map
                              →  POST /book (with paymentInfos)
                              →  POST /booking-details
```

### Hold Booking
```
POST /search  →  POST /review  →  POST /book (without paymentInfos)
                              →  POST /fare-validate
                              →  POST /confirm-book (with paymentInfos)
                              →  POST /booking-details
```

### Cancellation
```
POST /amendment/charges  →  POST /amendment/submit  →  POST /amendment/details (poll)
```

---

## Supabase Tables

The migration file is at [supabase/migrations/001_flight_tables.sql](supabase/migrations/001_flight_tables.sql). Run it once in your Supabase SQL editor.

### `flight_bookings`

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Internal primary key |
| `provider` | TEXT | `tripjack` / `travclan` / `tbo` |
| `provider_booking_id` | TEXT | Booking ID from the provider |
| `status` | TEXT | `SUCCESS` / `ON_HOLD` / `PENDING` / `CANCELLED` / `FAILED` / `ABORTED` / `UNCONFIRMED` |
| `booking_type` | TEXT | `INSTANT` or `HOLD` |
| `total_fare` | NUMERIC | Total fare charged |
| `currency` | TEXT | Default `INR` |
| `search_params` | JSONB | Original search parameters |
| `booking_request` | JSONB | Full request sent to provider |
| `booking_response` | JSONB | Full response from provider |
| `created_by` | TEXT | Agent email or user ID (passed via `_meta.createdBy`) |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | Auto-updated on every status change |

### `flight_passengers`

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `flight_booking_id` | UUID | FK to `flight_bookings` |
| `passenger_type` | TEXT | `ADULT` / `CHILD` / `INFANT` |
| `title` | TEXT | `Mr` / `Mrs` / `Ms` / `Master` |
| `first_name` | TEXT | |
| `last_name` | TEXT | |
| `dob` | DATE | |
| `passport_number` | TEXT | |
| `passport_expiry` | DATE | |
| `passport_nationality` | TEXT | 2-letter country code |
| `pan_number` | TEXT | |

---

## Integration Example (cnkb2b / cnk-website)

```js
const FLIGHT_API_URL = 'http://localhost:3001'; // or deployed URL
const FLIGHT_API_KEY = process.env.CNK_FLIGHT_API_KEY; // same value as INTERNAL_API_KEY on the server

async function searchFlights(searchParams) {
  const res = await fetch(`${FLIGHT_API_URL}/api/v1/flights/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': FLIGHT_API_KEY,
    },
    body: JSON.stringify(searchParams),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}

async function reviewFlight(priceIds) {
  const res = await fetch(`${FLIGHT_API_URL}/api/v1/flights/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': FLIGHT_API_KEY },
    body: JSON.stringify({ priceIds }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data; // json.data.bookingId is what you need next
}

async function bookFlight(bookingPayload) {
  const res = await fetch(`${FLIGHT_API_URL}/api/v1/flights/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': FLIGHT_API_KEY },
    body: JSON.stringify({
      ...bookingPayload,
      _meta: { createdBy: 'agent@coxandkings.com' }, // optional — stored in Supabase
    }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}
```

---

## Project Structure

```
cnk-flight/
├── server.js                             # Entry point
├── src/
│   ├── app.js                            # Express setup, middleware, routes
│   ├── providers/
│   │   ├── FlightProviderFactory.js      # Reads FLIGHT_PROVIDER env, returns provider instance
│   │   ├── base/FlightProvider.js        # Abstract base — contract all providers must follow
│   │   ├── tripjack/
│   │   │   ├── TripjackProvider.js       # Full Tripjack implementation
│   │   │   └── tripjackMapper.js         # Normalizes Tripjack responses
│   │   ├── travclan/TravclanProvider.js  # Stub (501 until integrated)
│   │   └── tbo/TBOProvider.js            # Stub (501 until integrated)
│   ├── routes/
│   │   ├── flightRoutes.js               # All /api/v1/flights/* routes
│   │   └── healthRoutes.js               # GET /health
│   ├── controllers/flightController.js   # HTTP layer — calls flightService
│   ├── services/
│   │   ├── flightService.js              # Business logic, provider calls, DB sync
│   │   └── supabaseService.js            # Supabase read/write
│   ├── middleware/
│   │   ├── auth.js                       # x-api-key validation
│   │   ├── errorHandler.js               # Centralized error formatting
│   │   └── validateRequest.js            # Joi body validation per endpoint
│   └── lib/supabase.js                   # Supabase client (service role)
└── supabase/migrations/
    └── 001_flight_tables.sql             # flight_bookings + flight_passengers tables
```

---

## Adding a New Provider

1. Create `src/providers/yourprovider/YourProvider.js` extending `FlightProvider`
2. Implement all 13 methods (see [FlightProvider.js](src/providers/base/FlightProvider.js) for the contract)
3. Add it to the map in [FlightProviderFactory.js](src/providers/FlightProviderFactory.js)
4. Set `FLIGHT_PROVIDER=yourprovider` in `.env`

---

## Common Gotchas

- Price IDs expire in **30 minutes** — don't cache them
- `paymentInfos[].amount` must exactly equal `totalFare` from Review
- SSR segment `key` = the `id` from `sI[]` in the Review response, not a segment number
- For domestic return with `SPECIAL_RETURN` fare, both priceIds must be `SPECIAL_RETURN`
- GST `registeredName` max 35 chars, `address` max 70 chars
- Never end any provider URL with `/` — Tripjack returns an error
- Emergency contact (`contactInfo`) is only required when `conditions.iecr = true` in Review
