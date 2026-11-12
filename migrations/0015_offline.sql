ALTER TABLE atlas_notes ADD COLUMN offline_draft_id TEXT;
CREATE UNIQUE INDEX atlas_notes_offline_draft ON atlas_notes(offline_draft_id) WHERE offline_draft_id IS NOT NULL;
CREATE TABLE atlas_offline_receipts (
 id TEXT PRIMARY KEY,
 type TEXT NOT NULL CHECK(type IN ('note-create','note-edit','list-add','list-item-status')),
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
 operation_id TEXT NOT NULL UNIQUE,
 target_id TEXT,
 expected_revision INTEGER NOT NULL,
 before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
 after_json TEXT NOT NULL CHECK(json_valid(after_json)),
 title TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TRIGGER atlas_offline_guard BEFORE INSERT ON atlas_offline_receipts
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM atlas_offline_receipts)>=2000 THEN RAISE(ABORT,'offline history full') END;
 SELECT CASE WHEN NEW.type='note-create' AND ((SELECT COUNT(*) FROM atlas_notes)>=100 OR EXISTS(SELECT 1 FROM atlas_notes WHERE text=json_extract(NEW.after_json,'$.text'))) THEN RAISE(ABORT,'note capacity or duplicate') END;
 SELECT CASE WHEN NEW.type='note-edit' AND (
  NOT EXISTS(SELECT 1 FROM atlas_notes WHERE id=NEW.target_id AND revision=NEW.expected_revision AND archived_at IS NULL AND text IS json_extract(NEW.before_json,'$.text'))
  OR (SELECT COUNT(*) FROM atlas_record_changes WHERE action!='undo')>=5000
 ) THEN RAISE(ABORT,'offline note changed') END;
 SELECT CASE WHEN NEW.type IN ('list-add','list-item-status') AND (
  NOT EXISTS(SELECT 1 FROM atlas_lists WHERE id=NEW.target_id AND revision=NEW.expected_revision AND archived=0 AND state_json=NEW.before_json
   AND id=json_extract(NEW.after_json,'$.id') AND title=json_extract(NEW.after_json,'$.title') AND kind=json_extract(NEW.after_json,'$.kind'))
  OR json_extract(NEW.after_json,'$.archived')!=0 OR json_array_length(NEW.after_json,'$.items')>100
  OR (SELECT COUNT(*) FROM atlas_list_changes WHERE action!='undo')>=5000
 ) THEN RAISE(ABORT,'offline list changed') END;
END;
CREATE TRIGGER atlas_offline_note_create AFTER INSERT ON atlas_offline_receipts WHEN NEW.type='note-create'
BEGIN
 INSERT INTO atlas_notes(text,created_at,offline_draft_id) VALUES(json_extract(NEW.after_json,'$.text'),NEW.created_at,NEW.id);
END;
CREATE TRIGGER atlas_offline_note_edit AFTER INSERT ON atlas_offline_receipts WHEN NEW.type='note-edit'
BEGIN
 INSERT INTO atlas_record_changes(draft_id,record_kind,record_id,action,before_revision,before_json,after_json,created_at)
 VALUES(NEW.operation_id,'note',CAST(NEW.target_id AS INTEGER),'edit',NEW.expected_revision,NEW.before_json,NEW.after_json,NEW.created_at);
END;
CREATE TRIGGER atlas_offline_list_apply AFTER INSERT ON atlas_offline_receipts WHEN NEW.type IN ('list-add','list-item-status')
BEGIN
 UPDATE atlas_lists SET state_json=NEW.after_json,revision=revision+1,updated_at=NEW.created_at,last_operation_id=NEW.operation_id WHERE id=NEW.target_id;
 INSERT INTO atlas_list_changes(id,list_id,action,title,before_json,after_json,before_revision,after_revision,created_at,undone,undo_of)
 VALUES(NEW.operation_id,NEW.target_id,CASE WHEN NEW.type='list-add' THEN 'add-items' ELSE 'set-status' END,NEW.title,NEW.before_json,NEW.after_json,NEW.expected_revision,NEW.expected_revision+1,NEW.created_at,0,NULL);
END;
CREATE TRIGGER atlas_offline_receipts_no_update BEFORE UPDATE ON atlas_offline_receipts BEGIN SELECT RAISE(ABORT,'immutable offline receipt'); END;
CREATE TRIGGER atlas_offline_receipts_no_delete BEFORE DELETE ON atlas_offline_receipts BEGIN SELECT RAISE(ABORT,'immutable offline receipt'); END;
