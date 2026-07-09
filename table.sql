-- =============================================================
-- Hotel Microservice — Database Schema
-- All tables are prefixed with hotels_ to avoid conflicts
-- =============================================================

-- 1. hotels_regions
-- Master city/region table. All static city data from suppliers is normalised here.
CREATE TABLE IF NOT EXISTS hotels_regions (
    id                  BIGSERIAL PRIMARY KEY,

    supplier            VARCHAR(50)  NOT NULL,
    supplier_region_id  VARCHAR(100) NOT NULL,

    region_type         VARCHAR(20),

    city_name           TEXT,
    region_name         TEXT,
    state_name          TEXT,
    country_name        TEXT,
    country_code        CHAR(2),

    full_region_name    TEXT,
    normalized_name     TEXT,

    latitude            NUMERIC(10, 6),
    longitude           NUMERIC(10, 6),

    is_active           BOOLEAN   DEFAULT TRUE,

    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW(),

    UNIQUE (supplier, supplier_region_id)
);

CREATE INDEX IF NOT EXISTS idx_hotels_regions_supplier
    ON hotels_regions (supplier, supplier_region_id);

CREATE INDEX IF NOT EXISTS idx_hotels_regions_city
    ON hotels_regions (city_name);

CREATE INDEX IF NOT EXISTS idx_hotels_regions_country
    ON hotels_regions (country_name);

CREATE INDEX IF NOT EXISTS idx_hotels_regions_fullname
    ON hotels_regions USING gin (to_tsvector('simple', COALESCE(full_region_name, '')));

-- Migrations: add columns if the table already exists without them
ALTER TABLE hotels_regions
    ADD COLUMN IF NOT EXISTS region_type      VARCHAR(20),
    ADD COLUMN IF NOT EXISTS city_name        TEXT,
    ADD COLUMN IF NOT EXISTS region_name      TEXT,
    ADD COLUMN IF NOT EXISTS state_name       TEXT,
    ADD COLUMN IF NOT EXISTS country_name     TEXT,
    ADD COLUMN IF NOT EXISTS country_code     CHAR(2),
    ADD COLUMN IF NOT EXISTS full_region_name TEXT,
    ADD COLUMN IF NOT EXISTS normalized_name  TEXT,
    ADD COLUMN IF NOT EXISTS latitude         NUMERIC(10, 6),
    ADD COLUMN IF NOT EXISTS longitude        NUMERIC(10, 6),
    ADD COLUMN IF NOT EXISTS is_active        BOOLEAN   DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMP DEFAULT NOW();

-- Add unique constraint if it was missing from the original table creation
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'hotels_regions_supplier_supplier_region_id_key'
          AND conrelid = 'hotels_regions'::regclass
    ) THEN
        ALTER TABLE hotels_regions
            ADD CONSTRAINT hotels_regions_supplier_supplier_region_id_key
            UNIQUE (supplier, supplier_region_id);
    END IF;
END $$;

-- =============================================================

-- 2. hotels_inventory
-- Master hotel inventory. Normalised from supplier data; never coupled to a single supplier schema.
CREATE TABLE IF NOT EXISTS hotels_inventory (
    id                  BIGSERIAL PRIMARY KEY,

    supplier            VARCHAR(50)  NOT NULL,
    supplier_hotel_id   VARCHAR(100) NOT NULL,
    unica_id            VARCHAR(100),

    region_id           BIGINT REFERENCES hotels_regions (id),

    name                TEXT NOT NULL,
    slug                TEXT,

    property_type       VARCHAR(50),

    description         JSONB,

    rating              NUMERIC(2, 1),

    is_deleted          BOOLEAN DEFAULT FALSE,

    latitude            NUMERIC(10, 6),
    longitude           NUMERIC(10, 6),

    address_line        TEXT,
    postal_code         VARCHAR(20),

    city_name           TEXT,
    state_name          TEXT,
    country_name        TEXT,
    country_code        CHAR(2),

    contact_phone       TEXT,
    contact_email       TEXT,
    contact_fax         TEXT,
    website             TEXT,

    raw_data            JSONB,

    search_vector       TSVECTOR,

    last_synced_at      TIMESTAMP,

    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW(),

    UNIQUE (supplier, supplier_hotel_id)
);

CREATE INDEX IF NOT EXISTS idx_hotels_inventory_supplier
    ON hotels_inventory (supplier, supplier_hotel_id);

CREATE INDEX IF NOT EXISTS idx_hotels_inventory_region
    ON hotels_inventory (region_id);

CREATE INDEX IF NOT EXISTS idx_hotels_inventory_rating
    ON hotels_inventory (rating);

-- Migrations: add columns if the table already exists without them
ALTER TABLE hotels_inventory
    ADD COLUMN IF NOT EXISTS unica_id       VARCHAR(100),
    ADD COLUMN IF NOT EXISTS region_id      BIGINT REFERENCES hotels_regions (id),
    ADD COLUMN IF NOT EXISTS slug           TEXT,
    ADD COLUMN IF NOT EXISTS property_type  VARCHAR(50),
    ADD COLUMN IF NOT EXISTS description    JSONB,
    ADD COLUMN IF NOT EXISTS rating         NUMERIC(2, 1),
    ADD COLUMN IF NOT EXISTS is_deleted     BOOLEAN   DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS latitude       NUMERIC(10, 6),
    ADD COLUMN IF NOT EXISTS longitude      NUMERIC(10, 6),
    ADD COLUMN IF NOT EXISTS address_line   TEXT,
    ADD COLUMN IF NOT EXISTS postal_code    VARCHAR(20),
    ADD COLUMN IF NOT EXISTS city_name      TEXT,
    ADD COLUMN IF NOT EXISTS state_name     TEXT,
    ADD COLUMN IF NOT EXISTS country_name   TEXT,
    ADD COLUMN IF NOT EXISTS country_code   CHAR(2),
    ADD COLUMN IF NOT EXISTS contact_phone  TEXT,
    ADD COLUMN IF NOT EXISTS contact_email  TEXT,
    ADD COLUMN IF NOT EXISTS contact_fax    TEXT,
    ADD COLUMN IF NOT EXISTS website        TEXT,
    ADD COLUMN IF NOT EXISTS raw_data       JSONB,
    ADD COLUMN IF NOT EXISTS search_vector  TSVECTOR,
    ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMP DEFAULT NOW();

-- Add unique constraint if it was missing from the original table creation
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'hotels_inventory_supplier_supplier_hotel_id_key'
          AND conrelid = 'hotels_inventory'::regclass
    ) THEN
        ALTER TABLE hotels_inventory
            ADD CONSTRAINT hotels_inventory_supplier_supplier_hotel_id_key
            UNIQUE (supplier, supplier_hotel_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hotels_inventory_search
    ON hotels_inventory USING gin (search_vector);

-- Partial B-tree index — every query filters is_deleted = false.
-- On 500k rows this avoids a full table scan just to skip deleted hotels.
CREATE INDEX IF NOT EXISTS idx_hotels_inventory_active_region
    ON hotels_inventory (region_id, rating DESC NULLS LAST)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_hotels_inventory_active_rating
    ON hotels_inventory (rating DESC NULLS LAST, name)
    WHERE is_deleted = false;

CREATE OR REPLACE FUNCTION hotels_inventory_search_vector_update()
RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('simple', COALESCE(NEW.name, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.city_name, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(NEW.state_name, '')), 'C') ||
        setweight(to_tsvector('simple', COALESCE(NEW.country_name, '')), 'C') ||
        setweight(to_tsvector('simple', COALESCE(NEW.property_type, '')), 'D');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hotels_inventory_search_vector ON hotels_inventory;

CREATE TRIGGER trg_hotels_inventory_search_vector
    BEFORE INSERT OR UPDATE ON hotels_inventory
    FOR EACH ROW
    EXECUTE FUNCTION hotels_inventory_search_vector_update();

-- Backfill existing rows that have search_vector = NULL.
-- Safe to re-run; skips already-indexed rows. Takes a few minutes on 500k rows.
UPDATE hotels_inventory
SET search_vector =
    setweight(to_tsvector('simple', COALESCE(name, '')),          'A') ||
    setweight(to_tsvector('simple', COALESCE(city_name, '')),     'B') ||
    setweight(to_tsvector('simple', COALESCE(state_name, '')),    'C') ||
    setweight(to_tsvector('simple', COALESCE(country_name, '')),  'C') ||
    setweight(to_tsvector('simple', COALESCE(property_type, '')), 'D')
WHERE search_vector IS NULL;

-- =============================================================

-- 3. hotels_images
CREATE TABLE IF NOT EXISTS hotels_images (
    id          BIGSERIAL PRIMARY KEY,

    hotel_id    BIGINT REFERENCES hotels_inventory (id) ON DELETE CASCADE,

    image_url      TEXT NOT NULL,
    image_size     VARCHAR(50),
    is_hero_image  BOOLEAN DEFAULT FALSE,
    sort_order     INT DEFAULT 0,

    created_at     TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotels_images_hotel
    ON hotels_images (hotel_id);

-- Migrations: add columns if the table already exists without them
ALTER TABLE hotels_images
    ADD COLUMN IF NOT EXISTS image_size     VARCHAR(50),
    ADD COLUMN IF NOT EXISTS is_hero_image  BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS sort_order     INT DEFAULT 0;

-- =============================================================

-- 4. hotels_facilities
CREATE TABLE IF NOT EXISTS hotels_facilities (
    id              BIGSERIAL PRIMARY KEY,

    hotel_id        BIGINT REFERENCES hotels_inventory (id) ON DELETE CASCADE,

    facility_code   VARCHAR(100),
    facility_type   VARCHAR(100),
    facility_name   TEXT,

    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotels_facilities_hotel
    ON hotels_facilities (hotel_id);

-- Migrations: add columns if the table already exists without them
ALTER TABLE hotels_facilities
    ADD COLUMN IF NOT EXISTS facility_code  VARCHAR(100),
    ADD COLUMN IF NOT EXISTS facility_type  VARCHAR(100),
    ADD COLUMN IF NOT EXISTS facility_name  TEXT;

-- =============================================================

-- 5. hotels_sync_logs
-- Audit trail for every supplier sync job (cities, hotels, etc.).
CREATE TABLE IF NOT EXISTS hotels_sync_logs (
    id                  BIGSERIAL PRIMARY KEY,

    supplier            VARCHAR(50),
    sync_type           VARCHAR(50),

    request_url         TEXT,
    request_payload     JSONB,
    response_payload    JSONB,
    response_status     INT,

    records_processed   INT     DEFAULT 0,
    success             BOOLEAN,
    error_message       TEXT,

    started_at          TIMESTAMP,
    completed_at        TIMESTAMP,

    created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotels_sync_logs_supplier
    ON hotels_sync_logs (supplier);

CREATE INDEX IF NOT EXISTS idx_hotels_sync_logs_created
    ON hotels_sync_logs (created_at);

-- =============================================================

-- 6. hotels_api_logs
-- Logs every outbound HTTP call to TripJack (written async, non-blocking).
CREATE TABLE IF NOT EXISTS hotels_api_logs (
    id                  BIGSERIAL PRIMARY KEY,

    trace_id            UUID,

    client_type         VARCHAR(20),
    client_id           VARCHAR(100),

    endpoint            TEXT,
    method              VARCHAR(10),

    request_headers     JSONB,
    request_body        JSONB,

    response_status     INT,
    response_body       JSONB,

    ip_address          TEXT,

    response_time_ms    INT,

    success             BOOLEAN,
    error_message       TEXT,

    created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotels_api_logs_trace
    ON hotels_api_logs (trace_id);

CREATE INDEX IF NOT EXISTS idx_hotels_api_logs_client
    ON hotels_api_logs (client_id);

CREATE INDEX IF NOT EXISTS idx_hotels_api_logs_created
    ON hotels_api_logs (created_at);

CREATE INDEX IF NOT EXISTS idx_hotels_api_logs_endpoint
    ON hotels_api_logs (endpoint);

-- =============================================================

-- 7. hotels_bookings
-- Confirmed hotel bookings. Populated in the booking flow (Phase 2+).
CREATE TABLE IF NOT EXISTS hotels_bookings (
    id                      BIGSERIAL PRIMARY KEY,

    booking_reference       UUID,

    supplier                VARCHAR(50),
    supplier_booking_id     VARCHAR(100),

    hotel_id                BIGINT REFERENCES hotels_inventory (id),

    client_id               VARCHAR(100),

    booking_status          VARCHAR(50),

    checkin_date            DATE,
    checkout_date           DATE,

    amount                  NUMERIC(12, 2),
    currency                VARCHAR(10),

    guest_details           JSONB,
    booking_response        JSONB,
    cancellation_response   JSONB,

    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotels_bookings_supplier
    ON hotels_bookings (supplier, supplier_booking_id);

CREATE INDEX IF NOT EXISTS idx_hotels_bookings_client
    ON hotels_bookings (client_id);

CREATE INDEX IF NOT EXISTS idx_hotels_bookings_hotel
    ON hotels_bookings (hotel_id);

CREATE INDEX IF NOT EXISTS idx_hotels_bookings_status
    ON hotels_bookings (booking_status);

CREATE INDEX IF NOT EXISTS idx_hotels_bookings_created
    ON hotels_bookings (created_at);

-- =============================================================

-- 8. hotels_booking_logs
-- Lifecycle events for each booking (prebook, confirm, cancel, refund, retry).
CREATE TABLE IF NOT EXISTS hotels_booking_logs (
    id                  BIGSERIAL PRIMARY KEY,

    booking_id          BIGINT REFERENCES hotels_bookings (id),

    action              VARCHAR(50),

    request_payload     JSONB,
    response_payload    JSONB,

    success             BOOLEAN,
    error_message       TEXT,

    created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotels_booking_logs_booking
    ON hotels_booking_logs (booking_id);

CREATE INDEX IF NOT EXISTS idx_hotels_booking_logs_created
    ON hotels_booking_logs (created_at);

-- =============================================================
-- ─── ICICI eCollections ──────────────────────────────────────

-- 9. virtual_accounts
-- Each row is a Virtual Account Number (VAN) issued to a customer for payment.
-- VAN format: CNK1 + 8-digit booking/payment ID (e.g. CNK100000001)
CREATE TABLE IF NOT EXISTS public.virtual_accounts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  van                      TEXT NOT NULL UNIQUE,
  status                   TEXT NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'expired', 'paid', 'paid_partial')),
  expected_amount          NUMERIC(12, 2),
  expires_at               TIMESTAMPTZ,
  booking_id               UUID,
  payment_order_id         UUID,
  generic_payment_link_id  UUID,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_virtual_accounts_van    ON public.virtual_accounts (van);
CREATE INDEX IF NOT EXISTS idx_virtual_accounts_status ON public.virtual_accounts (status);

-- 10. icici_ecollection_transactions
-- One row per UTR (unique transaction reference from ICICI).
-- Written on MSG HOLD and updated on MIS POSTING.
CREATE TABLE IF NOT EXISTS public.icici_ecollection_transactions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  virtual_account_id          UUID REFERENCES public.virtual_accounts(id),
  van                         TEXT NOT NULL,
  client_code                 TEXT NOT NULL DEFAULT '',
  mode                        TEXT,
  utr                         TEXT NOT NULL UNIQUE,
  sender_remark               TEXT,
  client_account_no           TEXT,
  amount                      NUMERIC(12, 2),
  payer_name                  TEXT,
  payer_acc_number            TEXT,
  payer_bank_ifsc             TEXT,
  payer_payment_date          TEXT,
  bank_internal_txn_number    TEXT,
  userid                      TEXT,
  msg_hold_decision           TEXT,
  msg_hold_reject_reason      TEXT,
  msg_hold_at                 TIMESTAMPTZ,
  msg_hold_raw_payload        JSONB,
  payment_status              TEXT,
  expected_amount_at_credit   NUMERIC(12, 2),
  mis_posted_at               TIMESTAMPTZ,
  mis_raw_payload             JSONB,
  mis_acknowledged_at         TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_icici_txn_utr ON public.icici_ecollection_transactions (utr);
CREATE INDEX IF NOT EXISTS idx_icici_txn_van ON public.icici_ecollection_transactions (van);

-- 11. icici_request_logs
-- Logs every inbound hit to ICICI endpoints (stub phase).
-- Used to confirm ICICI is successfully reaching our URLs during onboarding.
CREATE TABLE IF NOT EXISTS public.icici_request_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint       TEXT NOT NULL,
  ip             TEXT,
  van            TEXT,
  utr            TEXT,
  raw_body       JSONB,
  response_body  JSONB,
  error          TEXT,
  hit_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migration: add columns if table already exists
ALTER TABLE public.icici_request_logs
  ADD COLUMN IF NOT EXISTS response_body  JSONB,
  ADD COLUMN IF NOT EXISTS error          TEXT,
  ADD COLUMN IF NOT EXISTS van            TEXT,
  ADD COLUMN IF NOT EXISTS utr            TEXT;

CREATE INDEX IF NOT EXISTS idx_icici_request_logs_van ON public.icici_request_logs (van);
CREATE INDEX IF NOT EXISTS idx_icici_request_logs_utr ON public.icici_request_logs (utr);

ALTER TABLE public.icici_ecollection_transactions
  ADD COLUMN IF NOT EXISTS userid                    TEXT,
  ADD COLUMN IF NOT EXISTS msg_hold_reject_reason    TEXT,
  ADD COLUMN IF NOT EXISTS expected_amount_at_credit NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS manual_review             BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS manual_review_reason      TEXT;

CREATE INDEX IF NOT EXISTS idx_icici_txn_manual_review
  ON public.icici_ecollection_transactions (manual_review)
  WHERE manual_review = TRUE;

-- Update virtual_accounts status CHECK to include paid_partial
ALTER TABLE public.virtual_accounts
  DROP CONSTRAINT IF EXISTS virtual_accounts_status_check;

ALTER TABLE public.virtual_accounts
  ADD CONSTRAINT virtual_accounts_status_check
  CHECK (status IN ('active', 'expired', 'paid', 'paid_partial'));

-- =============================================================

-- 12. hotels_nationalities
-- Reference list of supplier nationality/country IDs used in hotel live search,
-- detail, and review requests (the `nationality` field). TripJack does not
-- expose a documented "fetch nationality list" API, so this table is
-- maintained manually via POST /api/v1/hotels/nationalities rather than a
-- sync job. Seeded with the one ID confirmed by a working test booking.
CREATE TABLE IF NOT EXISTS hotels_nationalities (
    id                       BIGSERIAL PRIMARY KEY,

    supplier                 VARCHAR(50)  NOT NULL DEFAULT 'tripjack',
    supplier_nationality_id  VARCHAR(20)  NOT NULL,

    country_name             TEXT         NOT NULL,
    iso_code                 CHAR(2),

    is_default               BOOLEAN      NOT NULL DEFAULT FALSE,

    created_at               TIMESTAMP    DEFAULT NOW(),
    updated_at               TIMESTAMP    DEFAULT NOW(),

    UNIQUE (supplier, supplier_nationality_id)
);

CREATE INDEX IF NOT EXISTS idx_hotels_nationalities_country_name
    ON hotels_nationalities (country_name);

-- Only one row may be the default nationality at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_hotels_nationalities_one_default
    ON hotels_nationalities (supplier)
    WHERE is_default = TRUE;

-- =============================================================

-- 13. flights_sync_logs
-- Audit trail for the nightly Delhi-origin indicative flight price sync
-- (writes directly into cnk-website's `departures.flight_price_del` /
-- `flight_price_updated_at` columns, in the same Supabase project).
-- Mirrors hotels_sync_logs exactly.
CREATE TABLE IF NOT EXISTS flights_sync_logs (
    id                  BIGSERIAL PRIMARY KEY,
    supplier            VARCHAR(50),
    sync_type           VARCHAR(50),
    request_url         TEXT,
    request_payload     JSONB,
    response_payload    JSONB,
    response_status     INT,
    records_processed   INT     DEFAULT 0,
    success             BOOLEAN,
    error_message       TEXT,
    started_at          TIMESTAMP,
    completed_at        TIMESTAMP,
    created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flights_sync_logs_created
    ON flights_sync_logs (created_at);
