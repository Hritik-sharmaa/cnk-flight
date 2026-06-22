# ✈️ Tripjack Air API — Integration Guide

# 🚀 Quick Overview

Tripjack Air API is a **REST-based web service over HTTPS** using JSON. Authentication uses a shared `apikey` header on every request. Follow the steps below in order — each step depends on data from the previous one.

> ⚠️ **Important:** Never end an endpoint URL with `/` — it will return an error.
> 

---

# 🌐 Base URLs

## UAT (Sandbox)

`https://apitest.tripjack.com`

## Production

`https://tripjack.com`

---

# 🔑 Authentication

Every request must include the API key in the **request header**:

```
apikey: YOUR_API_KEY_HERE
Content-Type: application/json
```

> Get your sandbox or production API key from Tripjack. The same header format applies to all endpoints.
> 

---

# 🗺️ API Flow — Step by Step

The complete booking journey follows this sequence:

```
1. SEARCH → 2. REVIEW → 3. (Optional) FARE RULE / SEAT MAP → 4. BOOK → 5. BOOKING DETAILS
```

For **Hold bookings**, there's an extra step:

```
1. SEARCH → 2. REVIEW → 3. HOLD BOOK → 4. CONFIRM FARE → 5. CONFIRM-BOOK → 6. BOOKING DETAILS
```

---

# Step 1 — 🔍 Search API

Search for available flights. Returns cheapest fare options from all suppliers.

**Endpoint:** `POST /fms/v1/air-search-all`

**Full URL (UAT):** `https://apitest.tripjack.com/fms/v1/air-search-all`

## Request Body

```json
{
  "searchQuery": {
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
        "travelDate": "YYYY-MM-DD"
      }
    ],
    "searchModifiers": {
      "isDirectFlight": false,
      "isConnectingFlight": false,
      "pft": "REGULAR"
    },
    "preferredAirline": [
      { "code": "6E" }
    ]
  }
}
```

## Request Parameters

| Field | Parent | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `searchQuery` | root | Object | ✅ Mandatory | Root search object |
| `cabinClass` | searchQuery | String | Optional | `ECONOMY` / `PREMIUM_ECONOMY` / `BUSINESS` / `FIRST`. Default: ECONOMY |
| `paxInfo` | searchQuery | Object | ✅ Mandatory | Passenger count |
| `ADULT` | paxInfo | String | ✅ Mandatory | Number of adults |
| `CHILD` | paxInfo | String | Optional | Number of children |
| `INFANT` | paxInfo | String | Optional | Number of infants |
| `routeInfos` | searchQuery | ArrayList | ✅ Mandatory | List of route segments |
| `fromCityOrAirport.code` | routeInfos | String | ✅ Mandatory | IATA departure code (e.g. DEL) |
| `toCityOrAirport.code` | routeInfos | String | ✅ Mandatory | IATA arrival code (e.g. BOM) |
| `travelDate` | routeInfos | String | ✅ Mandatory | Format: `YYYY-MM-DD` |
| `searchModifiers` | searchQuery | Object | Optional | Flight type filters |
| `isDirectFlight` | searchModifiers | Boolean | Optional | `true` = direct only |
| `isConnectingFlight` | searchModifiers | Boolean | Optional | `true` = connecting only |
| `pft` | searchModifiers | String | Optional | `REGULAR` / `STUDENT` / `SENIOR_CITIZEN` |
| `preferredAirline` | searchQuery | ArrayList | Optional | Max 10 airline codes |
- 📦 Route Info Rules
    - **One-way (Domestic or International):** 1 routeInfo
    - **Return (Domestic):** 2 routeInfos
    - **Return (International) / Multi-city:** 2–6 routeInfos

## Response Key Fields

| Field | Type | Description |
| --- | --- | --- |
| `searchResult.tripInfos.ONWARD` | ArrayList | Onward flight options |
| `searchResult.tripInfos.RETURN` | ArrayList | Return flight options (domestic return) |
| `searchResult.tripInfos.COMBO` | ArrayList | Combined results (international return/multi-city) |
| `sI` | ArrayList | Segment information list |
| `totalPriceList` | ArrayList | Price options per trip |
| `totalPriceList[].id` | String | ⭐ **Price ID** — used in Review API. Valid 30 minutes |
| `totalPriceList[].fareIdentifier` | String | `PUBLISHED` / `SPECIAL_RETURN` / `TJ_FLEX` |
| `sI[].fD.al.code` | String | Airline IATA code |
| `sI[].dt` | String | Departure time (YYYY-MM-DD HH:MM) |
| `sI[].at` | String | Arrival time (YYYY-MM-DD HH:MM) |
| `sI[].duration` | Integer | Duration in minutes |
| `sI[].stops` | Integer | Number of stops |
| `totalPriceList[].fd.ADULT.fC.TF` | Number | Total fare per adult |
| `totalPriceList[].fd.ADULT.bI.iB` | String | Check-in baggage (e.g. 20Kg) |
| `totalPriceList[].fd.ADULT.rT` | Integer | Refundable: `0`=No, `1`=Yes, `2`=Partial |

> ✅ **Save the `id` from `totalPriceList`** — you need this as `priceId` in the Review API.
> 

---

# Step 2 — 🔄 Review API (Revalidate)

Revalidates fare and creates a booking session. Returns a `bookingId` for subsequent steps.

**Endpoint:** `POST /fms/v1/review`

**Full URL (UAT):** `https://apitest.tripjack.com/fms/v1/review`

## Request Body

```json
{
  "priceIds": [
    "PRICE_ID_FROM_SEARCH_RESULT"
  ]
}
```

## Request Parameters

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `priceIds` | ArrayList | ✅ Mandatory | Price IDs from Search. Send 2 for domestic return, 1 for all others |

## Response Key Fields

| Field | Type | Description |
| --- | --- | --- |
| `bookingId` | String | ⭐ **Booking ID** — used in all following APIs |
| `conditions.st` | Integer | Session valid time in seconds |
| `conditions.isBA` | Boolean | Is Hold (block) booking allowed? |
| `conditions.isa` | Boolean | Is Seat selection available? |
| `conditions.iecr` | Boolean | Is Emergency Contact required? |
| `conditions.gst.igm` | Boolean | Is GST mandatory? |
| `conditions.gst.gstappl` | Boolean | Is GST applicable? |
| `conditions.dob.adobr` | Boolean | Adult DOB required? |
| `conditions.dob.cdobr` | Boolean | Child DOB required? |
| `conditions.dob.idobr` | Boolean | Infant DOB required? |
| `conditions.pcs.pm` | Boolean | Passport mandatory? (International) |
| `conditions.pcs.pped` | Boolean | Passport expiry date required? |
| `conditions.dc.ida` | Boolean | Document ID applicable? (Student/Senior fares) |
| `conditions.ipa` | Boolean | PAN card applicable? |
| `totalPriceInfo.totalFareDetail.fc.TF` | Number | Total fare to charge |
| `tripInfos[].sI[].id` | String | Segment ID — used for SSR selection |
| `tripInfos[].sI[].ssrInfo` | Object | Available SSRs (Meal, Baggage, Extra) |

> ⚠️ **Check all `conditions` fields carefully** — they determine what's mandatory in the Book request.
> 

---

# Step 3 (Optional) — 📋 Fare Rule API

Fetch cancellation, date change, no-show charges and conditions.

**Endpoint:** `POST /fms/v2/farerule`

**Full URL (UAT):** `https://apitest.tripjack.com/fms/v2/farerule`

## Request Body

```json
{
  "flowType": "SEARCH",
  "id": "PRICE_ID_or_BOOKING_ID"
}
```

## Request Parameters

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `flowType` | String | ✅ Mandatory | `SEARCH` (use priceId) / `REVIEW` or `BOOKING_DETAIL` (use bookingId) |
| `id` | String | ✅ Mandatory | Price ID or Booking ID |

## Response Key Fields

| Field | Description |
| --- | --- |
| `farerule[DEL-BOM].tfr.CANCELLATION` | Cancellation policies list |
| `farerule[DEL-BOM].tfr.DATECHANGE` | Date change policies |
| `farerule[DEL-BOM].tfr.NO_SHOW` | No-show policies |
| `tfr[].amount` | Airline fee for policy |
| `tfr[].additionalFee` | Tripjack fee |
| `tfr[].st` | Policy start time (hours before departure) |
| `tfr[].et` | Policy end time (hours before departure) |
| `tfr[].pp` | Policy period: `BEFORE_DEPARTURE` / `AFTER_DEPARTURE` / `DEFAULT` |
| `farerule[DEL-BOM].miscInfo` | Plain text Cat 16 fare rule (if mini rule not available) |

---

# Step 3 (Optional) — 💺 Seat Map API

Fetch seat availability and layout. Only available when `conditions.isa = true` in Review response.

**Endpoint:** `POST /fms/v1/seat`

**Full URL (UAT):** `https://apitest.tripjack.com/fms/v1/seat`

## Request Body

```json
{
  "bookingId": "BOOKING_ID_FROM_REVIEW"
}
```

## Response Key Fields

| Field | Type | Description |
| --- | --- | --- |
| `tripSeatMap[segmentId].sData.row` | Integer | Number of rows |
| `tripSeatMap[segmentId].sData.column` | Integer | Number of columns |
| `tripSeatMap[segmentId].sInfo[]` | Array | List of seat objects |
| `sInfo[].seatNo` | String | Seat number (e.g. 12A) |
| `sInfo[].code` | String | ⭐ Seat code — pass in Book request |
| `sInfo[].amount` | Double | Seat charge |
| `sInfo[].isBooked` | Boolean | Already taken? |
| `sInfo[].isLegroom` | Boolean | Leg room seat? |
| `sInfo[].isAisle` | Boolean | Aisle seat? |
| `sInfo[].isExitRow` | Boolean | Exit row seat? |
| `sInfo[].seatPosition.row` | Integer | Row position |
| `sInfo[].seatPosition.column` | Integer | Column position |

---

# Step 4 — 🎟️ Booking API

Four booking modes are available depending on your flow:

- 4A — Instant Book (Direct Ticketing with Payment)
    
    **Endpoint:** `POST /oms/v1/air/book`
    
    **Full URL (UAT):** `https://apitest.tripjack.com/oms/v1/air/book`
    
    ## Request Body
    
    ```json
    {
      "bookingId": "BOOKING_ID_FROM_REVIEW",
      "paymentInfos": [
        { "amount": 0 }
      ],
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
          "fN": "First Name",
          "lN": "Last Name",
          "dob": "YYYY-MM-DD",
          "pNum": "PASSPORT_NUMBER",
          "eD": "YYYY-MM-DD",
          "pNat": "IN",
          "pid": "YYYY-MM-DD",
          "pan": "PAN_NUMBER",
          "ssrBaggageInfos": [{"key": "SEGMENT_ID", "code": "SSR_CODE"}],
          "ssrMealInfos": [{"key": "SEGMENT_ID", "code": "SSR_CODE"}],
          "ssrSeatInfos": [{"key": "SEGMENT_ID", "code": "SEAT_CODE"}],
          "ssrExtraServiceInfos": [{"key": "SEGMENT_ID", "code": "SSR_CODE"}],
          "di": "DOCUMENT_ID"
        }
      ],
      "gstInfo": {
        "gstNumber": "15_DIGIT_GST",
        "registeredName": "Company Name",
        "email": "gst@company.com",
        "mobile": "+919500112233",
        "address": "GST Registered Address"
      }
    }
    ```
    
    ## Request Parameters
    
    | Field | Type | Required | Description |
    | --- | --- | --- | --- |
    | `bookingId` | String | ✅ Mandatory | From Review response |
    | `paymentInfos[].amount` | Number | ✅ Mandatory | Total fare (TF from Review) |
    | `deliveryInfo.emails` | Array | ✅ Mandatory | Customer email for ticket delivery |
    | `deliveryInfo.contacts` | Array | ✅ Mandatory | Customer phone with country code |
    | `contactInfo` | Object | Conditional | Required if `iecr=true` in Review |
    | `contactInfo.ecn` | String | Conditional | Emergency contact name |
    | `travellerInfo[].ti` | String | ✅ Mandatory | Title: Adult→Mr/Mrs/Ms, Child→Ms/Master |
    | `travellerInfo[].pt` | String | ✅ Mandatory | `ADULT` / `CHILD` / `INFANT` |
    | `travellerInfo[].fN` | String | ✅ Mandatory | First name |
    | `travellerInfo[].lN` | String | ✅ Mandatory | Last name |
    | `travellerInfo[].dob` | String | Conditional | DOB if required in Review conditions |
    | `travellerInfo[].pNum` | String | Conditional | Passport number (international) |
    | `travellerInfo[].eD` | String | Conditional | Passport expiry date |
    | `travellerInfo[].pNat` | String | Conditional | Passport nationality (2-letter IATA) |
    | `travellerInfo[].pid` | String | Conditional | Passport issue date |
    | `travellerInfo[].pan` | String | Conditional | PAN number if `ipa=true` |
    | `travellerInfo[].di` | String | Conditional | Document ID if `dc.idm=true` |
    | `travellerInfo[].ssrBaggageInfos` | Array | Optional | Selected baggage SSR per segment |
    | `travellerInfo[].ssrMealInfos` | Array | Optional | Selected meal SSR per segment |
    | `travellerInfo[].ssrSeatInfos` | Array | Optional | Selected seat per segment |
    | `gstInfo` | Object | Conditional | Required if `igm=true` or `gstappl=true` |
    | `gstInfo.gstNumber` | String | Conditional | 15-digit GST number |
    | `gstInfo.registeredName` | String | Conditional | Max 35 chars (IATA standard) |
    
    ## Response
    
    | Field | Description |
    | --- | --- |
    | `bookingId` | Booking ID (same as input) |
    | `status` | Status object of the API call |
- 4B — Hold Booking (Without Payment)
    
    Same as Instant Book but **do NOT send `paymentInfos`**.
    
    **Endpoint:** `POST /oms/v1/air/book`
    
    > After a successful Hold, call **Confirm Fare** → then **Confirm-Book** to ticket.
    > 
- 4C — Confirm Fare Before Ticketing (Pre-check for Hold)
    
    Validates fare is still available before committing payment on a held PNR.
    
    **Endpoint:** `POST /oms/v1/air/fare-validate`
    
    **Full URL (UAT):** `https://apitest.tripjack.com/oms/v1/air/fare-validate`
    
    ```json
    { "bookingId": "BOOKING_ID" }
    ```
    
    Possible responses: Fare valid ✅ / Fare not available ❌ / Hold expired ⏱️ / Fare alert ⚠️
    
- 4D — Confirm-Book (Ticket the Hold Booking)
    
    Converts a held PNR to a confirmed ticket with payment.
    
    **Endpoint:** `POST /oms/v1/air/confirm-book`
    
    **Full URL (UAT):** `https://apitest.tripjack.com/oms/v1/air/confirm-book`
    
    ```json
    {
      "bookingId": "BOOKING_ID",
      "paymentInfos": [
        { "amount": 0 }
      ]
    }
    ```
    

---

# Step 5 — 📄 Booking Details API

Retrieve booking status, PNR, and ticket numbers after booking.

**Endpoint:** `POST /oms/v1/booking-details`

**Full URL (UAT):** `https://apitest.tripjack.com/oms/v1/booking-details`

## Request Body

```json
{
  "bookingId": "BOOKING_ID_FROM_REVIEW",
  "requirePaxPricing": true
}
```

## Request Parameters

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `bookingId` | String | ✅ Mandatory | From Review response |
| `requirePaxPricing` | Boolean | Optional | `true` = include per-pax pricing detail |

## Response Key Fields

| Field | Description |
| --- | --- |
| `order.bookingId` | Tripjack booking reference |
| `order.amount` | Amount charged |
| `order.status` | `SUCCESS` / `ON_HOLD` / `CANCELLED` / `FAILED` / `PENDING` / `ABORTED` / `UNCONFIRMED` |
| `order.orderNote` | Any order-related notes |
| `itemInfos.AIR.travellerInfos[].pnrDetails` | Map of `DEP-ARR: PNR` |
| `itemInfos.AIR.travellerInfos[].gdsPnrs` | Map of `DEP-ARR: GDS_PNR` (optional) |
| `itemInfos.AIR.travellerInfos[].ticketNumberDetails` | Map of `DEP-ARR: TicketNo` |
| `itemInfos.AIR.travellerInfos[].statusMap` | Amendment status per traveller |
| `itemInfos.AIR.totalPriceInfo.totalFareDetail.fc.TF` | Total fare charged |
| `itemInfos.AIR.totalPriceInfo.totalFareDetail.fc.SSRP` | SSR total price |
| `gstInfo` | GST details passed at booking |

---

# Step 6 (Optional) — 🔓 Release PNR (Unhold)

Cancel a held PNR when customer doesn't want to confirm.

**Endpoint:** `POST /oms/v1/air/unhold`

**Full URL (UAT):** `https://apitest.tripjack.com/oms/v1/air/unhold`

```json
{
  "bookingId": "BOOKING_ID",
  "pnrs": ["PNR1", "PNR2"]
}
```

> After calling this, verify by calling Booking Details — status should be `UNCONFIRMED`.
> 

---

# Step 7 (Optional) — ❌ Amendment API (Cancellation)

Three-step process for cancellations.

- 7A — Get Amendment Charges (Optional pre-check)
    
    **Endpoint:** `POST /oms/v1/air/amendment/amendment-charges`
    
    **Full URL (UAT):** `https://apitest.tripjack.com/oms/v1/air/amendment/amendment-charges`
    
    ```json
    {
      "bookingId": "BOOKING_ID",
      "type": "CANCELLATION",
      "remarks": "Customer requested cancellation",
      "trips": [
        {
          "src": "DEL",
          "dest": "BOM",
          "departureDate": "YYYY-MM-DD",
          "travellers": [
            { "fn": "First Name", "ln": "Last Name" }
          ]
        }
      ]
    }
    ```
    
    **Response includes:** `amendmentCharges`, `refundAmount`, `totalFare` per pax type per trip.
    
- 7B — Submit Amendment (Apply Cancellation)
    
    **Endpoint:** `POST /oms/v1/air/amendment/submit-amendment`
    
    Same request structure as Get Charges. Returns `amendmentId` for polling.
    
- 7C — Get Amendment Details (Poll Status)
    
    **Endpoint:** `POST /oms/v1/air/amendment/amendment-details`
    
    ```json
    { "amendmentId": "AMENDMENT_ID_FROM_SUBMIT" }
    ```
    
    **Response:** `amendmentStatus` → `REQUESTED` / `PENDING` / `SUCCESS` / `REJECTED`
    
    > Poll 4–5 times with 10s intervals if status is `REQUESTED`.
    > 

---

# 👤 User Balance API

**Endpoint:** `GET /ums/v1/user-detail`

**Full URL (UAT):** `https://apitest.tripjack.com/ums/v1/user-detail`

No request body needed. Just pass `apikey` header.

**Response fields:** `userId`, `totalBalance`, `walletBalance`, `creditBalance`, `totalOutStanding`

---

# 📚 All Endpoints — Quick Reference

| # | Service | Method | UAT Endpoint |
| --- | --- | --- | --- |
| 1 | Search | POST | `https://apitest.tripjack.com/fms/v1/air-search-all` |
| 2 | Review / Revalidate | POST | `https://apitest.tripjack.com/fms/v1/review` |
| 3 | Fare Rule | POST | `https://apitest.tripjack.com/fms/v2/farerule` |
| 4 | Seat Map | POST | `https://apitest.tripjack.com/fms/v1/seat` |
| 5 | Fare Validate (pre-book) | POST | `https://apitest.tripjack.com/oms/v1/air/book/fare-validate` |
| 6 | Instant / Hold Book | POST | `https://apitest.tripjack.com/oms/v1/air/book` |
| 7 | Confirm Fare (pre-ticket) | POST | `https://apitest.tripjack.com/oms/v1/air/fare-validate` |
| 8 | Confirm-Book (ticket hold) | POST | `https://apitest.tripjack.com/oms/v1/air/confirm-book` |
| 9 | Booking Details | POST | `https://apitest.tripjack.com/oms/v1/booking-details` |
| 10 | Release PNR | POST | `https://apitest.tripjack.com/oms/v1/air/unhold` |
| 11 | Get Amendment Charges | POST | `https://apitest.tripjack.com/oms/v1/air/amendment/amendment-charges` |
| 12 | Submit Amendment | POST | `https://apitest.tripjack.com/oms/v1/air/amendment/submit-amendment` |
| 13 | Amendment Details | POST | `https://apitest.tripjack.com/oms/v1/air/amendment/amendment-details` |
| 14 | User Balance | GET | `https://apitest.tripjack.com/ums/v1/user-detail` |

---

# 📝 Common Field Reference

## Fare Components (fC)

| Code | Description |
| --- | --- |
| `BF` | Base Fare |
| `TAF` | Taxes and Fees |
| `NF` | Net Fare |
| `NCM` | Net Commission (Gross Commission - TDS) |
| `TF` | **Total Fare** (amount to charge customer) |
| `YQ` | Fuel Surcharge |
| `YR` | Carrier Misc Fee |
| `MF` | Management Fee |
| `MFT` | Management Fee Tax (GST on MF) |
| `FTC` | Flex Total Charges (TJ_FLEX fare) |
| `AGST` | Airline GST |

## Commission Components (afc.NCM)

| Code | Description |
| --- | --- |
| `OT` | Gross Commission |
| `TDS` | TDS deducted |

## Booking Status Values

| Status | Meaning |
| --- | --- |
| `SUCCESS` | Fully booked and ticketed |
| `ON_HOLD` | PNR created, not ticketed |
| `PENDING` | Processing |
| `CANCELLED` | Cancelled |
| `FAILED` | Failed |
| `ABORTED` | Aborted |
| `UNCONFIRMED` | Hold released / PNR cancelled |

## Refundable Type (rT)

| Value | Meaning |
| --- | --- |
| `0` | Non-Refundable |
| `1` | Refundable |
| `2` | Partial Refundable |

---

# ⚠️ Key Integration Gotchas

1. **Price IDs expire in 30 minutes** — don't cache them longer
2. **Review session (`st`) countdown starts immediately** — book before it expires
3. **Always check all `conditions` in Review response** — missing mandatory fields cause booking failure
4. **Amount in Book request must equal `TF` from Review** — total gross fare
5. **SSR segment key** = the `id` field from `sI[]` in Review response — not the segment number
6. **For domestic return with SPECIAL_RETURN fare** — both journeys must be SPECIAL_RETURN
7. **GST `registeredName` max 35 chars, `address` max 70 chars** (IATA standard)
8. **Emergency Contact (`contactInfo`)** — only required when `iecr=true` in Review
9. **PAN number** — only required when `ipa=true` in Review
10. **Never end any endpoint URL with `/`** — will return an error

---

# 🧪 Postman Collection

Download: [https://www.getpostman.com/collections/3fe3424de3e8118a6432](https://www.getpostman.com/collections/3fe3424de3e8118a6432)

Setup:

1. Download the collection JSON from the link above
2. Import into Postman
3. Create an Environment with variables: `apikey` (your key) and `host` (`apitest.tripjack.com`)

[📋 UAT Certification — Test Cases, Document Requirements & Error Codes](https://www.notion.so/UAT-Certification-Test-Cases-Document-Requirements-Error-Codes-3619ae31c52a811d8c24d7b19caf48ae?pvs=21)