ALTER TABLE users ADD COLUMN login_id text;
CREATE UNIQUE INDEX users_login_id_idx ON users(lower(login_id)) WHERE login_id IS NOT NULL;
