-- Flight bookings — one row per booking created via the flight service
CREATE TABLE IF NOT EXISTS public.flight_bookings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            TEXT NOT NULL,                        -- tripjack | travclan | tbo
  provider_booking_id TEXT NOT NULL,                        -- bookingId returned by the provider
  status              TEXT NOT NULL DEFAULT 'PENDING',      -- SUCCESS | ON_HOLD | PENDING | CANCELLED | FAILED | ABORTED | UNCONFIRMED
  booking_type        TEXT NOT NULL DEFAULT 'INSTANT',      -- INSTANT | HOLD
  total_fare          NUMERIC,
  currency            TEXT NOT NULL DEFAULT 'INR',
  search_params       JSONB,                                -- original search params for reference
  booking_request     JSONB,                                -- full book request payload
  booking_response    JSONB,                                -- full provider response
  created_by          TEXT,                                 -- user email / user_id from the calling app
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Passengers per flight booking
CREATE TABLE IF NOT EXISTS public.flight_passengers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_booking_id    UUID NOT NULL REFERENCES public.flight_bookings(id) ON DELETE CASCADE,
  passenger_type       TEXT NOT NULL,   -- ADULT | CHILD | INFANT
  title                TEXT,
  first_name           TEXT NOT NULL,
  last_name            TEXT NOT NULL,
  dob                  DATE,
  passport_number      TEXT,
  passport_expiry      DATE,
  passport_nationality TEXT,
  pan_number           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at on flight_bookings
CREATE OR REPLACE FUNCTION public.update_flight_bookings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_flight_bookings_updated_at
  BEFORE UPDATE ON public.flight_bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_flight_bookings_updated_at();
