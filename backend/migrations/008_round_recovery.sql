CREATE TABLE round_recovery_records (
  round_id uuid PRIMARY KEY REFERENCES rounds(id) ON DELETE RESTRICT,
  detected_at timestamptz NOT NULL DEFAULT now(),
  validation_status text NOT NULL CHECK (validation_status IN ('PENDING','VALID','FAILED')),
  validation_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_validated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX round_recovery_status_idx ON round_recovery_records(validation_status, detected_at DESC);
