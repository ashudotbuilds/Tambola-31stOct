-- Event setup foundation. Participant import creates inactive accounts until
-- credential issuance and delivery have been configured.
CREATE INDEX IF NOT EXISTS events_status_updated_idx ON events(status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS participant_profiles_external_id_idx
  ON participant_profiles(event_id, lower(trim(external_id)))
  WHERE external_id IS NOT NULL AND trim(external_id) <> '';
CREATE INDEX IF NOT EXISTS participant_profiles_user_idx ON participant_profiles(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx ON audit_logs(resource_type, resource_id, created_at DESC);
