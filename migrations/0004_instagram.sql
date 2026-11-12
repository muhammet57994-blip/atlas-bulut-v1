CREATE TABLE IF NOT EXISTS atlas_instagram_connection (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 encrypted_token TEXT NOT NULL,
 username TEXT NOT NULL,
 connected_at TEXT NOT NULL
);
