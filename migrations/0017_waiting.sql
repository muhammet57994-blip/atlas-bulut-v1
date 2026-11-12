-- All entries are manual declarations. One journal INSERT and its triggers
-- enforce capacity, compare-and-swap and record changes in one atomic statement.
CREATE TABLE atlas_waiting (
 id TEXT PRIMARY KEY,
 who TEXT NOT NULL CHECK(length(who) BETWEEN 0 AND 200),
 who_key TEXT NOT NULL,
 what TEXT NOT NULL CHECK(length(what) BETWEEN 1 AND 200),
 what_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('reply','delivery')),
 followup_date TEXT NOT NULL DEFAULT '',
 last_contact_date TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('waiting','received','cancelled')),
 archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
 revision INTEGER NOT NULL CHECK(revision > 0),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 last_operation_id TEXT NOT NULL,
 CHECK(kind='delivery' OR length(who)>0)
);
CREATE INDEX atlas_waiting_due ON atlas_waiting(archived,status,followup_date);
CREATE TABLE atlas_waiting_operations (
 id TEXT PRIMARY KEY,
 waiting_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('create','edit','set-status','archive','restore')),
 expected_revision INTEGER NOT NULL CHECK(expected_revision >= 0),
 before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
 after_json TEXT NOT NULL CHECK(json_valid(after_json)),
 created_at TEXT NOT NULL
);
CREATE TRIGGER atlas_waiting_operations_guard BEFORE INSERT ON atlas_waiting_operations
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM atlas_waiting_operations)>=5000 THEN RAISE(ABORT,'waiting operation limit') END;
 SELECT CASE WHEN NEW.action='create' AND ((SELECT COUNT(*) FROM atlas_waiting)>=200 OR EXISTS(SELECT 1 FROM atlas_waiting WHERE id=NEW.waiting_id) OR NEW.expected_revision!=0 OR NEW.before_json IS NOT NULL OR json_extract(NEW.after_json,'$.archived')!=0 OR json_extract(NEW.after_json,'$.status')!='waiting') THEN RAISE(ABORT,'waiting record limit or invalid create') END;
 SELECT CASE WHEN NEW.action!='create' AND NOT EXISTS(
  SELECT 1 FROM atlas_waiting WHERE id=NEW.waiting_id AND revision=NEW.expected_revision
  AND who IS json_extract(NEW.before_json,'$.who')
  AND who_key IS json_extract(NEW.before_json,'$.who_key')
  AND what IS json_extract(NEW.before_json,'$.what')
  AND what_key IS json_extract(NEW.before_json,'$.what_key')
  AND kind IS json_extract(NEW.before_json,'$.kind')
  AND followup_date IS json_extract(NEW.before_json,'$.followup_date')
  AND last_contact_date IS json_extract(NEW.before_json,'$.last_contact_date')
  AND status IS json_extract(NEW.before_json,'$.status')
  AND archived IS json_extract(NEW.before_json,'$.archived')
 ) THEN RAISE(ABORT,'stale waiting state') END;
END;
CREATE TRIGGER atlas_waiting_operations_create AFTER INSERT ON atlas_waiting_operations
WHEN NEW.action='create'
BEGIN
 INSERT INTO atlas_waiting(id,who,who_key,what,what_key,kind,followup_date,last_contact_date,status,archived,revision,created_at,updated_at,last_operation_id)
 VALUES(NEW.waiting_id,json_extract(NEW.after_json,'$.who'),json_extract(NEW.after_json,'$.who_key'),json_extract(NEW.after_json,'$.what'),json_extract(NEW.after_json,'$.what_key'),json_extract(NEW.after_json,'$.kind'),json_extract(NEW.after_json,'$.followup_date'),json_extract(NEW.after_json,'$.last_contact_date'),'waiting',0,1,NEW.created_at,NEW.created_at,NEW.id);
END;
CREATE TRIGGER atlas_waiting_operations_update AFTER INSERT ON atlas_waiting_operations
WHEN NEW.action IN ('edit','set-status','archive','restore')
BEGIN
 UPDATE atlas_waiting SET who=json_extract(NEW.after_json,'$.who'),who_key=json_extract(NEW.after_json,'$.who_key'),what=json_extract(NEW.after_json,'$.what'),what_key=json_extract(NEW.after_json,'$.what_key'),kind=json_extract(NEW.after_json,'$.kind'),followup_date=json_extract(NEW.after_json,'$.followup_date'),last_contact_date=json_extract(NEW.after_json,'$.last_contact_date'),status=json_extract(NEW.after_json,'$.status'),archived=json_extract(NEW.after_json,'$.archived'),revision=revision+1,updated_at=NEW.created_at,last_operation_id=NEW.id WHERE id=NEW.waiting_id;
END;
CREATE TRIGGER atlas_waiting_operations_no_update BEFORE UPDATE ON atlas_waiting_operations
BEGIN SELECT RAISE(ABORT,'waiting operation history is immutable'); END;
CREATE TRIGGER atlas_waiting_operations_no_delete BEFORE DELETE ON atlas_waiting_operations
BEGIN SELECT RAISE(ABORT,'waiting operation history is immutable'); END;
