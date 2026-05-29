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

-- ─── One-time backfill ────────────────────────────────────────────────────────
-- Run this once after deploying the updated trigger to re-index existing rows.
-- Safe to run multiple times (WHERE search_vector IS NULL skips already-indexed rows).
-- On 500k rows this will take a few minutes — run during low-traffic window.
--
-- UPDATE hotels_inventory
-- SET updated_at = updated_at   -- touching any column re-fires the trigger
-- WHERE is_deleted = false;
--
-- Or rebuild directly without touching updated_at:
-- UPDATE hotels_inventory SET search_vector =
--   setweight(to_tsvector('simple', COALESCE(name, '')),          'A') ||
--   setweight(to_tsvector('simple', COALESCE(city_name, '')),     'B') ||
--   setweight(to_tsvector('simple', COALESCE(state_name, '')),    'C') ||
--   setweight(to_tsvector('simple', COALESCE(country_name, '')),  'C') ||
--   setweight(to_tsvector('simple', COALESCE(property_type, '')), 'D');
-- ─────────────────────────────────────────────────────────────────────────────

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

-- =============================================================

-- 3. hotels_images
CREATE TABLE IF NOT EXISTS hotels_images (
    id          BIGSERIAL PRIMARY KEY,

    hotel_id    BIGINT REFERENCES hotels_inventory (id) ON DELETE CASCADE,

    image_url   TEXT NOT NULL,
    image_size  VARCHAR(50),
    sort_order  INT DEFAULT 0,

    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotels_images_hotel
    ON hotels_images (hotel_id);

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
