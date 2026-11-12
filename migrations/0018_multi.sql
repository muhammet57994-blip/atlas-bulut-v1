ALTER TABLE atlas_tasks ADD COLUMN multi_item_id TEXT;
CREATE UNIQUE INDEX atlas_tasks_multi_item ON atlas_tasks(multi_item_id) WHERE multi_item_id IS NOT NULL;
ALTER TABLE atlas_notes ADD COLUMN multi_item_id TEXT;
CREATE UNIQUE INDEX atlas_notes_multi_item ON atlas_notes(multi_item_id) WHERE multi_item_id IS NOT NULL;

CREATE TABLE atlas_multi_receipts (
 id TEXT PRIMARY KEY,
 selection_hash TEXT NOT NULL,
 items_json TEXT NOT NULL CHECK(json_valid(items_json) AND json_type(items_json)='array' AND json_array_length(items_json) BETWEEN 1 AND 5),
 expected_epoch INTEGER,
 created_at TEXT NOT NULL
);
CREATE TRIGGER atlas_multi_guard BEFORE INSERT ON atlas_multi_receipts
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM atlas_multi_receipts)>=2000 THEN RAISE(ABORT,'multi history full') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.items_json) WHERE json_extract(value,'$.kind') NOT IN ('note','task','agenda','expense')) THEN RAISE(ABORT,'invalid multi kind') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM atlas_notes)+(SELECT COUNT(*) FROM json_each(NEW.items_json) WHERE json_extract(value,'$.kind')='note')>100 THEN RAISE(ABORT,'notes full') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM atlas_tasks)+(SELECT COUNT(*) FROM json_each(NEW.items_json) WHERE json_extract(value,'$.kind')='task')>100 THEN RAISE(ABORT,'tasks full') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM atlas_agenda)+(SELECT COUNT(*) FROM json_each(NEW.items_json) WHERE json_extract(value,'$.kind')='agenda')>200 THEN RAISE(ABORT,'agenda full') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM atlas_expenses)+(SELECT COUNT(*) FROM json_each(NEW.items_json) WHERE json_extract(value,'$.kind')='expense')>500 THEN RAISE(ABORT,'expenses full') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.items_json) WHERE json_extract(value,'$.kind')='agenda') AND (NEW.expected_epoch IS NULL OR (SELECT epoch FROM atlas_replan_state WHERE id=1) IS NOT NEW.expected_epoch) THEN RAISE(ABORT,'agenda changed') END;
END;
CREATE TRIGGER atlas_multi_apply AFTER INSERT ON atlas_multi_receipts
BEGIN
 INSERT INTO atlas_notes(text,created_at,multi_item_id)
 SELECT json_extract(value,'$.content'),NEW.created_at,'multi-'||NEW.id||'-'||json_extract(value,'$.id') FROM json_each(NEW.items_json) WHERE json_extract(value,'$.kind')='note';
 INSERT INTO atlas_tasks(title,due_date,created_at,recurrence,multi_item_id)
 SELECT json_extract(value,'$.title'),json_extract(value,'$.due_date'),NEW.created_at,'','multi-'||NEW.id||'-'||json_extract(value,'$.id') FROM json_each(NEW.items_json) WHERE json_extract(value,'$.kind')='task';
 INSERT INTO atlas_agenda(draft_id,title,starts_at,ends_at,created_at)
 SELECT 'multi-'||NEW.id||'-'||json_extract(value,'$.id'),json_extract(value,'$.title'),json_extract(value,'$.starts_at'),json_extract(value,'$.ends_at'),NEW.created_at FROM json_each(NEW.items_json) WHERE json_extract(value,'$.kind')='agenda';
 INSERT INTO atlas_expenses(draft_id,title,amount_minor,currency,category,spent_day,created_at)
 SELECT 'multi-'||NEW.id||'-'||json_extract(value,'$.id'),json_extract(value,'$.title'),json_extract(value,'$.amount_minor'),json_extract(value,'$.currency'),json_extract(value,'$.category'),json_extract(value,'$.date'),NEW.created_at FROM json_each(NEW.items_json) WHERE json_extract(value,'$.kind')='expense';
END;
CREATE TRIGGER atlas_multi_no_update BEFORE UPDATE ON atlas_multi_receipts BEGIN SELECT RAISE(ABORT,'immutable multi receipt'); END;
CREATE TRIGGER atlas_multi_no_delete BEFORE DELETE ON atlas_multi_receipts BEGIN SELECT RAISE(ABORT,'immutable multi receipt'); END;
