-- Task blocks share the agenda; ordinary appointments always have a null task_id.
ALTER TABLE atlas_agenda ADD COLUMN task_id INTEGER;
CREATE UNIQUE INDEX atlas_agenda_active_task ON atlas_agenda(task_id)
 WHERE task_id IS NOT NULL AND archived_at IS NULL;

-- Every relevant mutation invalidates outstanding plans, including changes made
-- by older handlers, record management and other devices. The epoch also catches
-- changes that were subsequently reverted before confirmation.
CREATE TABLE atlas_replan_state (
 id INTEGER PRIMARY KEY CHECK(id=1),
 epoch INTEGER NOT NULL CHECK(epoch>=0)
);
INSERT INTO atlas_replan_state(id,epoch) VALUES(1,0);
CREATE TRIGGER atlas_replan_tasks_insert AFTER INSERT ON atlas_tasks BEGIN
 UPDATE atlas_replan_state SET epoch=epoch+1 WHERE id=1;
END;
CREATE TRIGGER atlas_replan_tasks_update AFTER UPDATE ON atlas_tasks BEGIN
 UPDATE atlas_replan_state SET epoch=epoch+1 WHERE id=1;
END;
CREATE TRIGGER atlas_replan_tasks_delete AFTER DELETE ON atlas_tasks BEGIN
 UPDATE atlas_replan_state SET epoch=epoch+1 WHERE id=1;
END;
CREATE TRIGGER atlas_replan_agenda_insert AFTER INSERT ON atlas_agenda BEGIN
 UPDATE atlas_replan_state SET epoch=epoch+1 WHERE id=1;
END;
CREATE TRIGGER atlas_replan_agenda_update AFTER UPDATE ON atlas_agenda BEGIN
 UPDATE atlas_replan_state SET epoch=epoch+1 WHERE id=1;
END;
CREATE TRIGGER atlas_replan_agenda_delete AFTER DELETE ON atlas_agenda BEGIN
 UPDATE atlas_replan_state SET epoch=epoch+1 WHERE id=1;
END;

CREATE TABLE atlas_replan_receipts (
 id TEXT PRIMARY KEY,
 expected_epoch INTEGER NOT NULL,
 snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash)=64),
 target_date TEXT NOT NULL,
 window_start_ms INTEGER NOT NULL,
 window_end_ms INTEGER NOT NULL CHECK(window_end_ms>window_start_ms),
 approved_at_ms INTEGER NOT NULL,
 blocks_json TEXT NOT NULL CHECK(json_valid(blocks_json) AND json_type(blocks_json)='array' AND json_array_length(blocks_json) BETWEEN 1 AND 10),
 created_at TEXT NOT NULL
);

-- One statement owns validation and all writes. RAISE(ABORT), including any
-- constraint failure in the apply trigger, rolls the entire statement back.
CREATE TRIGGER atlas_replan_guard BEFORE INSERT ON atlas_replan_receipts BEGIN
 SELECT CASE WHEN NEW.expected_epoch IS NOT (SELECT epoch FROM atlas_replan_state WHERE id=1)
  THEN RAISE(ABORT,'replan stale state') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM atlas_replan_receipts)>=5000
  THEN RAISE(ABORT,'replan receipt limit') END;
 SELECT CASE WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.blocks_json) b
  WHERE json_type(b.value,'$.taskId') IS NOT 'integer' OR json_extract(b.value,'$.taskId')<=0
   OR json_type(b.value,'$.title') IS NOT 'text' OR length(json_extract(b.value,'$.title')) NOT BETWEEN 1 AND 200
   OR json_type(b.value,'$.starts_at') IS NOT 'integer' OR json_type(b.value,'$.ends_at') IS NOT 'integer'
   OR json_type(b.value,'$.durationMinutes') IS NOT 'integer' OR json_extract(b.value,'$.durationMinutes') NOT BETWEEN 1 AND 480
   OR json_extract(b.value,'$.starts_at')<=NEW.approved_at_ms
   OR json_extract(b.value,'$.starts_at')<NEW.window_start_ms
   OR json_extract(b.value,'$.ends_at')>NEW.window_end_ms
   OR json_extract(b.value,'$.ends_at')-json_extract(b.value,'$.starts_at')<>json_extract(b.value,'$.durationMinutes')*60000
   OR (json_type(b.value,'$.agendaId') IS NOT 'null' AND json_type(b.value,'$.agendaId') IS NOT 'integer')
 ) THEN RAISE(ABORT,'replan invalid block') END;
 SELECT CASE WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.blocks_json) b WHERE NOT EXISTS (
   SELECT 1 FROM atlas_tasks t WHERE t.id=json_extract(b.value,'$.taskId') AND t.done=0
    AND t.title=json_extract(b.value,'$.title') AND (t.due_date='' OR t.due_date<=NEW.target_date)
  )
 ) THEN RAISE(ABORT,'replan invalid task') END;
 SELECT CASE WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.blocks_json) b WHERE
   (json_extract(b.value,'$.agendaId') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM atlas_agenda a WHERE a.id=json_extract(b.value,'$.agendaId')
     AND a.task_id=json_extract(b.value,'$.taskId') AND a.archived_at IS NULL
   )) OR (json_extract(b.value,'$.agendaId') IS NULL AND EXISTS (
    SELECT 1 FROM atlas_agenda a WHERE a.task_id=json_extract(b.value,'$.taskId') AND a.archived_at IS NULL
   ))
 ) THEN RAISE(ABORT,'replan invalid agenda link') END;
 SELECT CASE WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.blocks_json) b JOIN json_each(NEW.blocks_json) c ON b.key<c.key
  WHERE json_extract(b.value,'$.taskId')=json_extract(c.value,'$.taskId')
   OR json_extract(b.value,'$.agendaId')=json_extract(c.value,'$.agendaId')
   OR (json_extract(b.value,'$.starts_at')<json_extract(c.value,'$.ends_at') AND json_extract(b.value,'$.ends_at')>json_extract(c.value,'$.starts_at'))
 ) THEN RAISE(ABORT,'replan overlapping blocks') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM atlas_agenda)+(SELECT COUNT(*) FROM json_each(NEW.blocks_json) WHERE json_extract(value,'$.agendaId') IS NULL)>200
  THEN RAISE(ABORT,'replan agenda limit') END;
 SELECT CASE WHEN EXISTS (
  SELECT 1 FROM atlas_agenda a JOIN json_each(NEW.blocks_json) b
   ON a.starts_at<json_extract(b.value,'$.ends_at') AND a.ends_at>json_extract(b.value,'$.starts_at')
  WHERE a.archived_at IS NULL AND NOT EXISTS (
   SELECT 1 FROM json_each(NEW.blocks_json) c WHERE a.id=json_extract(c.value,'$.agendaId')
  )
 ) THEN RAISE(ABORT,'replan fixed appointment conflict') END;
END;

CREATE TRIGGER atlas_replan_apply AFTER INSERT ON atlas_replan_receipts BEGIN
 UPDATE atlas_agenda SET
  title=(SELECT json_extract(value,'$.title') FROM json_each(NEW.blocks_json) WHERE json_extract(value,'$.agendaId')=atlas_agenda.id),
  starts_at=(SELECT json_extract(value,'$.starts_at') FROM json_each(NEW.blocks_json) WHERE json_extract(value,'$.agendaId')=atlas_agenda.id),
  ends_at=(SELECT json_extract(value,'$.ends_at') FROM json_each(NEW.blocks_json) WHERE json_extract(value,'$.agendaId')=atlas_agenda.id),
  revision=revision+1
 WHERE id IN (SELECT json_extract(value,'$.agendaId') FROM json_each(NEW.blocks_json));
 INSERT INTO atlas_agenda(draft_id,title,starts_at,ends_at,created_at,task_id)
 SELECT 'replan:'||NEW.id||':'||json_extract(value,'$.taskId'),json_extract(value,'$.title'),
  json_extract(value,'$.starts_at'),json_extract(value,'$.ends_at'),NEW.created_at,json_extract(value,'$.taskId')
 FROM json_each(NEW.blocks_json) WHERE json_extract(value,'$.agendaId') IS NULL;
END;
