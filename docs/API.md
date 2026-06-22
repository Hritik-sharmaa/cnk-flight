# cnk-flight API Reference

## Base URL

```
http://localhost:3001
```

## Authentication

Every request (except `/health`) must include:

```
x-api-key: <INTERNAL_API_KEY>
Content-Type: application/json
```

## Response Format

All endpoints return:

```json
{ "success": true, "data": { ... } }
```

On error:

```json
{ "success": false, "error": "message", "details": ["..."] }
```

---

## Booking Flow

```
SEARCH → REVIEW → (optional: FARE RULE, SEAT MAP) → BOOK → BOOKING DETAILS
```

For hold bookings:

```
SEARCH → REVIEW → BOOK (no payment) → FARE VALIDATE → CONFIRM BOOK → BOOKING DETAILS
```

---

## Endpoints

### GET /health

Check server status and active provider. No auth required.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "provider": "tripjack",
    "environment": "development"
  }
}
```

---

### POST /api/v1/flights/search

Search for available flights.

**Request:**
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

| Field | Required | Notes |
|---|---|---|
| `cabinClass` | No | `ECONOMY` / `PREMIUM_ECONOMY` / `BUSINESS` / `FIRST`. Default: `ECONOMY` |
| `paxInfo.ADULT` | Yes | Number as string, e.g. `"1"` |
| `paxInfo.CHILD` | No | Default `"0"` |
| `paxInfo.INFANT` | No | Default `"0"` |
| `routeInfos` | Yes | 1 entry = one-way. 2 entries = return. Up to 6 for multi-city |
| `travelDate` | Yes | Format `YYYY-MM-DD` |
| `searchModifiers.pft` | No | `REGULAR` / `STUDENT` / `SENIOR_CITIZEN` |
| `preferredAirline` | No | Max 10 airline IATA codes |

**Response:**
```json
{
  "success": true,
  "data": {
    "onward": [
      {
        "segments": [
          {
            "id": "segment_id",
            "airline": { "code": "6E", "name": "IndiGo", "flightNumber": "6E123" },
            "departure": { "airport": "DEL", "terminal": "T2", "time": "2026-06-15 06:00" },
            "arrival": { "airport": "BOM", "terminal": "T1", "time": "2026-06-15 08:15" },
            "durationMinutes": 135,
            "stops": 0
          }
        ],
        "fareOptions": [
          {
            "priceId": "SAVE_THIS_FOR_REVIEW",
            "fareIdentifier": "PUBLISHED",
            "refundable": 1,
            "adult": {
              "totalFare": 4500,
              "baseFare": 3200,
              "tax": 1300,
              "baggage": { "checkIn": "15Kg", "cabin": "7Kg" }
            }
          }
        ]
      }
    ],
    "return": [ ... ],
    "raw": { ... }
  }
}
```

> `priceId` expires in 30 minutes. Save it immediately for the Review call.

> `refundable`: `0` = Non-refundable, `1` = Refundable, `2` = Partial

---

### POST /api/v1/flights/review

Revalidate fare and open a booking session. **Must be called before Book.**

**Request:**
```json
{
  "priceIds": ["PRICE_ID_FROM_SEARCH"]
}
```

> Send 1 `priceId` for one-way or international return. Send 2 for domestic return (onward + return).

**Response:**
```json
{
  "success": true,
  "data": {
    "bookingId": "SAVE_THIS_FOR_ALL_NEXT_CALLS",
    "sessionValidSeconds": 900,
    "totalFare": 4500,
    "conditions": {
      "isBA": false,
      "isa": true,
      "iecr": false,
      "ipa": false,
      "gst": { "igm": false, "gstappl": false },
      "dob": { "adobr": false, "cdobr": true, "idobr": true },
      "pcs": { "pm": false, "pped": false }
    },
    "tripInfos": [ ... ],
    "raw": { ... }
  }
}
```

> `bookingId` is required for every subsequent API call.

> Check `conditions` carefully before building the Book request — missing mandatory fields will fail the booking.

| Condition | Meaning |
|---|---|
| `isBA` | Hold booking allowed |
| `isa` | Seat selection available |
| `iecr` | Emergency contact required |
| `ipa` | PAN card required |
| `gst.igm` | GST mandatory |
| `gst.gstappl` | GST applicable |
| `dob.adobr` | Adult DOB required |
| `dob.cdobr` | Child DOB required |
| `dob.idobr` | Infant DOB required |
| `pcs.pm` | Passport mandatory (international) |

---

### POST /api/v1/flights/fare-rule _(optional)_

Get cancellation, date change, and no-show policies.

**Request:**
```json
{
  "id": "PRICE_ID_or_BOOKING_ID",
  "flowType": "SEARCH"
}
```

| `flowType` | `id` to send |
|---|---|
| `SEARCH` | `priceId` from Search |
| `REVIEW` | `bookingId` from Review |
| `BOOKING_DETAIL` | `bookingId` after booking |

---

### POST /api/v1/flights/seat-map _(optional)_

Get seat layout. Only call when `conditions.isa = true` in the Review response.

**Request:**
```json
{
  "bookingId": "BOOKING_ID"
}
```

Seat `code` values from this response go into `travellerInfo[].ssrSeatInfos` in the Book call.

---

### POST /api/v1/flights/book

Book a flight. Supports instant booking (with payment) and hold booking (without payment).

**Request:**
```json
{
  "bookingId": "BOOKING_ID_FROM_REVIEW",
  "paymentInfos": [{ "amount": 4500 }],
  "deliveryInfo": {
    "emails": ["customer@email.com"],
    "contacts": ["+919500112233"]
  },
  "contactInfo": {
    "emails": ["emergency@email.com"],
    "contacts": ["+919500112233"],
    "ecn": "Emergency Contact Name"
  },
  "travellerInfo": [
    {
      "ti": "Mr",
      "pt": "ADULT",
      "fN": "John",
      "lN": "Doe",
      "dob": "1990-01-15",
      "pNum": "A1234567",
      "eD": "2030-01-01",
      "pNat": "IN",
      "pid": "2020-01-01",
      "pan": "ABCDE1234F",
      "ssrBaggageInfos": [{ "key": "SEGMENT_ID", "code": "SSR_CODE" }],
      "ssrMealInfos": [{ "key": "SEGMENT_ID", "code": "SSR_CODE" }],
      "ssrSeatInfos": [{ "key": "SEGMENT_ID", "code": "SEAT_CODE" }]
    }
  ],
  "gstInfo": {
    "gstNumber": "27AAPFU0939F1ZV",
    "registeredName": "Company Name",
    "email": "gst@company.com",
    "mobile": "+919500112233",
    "address": "GST Registered Address"
  },
  "_meta": {
    "createdBy": "agent@coxandkings.com",
    "searchParams": {}
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `bookingId` | Yes | From Review |
| `paymentInfos[].amount` | For instant | Must equal `totalFare` from Review. Omit entire field for hold booking |
| `deliveryInfo.emails` | Yes | Customer email for ticket delivery |
| `deliveryInfo.contacts` | Yes | Customer phone with country code |
| `contactInfo` | Conditional | Required if `conditions.iecr = true` |
| `travellerInfo[].ti` | Yes | `Mr` / `Mrs` / `Ms` / `Master` |
| `travellerInfo[].pt` | Yes | `ADULT` / `CHILD` / `INFANT` |
| `travellerInfo[].fN` | Yes | First name |
| `travellerInfo[].lN` | Yes | Last name |
| `travellerInfo[].dob` | Conditional | Required if `conditions.dob.adobr/cdobr/idobr = true` |
| `travellerInfo[].pan` | Conditional | Required if `conditions.ipa = true` |
| `travellerInfo[].pNum` | Conditional | Passport number — required for international flights |
| `travellerInfo[].eD` | Conditional | Passport expiry `YYYY-MM-DD` |
| `travellerInfo[].pNat` | Conditional | 2-letter nationality code e.g. `IN` |
| `travellerInfo[].pid` | Conditional | Passport issue date `YYYY-MM-DD` |
| `gstInfo` | Conditional | Required if `conditions.gst.igm = true` |
| `_meta.createdBy` | No | Stored in Supabase for reference, not sent to provider |
| `_meta.searchParams` | No | Stored in Supabase for reference, not sent to provider |

> For hold booking: omit `paymentInfos` entirely. Follow up with `/fare-validate` then `/confirm-book`.

> SSR `key` = the `id` field from `sI[]` in the Review `tripInfos`, not a segment index number.

---

### POST /api/v1/flights/fare-validate

Check that fare is still valid before ticketing a held booking.

**Request:**
```json
{
  "bookingId": "BOOKING_ID"
}
```

---

### POST /api/v1/flights/confirm-book

Ticket a held booking with payment.

**Request:**
```json
{
  "bookingId": "BOOKING_ID",
  "paymentInfos": [{ "amount": 4500 }]
}
```

---

### POST /api/v1/flights/booking-details

Get booking status, PNR, and ticket numbers.

**Request:**
```json
{
  "bookingId": "BOOKING_ID",
  "requirePaxPricing": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "bookingId": "BOOKING_ID",
    "status": "SUCCESS",
    "amount": 4500,
    "travellers": [
      {
        "pnrDetails": { "DEL-BOM": "ABC123" },
        "ticketNumberDetails": { "DEL-BOM": "6E-1234567890" }
      }
    ],
    "totalFare": 4500,
    "raw": { ... }
  }
}
```

| Status | Meaning |
|---|---|
| `SUCCESS` | Fully booked and ticketed |
| `ON_HOLD` | PNR created, not yet ticketed |
| `PENDING` | Processing |
| `CANCELLED` | Cancelled |
| `FAILED` | Failed |
| `ABORTED` | Aborted |
| `UNCONFIRMED` | Hold released / PNR cancelled |

---

### POST /api/v1/flights/unhold

Release a held booking without ticketing.

**Request:**
```json
{
  "bookingId": "BOOKING_ID",
  "pnrs": ["ABC123"]
}
```

> After calling this, verify with `/booking-details` — status should be `UNCONFIRMED`.

---

### POST /api/v1/flights/amendment/charges

Get cancellation charges before submitting.

**Request:**
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

### POST /api/v1/flights/amendment/submit

Submit the cancellation. Same request body as `/amendment/charges`.

**Response includes** `amendmentId` — use it to poll `/amendment/details`.

---

### POST /api/v1/flights/amendment/details

Poll amendment status.

**Request:**
```json
{
  "amendmentId": "AMENDMENT_ID"
}
```

| Status | Meaning |
|---|---|
| `REQUESTED` | Processing — poll again in 10s |
| `PENDING` | Still pending |
| `SUCCESS` | Cancellation complete |
| `REJECTED` | Cancellation rejected |

> Poll every 10 seconds, up to 4–5 times while status is `REQUESTED`.

---

### GET /api/v1/flights/balance

Get provider wallet balance.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalBalance": 50000,
    "walletBalance": 30000,
    "creditBalance": 20000,
    "totalOutStanding": 0
  }
}
```
