-- Additive migration: existing records and their identifiers remain intact.
ALTER TABLE atlas_agenda ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0);
ALTER TABLE atlas_agenda ADD COLUMN archived_at TEXT;
ALTER TABLE atlas_expenses ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0);
ALTER TABLE atlas_expenses ADD COLUMN archived_at TEXT;
ALTER TABLE atlas_notes ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0);
ALTER TABLE atlas_notes ADD COLUMN archived_at TEXT;

CREATE TABLE atlas_record_changes (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 draft_id TEXT NOT NULL UNIQUE,
 record_kind TEXT NOT NULL CHECK(record_kind IN ('agenda','expense','note')),
 record_id INTEGER NOT NULL CHECK(record_id > 0),
 action TEXT NOT NULL CHECK(action IN ('edit','archive','unarchive','undo')),
 before_revision INTEGER NOT NULL CHECK(before_revision >= 0),
 before_json TEXT NOT NULL CHECK(json_valid(before_json)),
 after_json TEXT NOT NULL CHECK(json_valid(after_json)),
 created_at TEXT NOT NULL,
 undo_of INTEGER UNIQUE REFERENCES atlas_record_changes(id),
 CHECK((action = 'undo') = (undo_of IS NOT NULL))
);
CREATE INDEX atlas_record_changes_record ON atlas_record_changes(record_kind,record_id,id);
CREATE INDEX atlas_record_changes_created ON atlas_record_changes(created_at,id);

-- One journal INSERT both verifies and applies a change. SQLite rolls back the
-- entire statement (including the journal) if a record constraint fails.
CREATE TRIGGER atlas_record_changes_agenda_guard BEFORE INSERT ON atlas_record_changes
WHEN NEW.record_kind = 'agenda'
BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM atlas_agenda WHERE id = NEW.record_id AND revision = NEW.before_revision
  AND title IS json_extract(NEW.before_json,'$.title')
  AND starts_at IS json_extract(NEW.before_json,'$.starts_at')
  AND ends_at IS json_extract(NEW.before_json,'$.ends_at')
  AND archived_at IS json_extract(NEW.before_json,'$.archived_at')
 ) THEN RAISE(ABORT,'stale agenda revision') END;
END;
CREATE TRIGGER atlas_record_changes_expense_guard BEFORE INSERT ON atlas_record_changes
WHEN NEW.record_kind = 'expense'
BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM atlas_expenses WHERE id = NEW.record_id AND revision = NEW.before_revision
  AND title IS json_extract(NEW.before_json,'$.title')
  AND amount_minor IS json_extract(NEW.before_json,'$.amount_minor')
  AND currency IS json_extract(NEW.before_json,'$.currency')
  AND category IS json_extract(NEW.before_json,'$.category')
  AND spent_day IS json_extract(NEW.before_json,'$.spent_day')
  AND archived_at IS json_extract(NEW.before_json,'$.archived_at')
 ) THEN RAISE(ABORT,'stale expense revision') END;
END;
CREATE TRIGGER atlas_record_changes_note_guard BEFORE INSERT ON atlas_record_changes
WHEN NEW.record_kind = 'note'
BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM atlas_notes WHERE id = NEW.record_id AND revision = NEW.before_revision
  AND text IS json_extract(NEW.before_json,'$.text')
  AND archived_at IS json_extract(NEW.before_json,'$.archived_at')
 ) THEN RAISE(ABORT,'stale note revision') END;
END;
CREATE TRIGGER atlas_record_changes_undo_guard BEFORE INSERT ON atlas_record_changes
WHEN NEW.action = 'undo'
BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM atlas_record_changes WHERE id = NEW.undo_of AND action != 'undo'
  AND record_kind = NEW.record_kind AND record_id = NEW.record_id
  AND after_json = NEW.before_json AND before_json = NEW.after_json
 ) THEN RAISE(ABORT,'invalid undo target') END;
END;
CREATE TRIGGER atlas_record_changes_agenda_apply AFTER INSERT ON atlas_record_changes
WHEN NEW.record_kind = 'agenda'
BEGIN
 UPDATE atlas_agenda SET title = json_extract(NEW.after_json,'$.title'),
 starts_at = json_extract(NEW.after_json,'$.starts_at'), ends_at = json_extract(NEW.after_json,'$.ends_at'),
 archived_at = json_extract(NEW.after_json,'$.archived_at'), revision = revision + 1 WHERE id = NEW.record_id;
END;
CREATE TRIGGER atlas_record_changes_expense_apply AFTER INSERT ON atlas_record_changes
WHEN NEW.record_kind = 'expense'
BEGIN
 UPDATE atlas_expenses SET title = json_extract(NEW.after_json,'$.title'),
 amount_minor = json_extract(NEW.after_json,'$.amount_minor'), currency = json_extract(NEW.after_json,'$.currency'),
 category = json_extract(NEW.after_json,'$.category'), spent_day = json_extract(NEW.after_json,'$.spent_day'),
 archived_at = json_extract(NEW.after_json,'$.archived_at'), revision = revision + 1 WHERE id = NEW.record_id;
END;
CREATE TRIGGER atlas_record_changes_note_apply AFTER INSERT ON atlas_record_changes
WHEN NEW.record_kind = 'note'
BEGIN
 UPDATE atlas_notes SET text = json_extract(NEW.after_json,'$.text'),
 archived_at = json_extract(NEW.after_json,'$.archived_at'), revision = revision + 1 WHERE id = NEW.record_id;
END;
CREATE TRIGGER atlas_record_changes_no_update BEFORE UPDATE ON atlas_record_changes
BEGIN SELECT RAISE(ABORT,'record history is immutable'); END;
CREATE TRIGGER atlas_record_changes_no_delete BEFORE DELETE ON atlas_record_changes
BEGIN SELECT RAISE(ABORT,'record history is immutable'); END;
