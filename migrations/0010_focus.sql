CREATE TABLE atlas_focus_sessions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 draft_id TEXT NOT NULL UNIQUE,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 task_id INTEGER CHECK(task_id IS NULL OR task_id > 0),
 planned_seconds INTEGER NOT NULL CHECK(planned_seconds BETWEEN 300 AND 10800 AND planned_seconds % 60 = 0),
 elapsed_seconds INTEGER NOT NULL DEFAULT 0 CHECK(elapsed_seconds BETWEEN 0 AND planned_seconds),
 status TEXT NOT NULL CHECK(status IN ('running','paused','finished')),
 started_at_ms INTEGER NOT NULL CHECK(started_at_ms >= 0),
 started_day TEXT NOT NULL,
 last_started_at_ms INTEGER,
 finished_at_ms INTEGER,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
 last_operation_id TEXT NOT NULL,
 CHECK((status = 'running' AND last_started_at_ms IS NOT NULL AND finished_at_ms IS NULL)
    OR (status = 'paused' AND last_started_at_ms IS NULL AND finished_at_ms IS NULL)
    OR (status = 'finished' AND last_started_at_ms IS NULL AND finished_at_ms IS NOT NULL))
);
-- One owner shares this database across all of their devices.
CREATE UNIQUE INDEX atlas_focus_one_unfinished ON atlas_focus_sessions((1)) WHERE status IN ('running','paused');
CREATE INDEX atlas_focus_day ON atlas_focus_sessions(started_day);
