CREATE TABLE idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (char_length(operation) BETWEEN 1 AND 100),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_id, operation, idempotency_key)
);
CREATE INDEX idempotency_records_created_idx ON idempotency_records(created_at);
