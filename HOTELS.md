# Hotel Module — Developer Documentation

> **Scope:** Static hotel inventory sync and search.
> Live availability, pricing, and booking are Phase 2.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Tech Stack](#2-tech-stack)
3. [Environment Variables](#3-environment-variables)
4. [Folder Structure](#4-folder-structure)
5. [System Architecture](#5-system-architecture)
6. [How the Pieces Talk](#6-how-the-pieces-talk)
7. [Database Schema](#7-database-schema)
8. [API Reference](#8-api-reference)
9. [Mode Toggle (Test vs Live)](#9-mode-toggle-test-vs-live)
10. [Logging Strategy](#10-logging-strategy)
11. [Adding a New Supplier](#11-adding-a-new-supplier)
12. [Known Issues & TODOs](#12-known-issues--todos)
13. [Testing Guide](#13-testing-guide)

---

## 1. Overview

The hotel module is a **self-contained feature module** inside the `cnk-flight` Express.js microservice.

It is responsible for:

- Syncing static city/region and hotel data from TripJack into Supabase (PostgreSQL)
- Serving city search and hotel search from the local database (no live supplier calls on search)
- Logging every outbound TripJack call and every sync job to the database

The module is designed to be **supplier-agnostic** — hotels and cities are stored using an internal schema, not tightly coupled to TripJack's response structure. A second supplier (HotelBeds, TBO, etc.) can be added without touching the database schema.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (CommonJS) |
| Framework | Express.js |
| Database | Supabase (PostgreSQL) |
| HTTP Client | Axios |
| Validation | Joi |
| Logging | Winston + Supabase `api_request_logs` table |
| Auth | `x-api-key` header (shared with flight module) |

---

## 3. Environment Variables

Add these to your `.env` file:

```bash
# Supabase (hotels share the same instance as the rest of the app)
SUPABASE_URL=https://your-project.supabase.co        # or http://127.0.0.1:54321 for local
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# TripJack Hotel API
HOTEL_API_KEY=your_tripjack_api_key_here
HOTEL_API_BASE_URL_LIVE=https://api.tripjack.com
HOTEL_API_BASE_URL_TEST=https://apitest.tripjack.com

# Default API mode — 'test' for dev/staging, 'live' for production
# Can be overridden per-request with ?mode=test or ?mode=live
HOTEL_MODE=test
```

> **Note:** `HOTEL_MODE=test` in your dev `.env` means you never need to pass `?mode=test` in the query string during local development.

---

## 4. Folder Structure

```
src/
├── app.js                                   Express app — mounts all routes
├── server.js                                Entry point
│
├── db/
│   └── supabase.js                          Supabase client singleton
│
├── utils/
│   ├── asyncHandler.js                      Wraps async route handlers — passes errors to next()
│   ├── response.js                          Standardised JSON response helper
│   ├── logger.js                            Winston logger (console output, structured JSON)
│   └── logToDB.js                           Universal async function to write to api_request_logs
│
├── middleware/
│   ├── auth.js                              x-api-key header validation
│   ├── errorHandler.js                      Global error handler — uses response + logger
│   └── validateRequest.js                   Joi-based request validation (flight module)
│
└── hotels/                                  ← Complete hotel module (self-contained)
    │
    ├── index.js                             Module entry — combines all routers, exports one router
    │
    ├── routes/
    │   ├── syncRoutes.js                    POST /sync/cities, POST /sync/hotels
    │   ├── cityRoutes.js                    GET /cities/search
    │   └── hotelRoutes.js                   GET /search, GET /:id
    │
    ├── controllers/
    │   ├── syncController.js                Reads ?mode, calls syncService, returns response
    │   ├── cityController.js                Validates query, calls cityService, returns response
    │   └── hotelController.js               Validates params, calls hotelService, returns response
    │
    ├── services/
    │   ├── syncService.js                   Orchestrates full paginated sync loop (TripJack → DB)
    │   ├── cityService.js                   Business logic wrapper over cityRepository
    │   └── hotelService.js                  Business logic wrapper over hotelRepository
    │
    ├── repositories/
    │   ├── syncLogRepository.js             Create and update rows in supplier_sync_logs
    │   ├── cityRepository.js                Upsert cities into regions; full-text search cities
    │   └── hotelRepository.js               Upsert hotels/images/facilities; search; get by ID
    │
    ├── providers/
    │   └── tripjack/
    │       ├── tripjackHotelClient.js        Axios HTTP client for TripJack hotel static APIs
    │       │                                 Resolves mode (test/live), logs every call via logToDB
    │       └── tripjackHotelMapper.js        Normalises raw TripJack response → internal schema
    │
    └── validators/
        ├── cityValidator.js                 Joi: q (min 2 chars), limit
        ├── hotelValidator.js                Joi: cityId (required), page, limit
        └── syncValidator.js                 Placeholder — no body validation for Phase 1
```

---

## 5. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Client (B2B / B2C / Admin)                  │
└────────────────────────┬────────────────────────────────────────┘
                         │  x-api-key header
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Express.js Microservice                       │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                     Hotel Module                           │ │
│  │                                                            │ │
│  │  routes → controllers → services → repositories           │ │
│  │                              ↓                             │ │
│  │                     providers/tripjack                     │ │
│  └──────────────────────────────┬─────────────────────────────┘ │
└─────────────────────────────────┼───────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
   ┌─────────────┐      ┌─────────────────┐     ┌───────────────┐
   │  Supabase   │      │  TripJack API   │     │    Winston    │
   │ (PostgreSQL)│      │  (test / live)  │     │  (console)   │
   └─────────────┘      └─────────────────┘     └───────────────┘
```

**Key design decisions:**

- **Search always comes from the database.** TripJack is never called for city autocomplete or hotel listing. This keeps search fast, cheap, and offline-capable.
- **TripJack is only called for sync jobs.** Live availability, pricing, and booking (Phase 2) will call TripJack in real time.
- **Internal IDs are separate from supplier IDs.** The DB uses its own `id` (BIGSERIAL). TripJack IDs are stored in `supplier_hotel_id` and `supplier_region_id`. This allows adding more suppliers without breaking existing data.

---

## 6. How the Pieces Talk

### Sync Flow (city or hotel)

```
POST /api/v1/hotels/sync/cities?mode=test
         │
         ▼
   auth middleware           checks x-api-key header
         │
         ▼
   syncController            reads req.query.mode, calls syncService(mode)
         │
         ▼
   syncService               1. creates a row in supplier_sync_logs (started_at)
         │                   2. enters pagination loop:
         │                      a. calls tripjackHotelClient.post(path, body, mode)
         │                      b. maps raw response with tripjackHotelMapper
         │                      c. upserts batch to DB via cityRepository / hotelRepository
         │                      d. reads res.next → repeats until next is null
         │                   3. updates supplier_sync_logs row (completed_at, records_processed)
         │
         ▼
   syncController            returns JSON with recordsProcessed
```

### Search Flow (city or hotel)

```
GET /api/v1/hotels/cities/search?q=dubai
         │
         ▼
   auth middleware
         │
         ▼
   cityValidator             Joi validates q (min 2), limit
         │
         ▼
   cityController            calls cityService
         │
         ▼
   cityService               thin wrapper, calls cityRepository.searchCities
         │
         ▼
   cityRepository            Supabase .ilike() query on regions table
         │
         ▼
   cityController            wraps result in response(res, true, 200, ...) and returns
```

### TripJack HTTP Client (with async logging)

```
tripjackHotelClient.post(path, body, mode)
    │
    ├── resolveMode(mode)
    │       └── mode param  →  HOTEL_MODE env var  →  'live'
    │
    ├── picks axios client   →  HOTEL_API_BASE_URL_TEST or HOTEL_API_BASE_URL_LIVE
    │
    ├── makes HTTP POST to TripJack
    │
    └── finally block (always runs — success or error):
            └── logToDB(...)   fire-and-forget INSERT to api_request_logs
                               (never blocks the response — errors silently swallowed)
```

---

## 7. Database Schema

Run `table.sql` in the Supabase SQL Editor to create all tables.

### hotels_regions
Stores all cities and regions synced from suppliers.

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL | Internal primary key |
| supplier | VARCHAR(50) | e.g. `tripjack` |
| supplier_region_id | VARCHAR(100) | TripJack's own region ID |
| region_type | VARCHAR(20) | CITY, REGION, etc. |
| city_name | TEXT | |
| country_name | TEXT | |
| country_code | CHAR(2) | ISO code |
| full_region_name | TEXT | `city, state, country` — used for search |
| latitude / longitude | NUMERIC | |
| is_active | BOOLEAN | Default true |

**Index:** GIN on `to_tsvector('simple', full_region_name)` for fast text search.

---

### hotels_inventory
Master hotel inventory. Never tightly coupled to one supplier.

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL | Internal primary key |
| supplier | VARCHAR(50) | e.g. `tripjack` |
| supplier_hotel_id | VARCHAR(100) | TripJack's own hotel ID |
| region_id | BIGINT FK | Links to `regions.id` |
| name | TEXT | |
| rating | NUMERIC(2,1) | Star rating |
| raw_data | JSONB | Full original supplier response — never delete this |
| search_vector | TSVECTOR | Auto-updated by DB trigger on name + city + country |
| last_synced_at | TIMESTAMP | When this record was last fetched from supplier |

**Indexes:** GIN on `search_vector`, index on `region_id`, `rating`.

---

### hotels_images
| Column | Type |
|---|---|
| hotel_id | BIGINT FK → hotels(id) CASCADE DELETE |
| image_url | TEXT |
| sort_order | INT |

---

### hotels_facilities
| Column | Type |
|---|---|
| hotel_id | BIGINT FK → hotels(id) CASCADE DELETE |
| facility_code | VARCHAR(100) |
| facility_name | TEXT |

---

### hotels_sync_logs
One row per sync job. Records start time, end time, records processed, and success/failure.

---

### hotels_api_logs
One row per outbound TripJack HTTP call. Written **asynchronously** (fire-and-forget) by `tripjackHotelClient`. Fields include `trace_id`, `endpoint`, `method`, `request_body`, `response_status`, `response_time_ms`, `success`, `error_message`.

---

### bookings / booking_logs
Stubbed for Phase 2. Tables exist, no application code yet.

---

## 8. API Reference

All endpoints require the header:
```
x-api-key: <INTERNAL_API_KEY>
```

### Internal — Sync

#### `POST /api/v1/hotels/sync/cities`
Fetches all cities from TripJack static API (paginated) and upserts into `regions`.

Query params:
| Param | Type | Default | Description |
|---|---|---|---|
| mode | string | `HOTEL_MODE` env | `test` or `live` |

Response:
```json
{
  "success": true,
  "message": "City sync completed successfully",
  "data": { "mode": "test", "recordsProcessed": 4218 }
}
```

---

#### `POST /api/v1/hotels/sync/hotels`
Fetches all hotels from TripJack static API (paginated) and upserts into `hotels`, `hotel_images`, `hotel_facilities`.

Query params: same as above.

Response:
```json
{
  "success": true,
  "message": "Hotel sync completed successfully",
  "data": { "mode": "test", "recordsProcessed": 87450 }
}
```

---

### Public — Search

#### `GET /api/v1/hotels/cities/search`
Search cities from the local `regions` table. No TripJack call.

Query params:
| Param | Type | Required | Description |
|---|---|---|---|
| q | string | Yes | Min 2 chars |
| limit | number | No | Default 20, max 100 |

Response:
```json
{
  "success": true,
  "message": "Cities fetched successfully",
  "data": {
    "count": 2,
    "cities": [
      {
        "id": 1,
        "city_name": "Dubai",
        "country_name": "United Arab Emirates",
        "country_code": "AE",
        "supplier_region_id": "130443",
        "latitude": 25.204849,
        "longitude": 55.270782
      }
    ]
  }
}
```

---

#### `GET /api/v1/hotels/search`
List hotels for a city from the local `hotels` table. No TripJack call.

Query params:
| Param | Type | Required | Description |
|---|---|---|---|
| cityId | number | Yes | Internal `regions.id` from city search |
| page | number | No | Default 1 |
| limit | number | No | Default 20, max 100 |

---

#### `GET /api/v1/hotels/:id`
Get single hotel with images and facilities. No TripJack call.

Response includes nested `hotel_images` and `hotel_facilities` arrays.

---

## 9. Mode Toggle (Test vs Live)

The TripJack client supports two API environments. Resolution priority (highest to lowest):

```
1. ?mode=test or ?mode=live   — per-request override
2. HOTEL_MODE=test in .env    — environment default (set once, forget it)
3. 'live'                     — hard fallback
```

**Dev `.env`:**
```
HOTEL_MODE=test
```

**Production `.env`:**
```
HOTEL_MODE=live
```

You only need `?mode=live` in dev if you want to make a one-off call against production data.

---

## 10. Logging Strategy

Three separate log surfaces — never mix them:

| Log Surface | Where | Written by | Purpose |
|---|---|---|---|
| Winston console | Terminal | Every controller + error handler | Developer visibility, real-time debugging |
| `api_request_logs` table | Supabase | `logToDB()` via `tripjackHotelClient` | Audit trail for every outbound TripJack call |
| `supplier_sync_logs` table | Supabase | `syncLogRepository` | Per sync-job audit (start/end/count/success) |

### `logToDB` — universal async logger

Located at `src/utils/logToDB.js`. Can be used from anywhere in the codebase.

```js
const logToDB = require('../../utils/logToDB');

// fire-and-forget — no await needed
logToDB({
  traceId,           // UUID — correlate logs across tables
  clientType,        // 'hotel-sync', 'hotel-search', etc.
  endpoint,          // API path
  method,            // 'POST', 'GET'
  requestBody,       // what was sent
  responseStatus,    // HTTP status received
  responseTimeMs,    // round-trip time
  success,           // boolean
  errorMessage,      // string if failed
});
```

> **Rule:** Errors inside `logToDB` are silently swallowed. A logging failure must never break the actual request.

---

## 11. Adding a New Supplier

The schema is already designed for multi-supplier. To add HotelBeds (or any other supplier):

**1. Add a new provider folder:**
```
src/hotels/providers/hotelbeds/
    ├── hotelbedsHotelClient.js    — axios client for HotelBeds APIs
    └── hotelbedsHotelMapper.js    — map HotelBeds response → same internal schema shape
```

**2. The mapper must return the same shape as `tripjackHotelMapper`:**
```js
// mapCity must return:
{ supplier, supplierRegionId, cityName, countryName, countryCode, ... }

// mapHotel must return:
{ hotel: { supplier, supplierHotelId, name, rating, ... }, images: [...], facilities: [...] }
```

**3. The repositories need no changes.** They accept the normalised shape — they don't care which supplier produced it.

**4. Add new sync routes if needed** or reuse the same `syncService` pattern with the HotelBeds client.

**5. All HotelBeds data sits in the same `hotels` and `regions` tables**, distinguished by `supplier = 'hotelbeds'`.

---

## 12. Known Issues & TODOs

### `region_id` not linked on hotels (important)

Hotels are synced and stored, but `region_id` (FK to `regions.id`) is **never set**. This means `GET /hotels/search?cityId=123` returns empty results because it filters on `region_id`.

**Fix needed:**
- During `upsertHotels`, extract the TripJack `regionId` from the hotel raw data
- Batch-lookup internal `regions.id` from `supplier_region_id` before inserting
- Set `region_id` on each hotel row before upsert

### hotels_facilities and hotel_images are deleted and re-inserted on every sync

Currently Phase 1 deletes all images/facilities for a batch of hotels and re-inserts them on every sync. This is safe but wasteful. A future optimisation is to compare `last_synced_at` and skip unchanged records.

### No cron schedule

Sync is triggered manually via HTTP POST. For production, a cron job (or Supabase Edge Function scheduled job) should call the sync endpoints on a daily/weekly cadence.

### Booking tables are stubs

`bookings` and `booking_logs` tables exist in `table.sql` but have no application code. These are Phase 2.

---

## 13. Testing Guide

### Setup

```bash
npm install
# configure .env (see Section 3)
# run table.sql in Supabase SQL Editor
npm run dev
```

### Correct test order

**Cities must be synced before hotels** (so `region_id` lookup can work once that fix is applied).

```bash
# 1 — Sync cities
curl -X POST http://localhost:3001/api/v1/hotels/sync/cities \
  -H "x-api-key: your_key"

# 2 — Sync hotels
curl -X POST http://localhost:3001/api/v1/hotels/sync/hotels \
  -H "x-api-key: your_key"

# 3 — Search cities (get an id to use in step 4)
curl "http://localhost:3001/api/v1/hotels/cities/search?q=dubai" \
  -H "x-api-key: your_key"

# 4 — Search hotels for that city
curl "http://localhost:3001/api/v1/hotels/search?cityId=1&page=1&limit=10" \
  -H "x-api-key: your_key"

# 5 — Get hotel detail
curl "http://localhost:3001/api/v1/hotels/42" \
  -H "x-api-key: your_key"
```

### Verify in Supabase

```sql
SELECT COUNT(*) FROM hotels_regions;
SELECT COUNT(*) FROM hotels_inventory;
SELECT COUNT(*) FROM hotels_images;
SELECT COUNT(*) FROM hotels_facilities;
SELECT sync_type, records_processed, success, started_at, completed_at
  FROM hotels_sync_logs ORDER BY created_at DESC;
SELECT endpoint, response_status, response_time_ms, success
  FROM hotels_api_logs ORDER BY created_at DESC LIMIT 10;
```

### Auth checks

```bash
# 401 — missing key
curl http://localhost:3001/api/v1/hotels/cities/search?q=dubai

# 400 — query too short
curl "http://localhost:3001/api/v1/hotels/cities/search?q=d" \
  -H "x-api-key: your_key"

# 404 — hotel not found
curl "http://localhost:3001/api/v1/hotels/9999999" \
  -H "x-api-key: your_key"
```
