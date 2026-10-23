CREATE TABLE participant_credential_deliveries (
  participant_profile_id uuid PRIMARY KEY REFERENCES participant_profiles(id) ON DELETE CASCADE,
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  status text NOT NULL CHECK (status IN ('PENDING','SENT','FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_attempt_at timestamptz,
  last_sent_at timestamptz,
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX participant_credential_status_idx ON participant_credential_deliveries(status, updated_at DESC);
