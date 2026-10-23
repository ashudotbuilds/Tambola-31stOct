CREATE TABLE admin_credential_deliveries (
  admin_profile_id uuid PRIMARY KEY REFERENCES admin_profiles(id) ON DELETE CASCADE,
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  status text NOT NULL CHECK (status IN ('PENDING','SENT','FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_attempt_at timestamptz,
  last_sent_at timestamptz,
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_credential_status_idx ON admin_credential_deliveries(status, updated_at DESC);
