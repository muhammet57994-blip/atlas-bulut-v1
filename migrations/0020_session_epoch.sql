-- A single settings row records when every device was signed out. Sessions minted
-- before that instant stop verifying, so one lost phone can be revoked without
-- rotating the access password.
CREATE TABLE IF NOT EXISTS atlas_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
