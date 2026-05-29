# Hotel Module — Developer Documentation

> **Scope:** Static hotel inventory sync, DB-backed search, and full live booking flow (Search → Detail → Review → Book).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Tech Stack](#2-tech-stack)
3. [Environment Variables](#3-environment-variables)
4. [Folder Structure](#4-folder-structure)
5. [System Architecture](#5-system-architecture)
6. [Booking Flow](#6-booking-flow)
7. [Database Schema](#7-database-schema)
8. [API Reference](#8-api-reference)
9. [API Test Guide](#9-api-test-guide)
10. [Mode Toggle (Test vs Live)](#10-mode-toggle-test-vs-live)
11. [Logging Strategy](#11-logging-strategy)
12. [Adding a New Supplier](#12-adding-a-new-supplier)
13. [Known Issues & TODOs](#13-known-issues--todos)

---

## 1. Overview

The hotel module is a **self-contained feature module** inside the `cnk-flight` Express.js microservice.

It is responsible for:

- Syncing static city/region and hotel data from TripJack into Supabase (PostgreSQL)
- Serving city search and hotel search from the local database (fast, no live supplier calls)
- Providing a complete **4-step live booking flow** via TripJack v3 APIs (Search → Detail → Review → Book)
- Managing bookings: poll status, cancel confirmed bookings

The module is designed to be **supplier-agnostic** — hotels and cities are stored in an internal schema, not tightly coupled to TripJack's response structure.

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

```bash
# Supabase (hotels share the same instance as the rest of the app)
SUPABASE_URL=https://your-project.supabase.co        # or http://127.0.0.1:54321 for local
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# TripJack shared API key (used for all hotel endpoints)
HOTEL_API_KEY=your_tripjack_api_key_here

# HMS service — live search, pricing, review
HOTEL_HMS_API_BASE_URL_TEST=https://apitest-hms.tripjack.com
HOTEL_HMS_API_BASE_URL_LIVE=https://hms.tripjack.com

# Static service — hotel/city inventory sync (same domain as flight)
HOTEL_STATIC_API_BASE_URL_TEST=https://apitest.tripjack.com
HOTEL_STATIC_API_BASE_URL_LIVE=https://tripjack.com

# Booker service — book, booking-details, cancel-booking
HOTEL_BOOKER_API_BASE_URL_TEST=https://apitest-hotel-booker.tripjack.com
HOTEL_BOOKER_API_BASE_URL_LIVE=https://hotel-booker.tripjack.com

# Default API mode — 'test' in dev/staging, 'live' in production
HOTEL_MODE=test
```

> **Note:** `HOTEL_MODE=test` means you never need to pass `?mode=test` during local development.
> The live booker URL should be confirmed from your TripJack partner portal.

---

## 4. Folder Structure

```
src/hotels/
│
├── routes/
│   ├── syncRoutes.js          POST /sync/cities, POST /sync/hotels
│   ├── cityRoutes.js          GET  /cities/search
│   └── hotelRoutes.js         All booking flow + DB search routes
│
├── controllers/
│   ├── syncController.js      Orchestrates city/hotel sync jobs
│   ├── cityController.js      City search from DB
│   └── hotelController.js     DB search, live booking flow controllers
│
├── services/
│   ├── syncService.js         Paginated sync loop (TripJack → DB)
│   ├── cityService.js         Business logic for city search
│   └── hotelService.js        All booking flow services + DB search
│
├── repositories/
│   ├── syncLogRepository.js   Create/update rows in supplier_sync_logs
│   ├── cityRepository.js      Upsert cities; full-text city search
│   └── hotelRepository.js     Upsert hotels/images/facilities; paginated search
│
├── providers/
│   └── tripjack/
│       ├── tripjackHotelClient.js    Axios client — resolves service (hms/static/booker),
│       │                              mode (test/live), logs every call
│       ├── tripjackHotelConfig.js    All base URLs and endpoint paths
│       └── tripjackHotelMapper.js    Normalises TripJack response → internal schema
│
└── validators/
    ├── cityValidator.js        Joi: q (min 2), limit
    ├── hotelValidator.js       Joi: DB search, live search, detail, review, book, cancel
    └── syncValidator.js        Placeholder
```

---

## 5. System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Client (B2B / B2C / Admin)                       │
└───────────────────────────┬──────────────────────────────────────────┘
                            │  x-api-key header
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Express.js Microservice                            │
│                                                                      │
│  routes → validators → controllers → services → repositories         │
│                                           ↓                          │
│                              providers/tripjack                      │
│                    ┌──────────┬────────────┬──────────┐              │
│                    │   HMS    │   Static   │  Booker  │              │
│                    │ (search/ │ (inventory │  (book/  │              │
│                    │ pricing/ │   sync)    │ details/ │              │
│                    │ review)  │            │ cancel)  │              │
└────────────────────┴──────────┴────────────┴──────────┴──────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
 ┌─────────────┐   ┌─────────────────┐  ┌──────────────┐
 │  Supabase   │   │  TripJack APIs  │  │   Winston    │
 │ (PostgreSQL)│   │  (test / live)  │  │  (console)   │
 └─────────────┘   └─────────────────┘  └──────────────┘
```

**Key design decisions:**

- **DB search never calls TripJack.** Fast, offline-capable, cheap.
- **Three separate TripJack services.** HMS for live flow (listing/pricing/review), Static for inventory sync, Booker for booking management.
- **Internal IDs are separate from supplier IDs.** Allows multi-supplier without schema changes.
- **Unified pagination envelope** on all list responses — same structure everywhere.

---

## 6. Booking Flow

Every hotel booking follows this strict 4-step sequence. The `correlationId` from Step 1 is carried through all steps. The `bookingId` from Step 3 is required for Step 4.

```
┌──────────────────────────────────────────────────────────────────┐
│  STEP 1           STEP 2            STEP 3          STEP 4       │
│                                                                  │
│  POST             POST              POST             POST        │
│  /search/live  →  /detail       →   /review      →  /book       │
│                                                                  │
│  Returns          Returns           Returns          Returns     │
│  hotels +         options +         bookingId +      booking     │
│  correlationId    reviewHash        confirmed price  confirmation│
└──────────────────────────────────────────────────────────────────┘
```

> **Important:** The `searchId` (correlationId) is valid for ~15 minutes. Always call Review immediately before Book — prices can change between Detail and booking.

---

## 7. Database Schema

Run `table.sql` in Supabase SQL Editor to create all tables.

### hotels_regions
| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL | Internal PK |
| supplier | VARCHAR(50) | e.g. `tripjack` |
| supplier_region_id | VARCHAR(100) | TripJack cityRegionId |
| city_name | TEXT | |
| country_name | TEXT | |
| country_code | CHAR(2) | ISO code |
| full_region_name | TEXT | Used for text search |

**Index:** GIN on `to_tsvector('simple', full_region_name)`

---

### hotels_inventory
| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL | Internal PK |
| supplier | VARCHAR(50) | |
| supplier_hotel_id | VARCHAR(100) | TripJack's `tjHotelId` — use as `hid` in live search |
| region_id | BIGINT FK | Links to `hotels_regions.id` |
| name | TEXT | |
| rating | NUMERIC(2,1) | |
| raw_data | JSONB | Full original supplier response |
| last_synced_at | TIMESTAMP | |

---

### hotels_images
| Column | Type |
|---|---|
| hotel_id | BIGINT FK → hotels_inventory(id) CASCADE |
| image_url | TEXT |
| sort_order | INT |

---

### hotels_facilities
| Column | Type |
|---|---|
| hotel_id | BIGINT FK → hotels_inventory(id) CASCADE |
| facility_code | VARCHAR(100) |
| facility_name | TEXT |

---

## 8. API Reference

All endpoints require:
```
x-api-key: <INTERNAL_API_KEY>
Content-Type: application/json   (POST requests)
```

### Unified Pagination Structure
All list responses use this consistent envelope:
```json
{
  "success": true,
  "data": {
    "hotels": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 150,
      "totalPages": 8,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

---

### Sync Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/hotels/sync/cities` | Sync all cities from TripJack into DB |
| POST | `/api/v1/hotels/sync/hotels` | Sync all hotels from TripJack into DB |

---

### DB Search (no live TripJack call)

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/hotels/cities/search?q=dubai` | City autocomplete from DB |
| GET | `/api/v1/hotels/search?cityId=1&page=1&limit=20` | Paginated hotel list from DB |
| GET | `/api/v1/hotels/:id` | Single hotel with images + facilities |

---

### Live Booking Flow

| Step | Method | Path | Description |
|---|---|---|---|
| 1 | POST | `/api/v1/hotels/search/live` | Live hotel search (TripJack Listing) |
| 2 | POST | `/api/v1/hotels/detail` | Dynamic pricing + room options |
| 3 | POST | `/api/v1/hotels/review` | Confirm price + availability |
| 4 | POST | `/api/v1/hotels/book` | Create booking (instant or hold) |

---

### Booking Management

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/hotels/booking/details` | Poll booking status (every 5s until terminal) |
| POST | `/api/v1/hotels/booking/cancel` | Cancel a confirmed booking |

---

## 9. API Test Guide

> **Auth header required on every request:** `x-api-key: your-api-key`
> Base URL: `http://localhost:3001`

---

### Step 0-A — City search (get a `cityId`)

```bash
curl -s "http://localhost:3001/api/v1/hotels/cities/search?q=mumbai&limit=5" \
  -H "x-api-key: your-api-key" | jq
```

| Param | Required | Description |
|---|---|---|
| q | Yes | Search term, min 2 chars |
| limit | No | Default 20, max 100 |

**Response:**
```json
{
  "success": true,
  "data": {
    "count": 2,
    "cities": [
      {
        "id": 14,
        "city_name": "Mumbai",
        "country_name": "India",
        "supplier_region_id": "130786"
      }
    ]
  }
}
```

---

### Step 0-B — DB hotel search (paginated, no live call)

```bash
curl -s "http://localhost:3001/api/v1/hotels/search?cityId=14&page=1&limit=10" \
  -H "x-api-key: your-api-key" | jq
```

| Param | Required | Description |
|---|---|---|
| cityId | Yes | `id` from city search above |
| page | No | Default 1 |
| limit | No | Default 20, max 100 |

**Response:**
```json
{
  "success": true,
  "data": {
    "hotels": [
      {
        "id": 42,
        "name": "The Taj Mahal Palace",
        "rating": 5.0,
        "property_type": "Hotel",
        "city_name": "Mumbai",
        "supplier_hotel_id": "10000001234"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 87,
      "totalPages": 9,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

---

### Step 0-C — Single hotel by DB id (images + facilities)

```bash
curl -s "http://localhost:3001/api/v1/hotels/42" \
  -H "x-api-key: your-api-key" | jq
```

**Response includes:** full hotel row + nested `hotels_images[]` + `hotels_facilities[]`

---

### Step 1 — Live Search

**Option A — by `cityId` (resolves to TripJack cityCode via DB)**

```bash
curl -s -X POST "http://localhost:3001/api/v1/hotels/search/live" \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "cityId": 14,
    "checkIn": "2026-06-20",
    "checkOut": "2026-06-22",
    "rooms": [
      { "adults": 2, "children": 0, "childAge": [] }
    ],
    "currency": "INR",
    "nationality": "100"
  }' | jq
```

**Option B — by `hids` only (no DB lookup, direct TripJack hotel IDs)**

```bash
curl -s -X POST "http://localhost:3001/api/v1/hotels/search/live" \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "hids": ["10000001234", "10000005678"],
    "checkIn": "2026-06-20",
    "checkOut": "2026-06-22",
    "rooms": [
      { "adults": 2, "children": 1, "childAge": [5] }
    ],
    "currency": "INR",
    "nationality": "100"
  }' | jq
```

**Option C — `cityId` + `hids` together (city scope + specific hotels)**

```bash
curl -s -X POST "http://localhost:3001/api/v1/hotels/search/live" \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "cityId": 14,
    "hids": ["10000001234"],
    "checkIn": "2026-06-20",
    "checkOut": "2026-06-22",
    "rooms": [
      { "adults": 2, "children": 0, "childAge": [] }
    ],
    "currency": "INR",
    "nationality": "100",
    "timeoutMs": 15000
  }' | jq
```

> Save `correlationId` and `tjHotelId` from the response — needed in Step 2.

| Field | Type | Required | Description |
|---|---|---|---|
| cityId | number | One of cityId/hids | Internal region ID from city search |
| hids | array | One of cityId/hids | TripJack hotel IDs — skips DB city lookup entirely (max 100) |
| checkIn | string | Yes | `YYYY-MM-DD` — must be future date |
| checkOut | string | Yes | `YYYY-MM-DD` — must be after checkIn |
| rooms | array | Yes | Min 1, max 5 rooms |
| rooms[].adults | number | Yes | Min 1, max 9 |
| rooms[].children | number | No | Default 0, max 6 |
| rooms[].childAge | array | Conditional | Required when children > 0. One age per child (0–17) |
| currency | string | No | ISO 4217, default `INR` |
| nationality | string | No | TripJack country ID, default `100` (India) |
| correlationId | string | No | Pass your own for end-to-end tracing; auto-generated if omitted |
| timeoutMs | number | No | 5000–35000 ms |

> Save `correlationId` and `tjHotelId` from the response — needed in Step 2.

---

### Step 2 — Dynamic Detail / Pricing

> Replace `correlationId` and `hid` with values from Step 1.

```bash
curl -s -X POST "http://localhost:3001/api/v1/hotels/detail" \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "correlationId": "PASTE_CORRELATION_ID_FROM_STEP1",
    "hid": "PASTE_TJHOTELID_FROM_STEP1",
    "checkIn": "2026-06-20",
    "checkOut": "2026-06-22",
    "rooms": [
      { "adults": 2, "children": 0, "childAge": [] }
    ],
    "currency": "INR",
    "nationality": "100"
  }' | jq
```

| Field | Type | Required | Description |
|---|---|---|---|
| correlationId | string | No | From Step 1 (for tracing) |
| hid | string | Yes | `tjHotelId` from Step 1 response |
| checkIn | string | Yes | Must match Step 1 |
| checkOut | string | Yes | Must match Step 1 |
| rooms | array | Yes | Must match Step 1 — same count and order |
| currency | string | No | Default `INR` |
| nationality | string | No | Default `100` |
| timeoutMs | number | No | 5000–35000 ms |

> Save `reviewHash` and the `optionId` of the option you want to book — both required in Step 3.
> **Price formula:** `totalPrice = basePrice + taxes + mf + mft`

---

### Step 3 — Review

Must be called **immediately before Book**. Confirms real-time price and availability.

> Replace all values with those from Step 1 (`correlationId`, `hid`) and Step 2 (`optionId`, `reviewHash`).

```bash
curl -s -X POST "http://localhost:3001/api/v1/hotels/review" \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "correlationId": "PASTE_CORRELATION_ID",
    "optionId": "PASTE_OPTION_ID_FROM_STEP2",
    "reviewHash": "PASTE_REVIEW_HASH_FROM_STEP2",
    "hid": "PASTE_TJHOTELID"
  }' | jq
```

| Field | Type | Required | Description |
|---|---|---|---|
| correlationId | string | Yes | From Step 1 |
| optionId | string | Yes | Selected option from Step 2 |
| reviewHash | string | Yes | From Step 2 detail response |
| hid | string | Yes | TripJack hotel ID |

> Save `bookingId` from this response — **required for Step 4**.
> If `isAvailable` is `false` the option is sold out — go back to Step 2 and pick another option.
> The confirmed price from Review is the authoritative price — use it for display.

---

### Step 4 — Book (Instant)

> Replace `bookingId` with value from Step 3. Set `amount` to the `totalPrice` from Review.

```bash
curl -s -X POST "http://localhost:3001/api/v1/hotels/book" \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "bookingId": "PASTE_BOOKING_ID_FROM_STEP3",
    "type": "HOTEL",
    "roomTravellerInfo": [
      {
        "travelerInfo": [
          { "ti": "Mr", "pt": "ADULT", "fN": "Rahul", "lN": "Sharma" },
          { "ti": "Mrs", "pt": "ADULT", "fN": "Priya", "lN": "Sharma" }
        ]
      }
    ],
    "deliveryInfo": {
      "emails": ["guest@example.com"],
      "contacts": ["9876543210"],
      "code": ["+91"]
    },
    "paymentInfos": [
      { "amount": 27006.42, "type": "HOTEL" }
    ]
  }' | jq
```

**Hold Booking — omit `paymentInfos`:**

```bash
curl -s -X POST "http://localhost:3001/api/v1/hotels/book" \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "bookingId": "PASTE_BOOKING_ID_FROM_STEP3",
    "type": "HOTEL",
    "roomTravellerInfo": [
      {
        "travelerInfo": [
          { "ti": "Mr", "pt": "ADULT", "fN": "Rahul", "lN": "Sharma" }
        ]
      }
    ],
    "deliveryInfo": {
      "emails": ["guest@example.com"],
      "contacts": ["9876543210"],
      "code": ["+91"]
    }
  }' | jq
```

| Field | Type | Required | Description |
|---|---|---|---|
| bookingId | string | Yes | From Step 3 Review |
| type | string | Yes | Always `"HOTEL"` |
| roomTravellerInfo | array | Yes | One entry per room, same order as search |
| travelerInfo[].ti | string | Yes | Title: `Mr` `Mrs` `Ms` `Miss` `Master` |
| travelerInfo[].pt | string | Yes | `ADULT` or `CHILD` |
| travelerInfo[].fN | string | Yes | First name (unique across rooms for lead guest) |
| travelerInfo[].lN | string | Yes | Last name |
| travelerInfo[].pan | string | Conditional | Required when `panRequired: true` in Review |
| travelerInfo[].pNum | string | Conditional | Passport number — required for international hotels |
| deliveryInfo.emails | array | Yes | Confirmation email addresses |
| deliveryInfo.contacts | array | Yes | Contact phone numbers |
| deliveryInfo.code | array | No | Dialing codes matching each contact |
| paymentInfos[].amount | number | Instant only | Omit entirely for Hold Booking |
| gstInfo | object | Conditional | Required when GST details returned in Detail |

> The Book response only confirms the request was **received**. Confirmation takes up to 180 seconds — poll `/booking/details` every 5 seconds.

---

### Booking Details — Poll Status

```bash
curl -s -X POST "http://localhost:3001/api/v1/hotels/booking/details" \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "bookingId": "PASTE_BOOKING_ID"
  }' | jq
```

| Status | Type | Description |
|---|---|---|
| `IN_PROGRESS` | Pending | Being processed by supplier |
| `PAYMENT_SUCCESS` | Pending | Payment received; awaiting confirmation |
| `PAYMENT_PENDING` | Pending | Payment not yet processed |
| `PENDING` | Pending | Generic pending state |
| `SUCCESS` | Terminal ✓ | Booking confirmed |
| `ON_HOLD` | Terminal ✓ | Hold confirmed — confirm before deadline |
| `ABORTED` | Terminal ✗ | Booking failed, no charge |
| `FAILED` | Terminal ✗ | Request failed, no charge |
| `CANCELLATION_PENDING` | Post-booking | TripJack processing cancellation offline |
| `CANCELLED` | Terminal | Booking cancelled |

> Poll every 5 seconds. Stop at any terminal status or after 180 seconds.

---

### Cancel Booking

```bash
curl -s -X POST "http://localhost:3001/api/v1/hotels/booking/cancel" \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "bookingId": "PASTE_BOOKING_ID"
  }' | jq
```

> After cancellation the booking moves to `CANCELLATION_PENDING`. Poll `/booking/details` once per day until status becomes `CANCELLED`.

---

### Validation error tests

```bash
# 400 — missing both cityId and hids
curl -s -X POST "http://localhost:3001/api/v1/hotels/search/live" \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{ "checkIn": "2026-06-20", "checkOut": "2026-06-22", "rooms": [{"adults":1}] }' | jq

# 401 — missing API key
curl -s "http://localhost:3001/api/v1/hotels/search?cityId=1" | jq

# 404 — hotel not in DB
curl -s "http://localhost:3001/api/v1/hotels/9999999" \
  -H "x-api-key: your-api-key" | jq
```

---

## 10. Mode Toggle (Test vs Live)

The TripJack client supports two API environments. Resolution priority (highest to lowest):

```
1. mode param passed from service call
2. HOTEL_MODE env var
3. 'live' as hard fallback
```

**Dev `.env`:** `HOTEL_MODE=test`
**Production `.env`:** `HOTEL_MODE=live`

---

## 11. Logging Strategy

| Log Surface | Where | Written by | Purpose |
|---|---|---|---|
| Winston console | Terminal | Every controller + error handler | Real-time debugging |
| `api_request_logs` table | Supabase | `logToDB()` via `tripjackHotelClient` | Audit trail for every TripJack call |
| `supplier_sync_logs` table | Supabase | `syncLogRepository` | Per sync-job audit |

All TripJack HTTP calls are logged with: `traceId`, `endpoint`, `method`, `requestBody`, `responseStatus`, `responseTimeMs`, `success`, `errorMessage`.

Logging is **fire-and-forget** — a log failure never breaks the actual request.

---

## 12. Adding a New Supplier

The schema is designed for multi-supplier. To add HotelBeds (or any other):

**1. Add a new provider folder:**
```
src/hotels/providers/hotelbeds/
    ├── hotelbedsHotelClient.js    — axios client
    └── hotelbedsHotelMapper.js    — map response → same internal schema
```

**2. The mapper must return the same shape:**
```js
// mapHotel must return:
{ hotel: { supplier, supplierHotelId, name, rating, ... }, images: [...], facilities: [...] }
```

**3. Repositories need no changes** — they accept the normalised shape.

**4. All supplier data sits in the same tables**, distinguished by `supplier = 'hotelbeds'`.

---

## 13. Known Issues & TODOs

### `region_id` not linked on all hotels
Hotels synced before the city-matching fix may have `region_id = null`. The DB search falls back to `city_name` ilike matching, which covers these cases but is slower. A re-sync will resolve `region_id` correctly.

### Images/facilities are deleted and re-inserted on every sync
Safe but wasteful. Future: compare `last_synced_at` and skip unchanged records.

### No cron schedule
Sync is triggered manually via HTTP POST. For production, schedule the sync endpoints daily/weekly via a cron job or Supabase Edge Function.

### Hold booking confirm endpoint not yet wired
TripJack's confirm-hold endpoint (`POST /oms/v3/hotel/confirm-book`) is not yet implemented. Currently only Instant Booking is fully end-to-end. Hold booking creates the hold; the confirm step needs to be added.
