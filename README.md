# cnk-flight — Flight Microservice

A standalone Node.js + Express flight API server for Cox & Kings. Supports search, review, booking, amendments, and cancellations. Built with a **factory pattern** — switching flight providers (Tripjack, Travclan, TBO) requires only two `.env` changes, no code changes.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in your values
cp .env.example .env

# 3. Start the server
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

> This service is **stateless**. It proxies and translates calls to the active flight provider — it does not read or write any database. Persistence (e.g. `flight_bookings`, `flight_passengers`, status transitions, hold expiry) is the caller's responsibility (handled by the `flight-*` Supabase edge functions in `cnkb2b`).

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
      _meta: { createdBy: 'agent@coxandkings.com' }, // optional — the caller may persist this on its side
    }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}
```

---

## Architecture

This is a **stateless wrapper microservice** that normalizes multiple flight GDS providers (Tripjack, Travclan, TBO) behind one REST API. The caller talks only to this service — it never learns which provider is active. Switching providers is two `.env` lines, no code changes.

The design is a classic **factory + strategy** pattern:

- **One abstract contract** every provider must implement ([FlightProvider.js](src/providers/base/FlightProvider.js))
- **One concrete class per provider** ([TripjackProvider.js](src/providers/tripjack/TripjackProvider.js), Travclan, TBO)
- **One factory** that reads `FLIGHT_PROVIDER` from env and hands back the right instance ([FlightProviderFactory.js](src/providers/FlightProviderFactory.js))
- **One mapper per provider** that normalizes raw upstream JSON to a stable shape the caller can rely on ([tripjackMapper.js](src/providers/tripjack/tripjackMapper.js))

### Request flow

```
HTTP request
    │
    ▼
server.js  →  app.js          (helmet, cors, json, morgan)
    │
    ▼
routes/flightRoutes.js        (URL → handler)
    │
    ▼
middleware/auth.js            (x-api-key check)
    │
    ▼
middleware/validateRequest.js (Joi schema per endpoint; strips unknown keys)
    │
    ▼
controllers/flightController  (thin: wraps result in { success, data })
    │
    ▼
services/flightService        (orchestration + response mapping)
    │
    ▼
providers/FlightProviderFactory.getProvider()
    │
    ▼
TripjackProvider | TravclanProvider | TBOProvider
    │
    ▼
Upstream GDS API
    │
    ▼
providers/<name>/<mapper>     (normalizes raw provider response)
    │
    ▼
{ success: true, data: <normalized> }
```

### Layer responsibilities

| Layer | File | Responsibility |
|---|---|---|
| Entry | [server.js](server.js) | Boots HTTP server |
| App | [src/app.js](src/app.js) | Express setup, global middleware, mounts routes, error handler |
| Routes | [src/routes/flightRoutes.js](src/routes/flightRoutes.js) | URL → validation + controller; applies `auth` to all `/api/v1/flights/*` |
| Auth | [src/middleware/auth.js](src/middleware/auth.js) | Checks `x-api-key` against `INTERNAL_API_KEY` |
| Validation | [src/middleware/validateRequest.js](src/middleware/validateRequest.js) | Joi schema per endpoint; `stripUnknown` drops provider-foreign keys; top-level `_meta` is allowed through then stripped by the service before forwarding to the provider |
| Controllers | [src/controllers/flightController.js](src/controllers/flightController.js) | Thin HTTP wrappers — a single `wrap()` helper turns each handler into `res.json({success, data})` and forwards errors to `errorHandler` |
| Service | [src/services/flightService.js](src/services/flightService.js) | Calls the active provider, applies the right mapper, and orchestrates multi-step flows (e.g. `confirmBook` runs `confirmFare` first) |
| Factory | [src/providers/FlightProviderFactory.js](src/providers/FlightProviderFactory.js) | Reads `FLIGHT_PROVIDER` once; returns a cached singleton |
| Base | [src/providers/base/FlightProvider.js](src/providers/base/FlightProvider.js) | Abstract class — 14 methods every provider must implement; missing methods throw |
| Providers | [tripjack/](src/providers/tripjack/), [travclan/](src/providers/travclan/), [tbo/](src/providers/tbo/) | One folder per upstream GDS; Travclan & TBO are stubs returning 501 |
| Mappers | [tripjack/tripjackMapper.js](src/providers/tripjack/tripjackMapper.js) | Normalize raw provider JSON → the shape documented in API Endpoints above |
| Error | [src/middleware/errorHandler.js](src/middleware/errorHandler.js) | Centralized formatter — converts Axios provider errors to `502` with provider details, everything else to `{success:false, error}` |

### How the multi-provider wrapper works

1. **Contract** — `FlightProvider` declares one async method per supported operation: `search`, `review`, `fareRule`, `seatMap`, `book`, `fareValidate`, `confirmFare`, `confirmBook`, `bookingDetails`, `unhold`, `amendmentCharges`, `submitAmendment`, `amendmentDetails`, `userBalance`. Each unimplemented method throws a clear error so partial integrations fail fast.
2. **Factory** — `getProvider()` reads `FLIGHT_PROVIDER` once, looks up the class in a `{ tripjack, travclan, tbo }` map, news it up with `{ apiKey, baseUrl }` from env, and caches the instance for the process lifetime. `resetProvider()` exists for tests / env reload.
3. **Service translation** — every service function does the same three steps: `getProvider().<method>(...)` → run the provider-specific mapper → return. Today only Tripjack has a mapper; when Travclan or TBO are wired up they get their own mappers and the service grows one more branch — the controller and the HTTP contract stay identical.
4. **Response shape** — controllers always emit `{ success, data }`; mappers also expose `data.raw` so callers can drill into the unmodified provider response when they need to.

### What each controller does

Controllers are deliberately one-liners — all real logic lives in `flightService`. Mapping:

| Endpoint | Controller | What the service does |
|---|---|---|
| `POST /search` | `c.search` | `provider.search(params)`, normalize via `mapSearchResult` |
| `POST /review` | `c.review` | `provider.review(priceIds)`, normalize via `mapReviewResult` (returns `bookingId`) |
| `POST /fare-rule` | `c.fareRule` | Fetch refund/change rules, normalize via `mapFareRule` |
| `POST /seat-map` | `c.seatMap` | Fetch seat layout, normalize via `mapSeatMap` |
| `POST /book` | `c.book` | Strip `_meta`, forward payload to `provider.book()` (instant or hold) |
| `POST /fare-validate` | `c.fareValidate` | Revalidate a held booking's fare |
| `POST /confirm-fare` | `c.confirmFare` | Tripjack pre-ticket fare check |
| `POST /confirm-book` | `c.confirmBook` | **Orchestrated**: runs `confirmFare` first; throws on fare alert / err `1059` (hold expired); then `confirmBook(bookingId, paymentInfos)` |
| `POST /booking-details` | `c.bookingDetails` | Fetch PNR/ticket status, normalize via `mapBookingDetails` |
| `POST /unhold` | `c.unhold` | Release a held booking without ticketing |
| `POST /amendment/charges` | `c.amendmentCharges` | Preview cancellation charges |
| `POST /amendment/submit` | `c.submitAmendment` | Submit cancellation, returns `amendmentId` |
| `POST /amendment/details` | `c.amendmentDetails` | Poll amendment status |
| `GET /balance` | `c.userBalance` | Provider wallet balance |

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
│   │   └── flightService.js              # Business logic, provider calls
│   └── middleware/
│       ├── auth.js                       # x-api-key validation
│       ├── errorHandler.js               # Centralized error formatting
│       └── validateRequest.js            # Joi body validation per endpoint
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
- Emergency contact (`contactInfo`) is only required when `conditions.iecr = true` in Review.
