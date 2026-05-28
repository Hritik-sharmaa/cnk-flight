-- =============================================================
-- Hotel Microservice — Database Schema
-- =============================================================

-- 1. regions
-- Master city/region table. All static city data from suppliers is normalised here.
CREATE TABLE IF NOT EXISTS regions (
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

CREATE INDEX IF NOT EXISTS idx_regions_supplier
    ON regions (supplier, supplier_region_id);

CREATE INDEX IF NOT EXISTS idx_regions_city
    ON regions (city_name);

CREATE INDEX IF NOT EXISTS idx_regions_country
    ON regions (country_name);

CREATE INDEX IF NOT EXISTS idx_regions_fullname
    ON regions USING gin (to_tsvector('simple', COALESCE(full_region_name, '')));

-- =============================================================

-- 2. hotels
-- Master hotel inventory. Normalised from supplier data; never coupled to a single supplier schema.
CREATE TABLE IF NOT EXISTS hotels (
    id                  BIGSERIAL PRIMARY KEY,

    supplier            VARCHAR(50)  NOT NULL,
    supplier_hotel_id   VARCHAR(100) NOT NULL,

    region_id           BIGINT REFERENCES regions (id),

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

CREATE INDEX IF NOT EXISTS idx_hotels_supplier
    ON hotels (supplier, supplier_hotel_id);

CREATE INDEX IF NOT EXISTS idx_hotels_region
    ON hotels (region_id);

CREATE INDEX IF NOT EXISTS idx_hotels_rating
    ON hotels (rating);

CREATE INDEX IF NOT EXISTS idx_hotels_search
    ON hotels USING gin (search_vector);

CREATE OR REPLACE FUNCTION hotels_search_vector_update()
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

DROP TRIGGER IF EXISTS trg_hotels_search_vector ON hotels;

CREATE TRIGGER trg_hotels_search_vector
    BEFORE INSERT OR UPDATE ON hotels
    FOR EACH ROW
    EXECUTE FUNCTION hotels_search_vector_update();

-- =============================================================

-- 3. hotel_images
CREATE TABLE IF NOT EXISTS hotel_images (
    id          BIGSERIAL PRIMARY KEY,

    hotel_id    BIGINT REFERENCES hotels (id) ON DELETE CASCADE,

    image_url   TEXT NOT NULL,
    image_size  VARCHAR(50),
    sort_order  INT DEFAULT 0,

    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotel_images_hotel
    ON hotel_images (hotel_id);

-- =============================================================

-- 4. hotel_facilities
CREATE TABLE IF NOT EXISTS hotel_facilities (
    id              BIGSERIAL PRIMARY KEY,

    hotel_id        BIGINT REFERENCES hotels (id) ON DELETE CASCADE,

    facility_code   VARCHAR(100),
    facility_type   VARCHAR(100),
    facility_name   TEXT,

    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotel_facilities_hotel
    ON hotel_facilities (hotel_id);

-- =============================================================

-- 5. supplier_sync_logs
-- Audit trail for every TripJack sync job (cities, hotels, etc.).
CREATE TABLE IF NOT EXISTS supplier_sync_logs (
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

CREATE INDEX IF NOT EXISTS idx_supplier_sync_logs_supplier
    ON supplier_sync_logs (supplier);

CREATE INDEX IF NOT EXISTS idx_supplier_sync_logs_created
    ON supplier_sync_logs (created_at);

-- =============================================================

-- 6. api_request_logs
-- Logs every outbound HTTP call made to TripJack (written async, non-blocking).
-- Also used for inbound API request tracing.
CREATE TABLE IF NOT EXISTS api_request_logs (
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

CREATE INDEX IF NOT EXISTS idx_api_logs_trace
    ON api_request_logs (trace_id);

CREATE INDEX IF NOT EXISTS idx_api_logs_client
    ON api_request_logs (client_id);

CREATE INDEX IF NOT EXISTS idx_api_logs_created
    ON api_request_logs (created_at);

CREATE INDEX IF NOT EXISTS idx_api_logs_endpoint
    ON api_request_logs (endpoint);

-- =============================================================

-- 7. bookings
-- Confirmed hotel bookings. Populated in the booking flow (Phase 2+).
CREATE TABLE IF NOT EXISTS bookings (
    id                      BIGSERIAL PRIMARY KEY,

    booking_reference       UUID,

    supplier                VARCHAR(50),
    supplier_booking_id     VARCHAR(100),

    hotel_id                BIGINT REFERENCES hotels (id),

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

CREATE INDEX IF NOT EXISTS idx_bookings_supplier
    ON bookings (supplier, supplier_booking_id);

CREATE INDEX IF NOT EXISTS idx_bookings_client
    ON bookings (client_id);

CREATE INDEX IF NOT EXISTS idx_bookings_hotel
    ON bookings (hotel_id);

CREATE INDEX IF NOT EXISTS idx_bookings_status
    ON bookings (booking_status);

CREATE INDEX IF NOT EXISTS idx_bookings_created
    ON bookings (created_at);

-- =============================================================

-- 8. booking_logs
-- Lifecycle events for each booking (prebook, confirm, cancel, refund, retry).
CREATE TABLE IF NOT EXISTS booking_logs (
    id                  BIGSERIAL PRIMARY KEY,

    booking_id          BIGINT REFERENCES bookings (id),

    action              VARCHAR(50),

    request_payload     JSONB,
    response_payload    JSONB,

    success             BOOLEAN,
    error_message       TEXT,

    created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_logs_booking
    ON booking_logs (booking_id);

CREATE INDEX IF NOT EXISTS idx_booking_logs_created
    ON booking_logs (created_at);
