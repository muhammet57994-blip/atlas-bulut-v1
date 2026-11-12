ALTER TABLE atlas_tasks ADD COLUMN recurrence TEXT NOT NULL DEFAULT '' CHECK(recurrence IN ('','daily','weekly'));
ALTER TABLE atlas_tasks ADD COLUMN completed_at TEXT NOT NULL DEFAULT '';
CREATE TABLE atlas_task_completions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 task_id INTEGER NOT NULL,
 completed_at TEXT NOT NULL
);
CREATE INDEX atlas_completions_date ON atlas_task_completions(completed_at);
CREATE TRIGGER atlas_task_completion AFTER UPDATE OF completed_at ON atlas_tasks
WHEN NEW.completed_at <> '' AND NEW.completed_at <> OLD.completed_at
BEGIN
 INSERT INTO atlas_task_completions(task_id,completed_at) VALUES(NEW.id,NEW.completed_at);
END;
CREATE TABLE atlas_content_calendar (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 due_date TEXT NOT NULL,
 format TEXT NOT NULL CHECK(format IN ('reels','hikâye','carousel')),
 published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
 created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX atlas_calendar_unique ON atlas_content_calendar(title,due_date,format);
CREATE TABLE atlas_instagram_snapshots (
 day TEXT PRIMARY KEY,
 captured_at TEXT NOT NULL,
 payload TEXT NOT NULL
);
