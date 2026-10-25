-- Preserve audit identities and game history even after removal from active use.
ALTER TABLE games ADD COLUMN deleted_at timestamptz;
ALTER TABLE audit_logs ADD COLUMN actor_name text;
ALTER TABLE audit_logs ADD COLUMN actor_email text;
UPDATE audit_logs a SET actor_name = u.name, actor_email = u.email FROM users u WHERE a.actor_id = u.id;
CREATE INDEX audit_logs_resource_cursor_idx ON audit_logs(resource_type, resource_id, created_at DESC, id DESC);
CREATE INDEX games_visible_idx ON games(created_at DESC) WHERE deleted_at IS NULL;
