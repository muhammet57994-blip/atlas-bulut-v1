CREATE TABLE atlas_lists (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 title_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('list','project')),
 state_json TEXT NOT NULL CHECK(json_valid(state_json)),
 revision INTEGER NOT NULL CHECK(revision > 0),
 archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 last_operation_id TEXT NOT NULL
);
CREATE UNIQUE INDEX atlas_lists_active_name ON atlas_lists(kind,title_key) WHERE archived=0;
CREATE TABLE atlas_list_changes (
 id TEXT PRIMARY KEY,
 list_id TEXT NOT NULL REFERENCES atlas_lists(id),
 action TEXT NOT NULL,
 title TEXT NOT NULL,
 before_json TEXT,
 after_json TEXT NOT NULL,
 before_revision INTEGER NOT NULL,
 after_revision INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 undone INTEGER NOT NULL DEFAULT 0 CHECK(undone IN (0,1)),
 undo_of TEXT UNIQUE REFERENCES atlas_list_changes(id)
);
CREATE INDEX atlas_list_changes_latest ON atlas_list_changes(created_at DESC);
