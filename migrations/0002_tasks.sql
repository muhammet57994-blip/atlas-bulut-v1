CREATE TABLE IF NOT EXISTS atlas_tasks (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 due_date TEXT NOT NULL DEFAULT '',
 done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0,1)),
 created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS atlas_tasks_open_unique ON atlas_tasks(title, due_date) WHERE done = 0;
