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

CREATE OR REPLACE FUNCTION hotels_inventory_search_vector_update()
RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        to_tsvector(
            'simple',
            COALESCE(NEW.name, '') || ' ' ||
            COALESCE(NEW.city_name, '') || ' ' ||
            COALESCE(NEW.country_name, '')
        );
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
