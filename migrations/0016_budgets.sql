-- An exact month/category/currency has one manual budget. Archiving is not
-- deletion and never permits silently replacing a prior budget or its history.
CREATE TABLE atlas_budgets (
 id TEXT PRIMARY KEY,
 month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND month BETWEEN '2000-01' AND '2100-12' AND substr(month,6,2) BETWEEN '01' AND '12'),
 category TEXT NOT NULL CHECK(category IN ('market','ulaşım','yemek','fatura','diğer')),
 amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor > 0 AND amount_minor <= 99999999999),
 currency TEXT NOT NULL CHECK(currency IN ('TRY','USD','EUR')),
 archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
 revision INTEGER NOT NULL CHECK(revision > 0),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 last_operation_id TEXT NOT NULL,
 UNIQUE(month,category,currency)
);
CREATE TABLE atlas_budget_operations (
 id TEXT PRIMARY KEY,
 budget_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('create','edit','archive','restore')),
 expected_revision INTEGER NOT NULL CHECK(expected_revision >= 0),
 before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
 after_json TEXT NOT NULL CHECK(json_valid(after_json)),
 created_at TEXT NOT NULL
);
CREATE TRIGGER atlas_budget_operations_guard BEFORE INSERT ON atlas_budget_operations
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM atlas_budget_operations)>=5000 THEN RAISE(ABORT,'budget operation limit') END;
 SELECT CASE WHEN NEW.action='create' AND (NEW.expected_revision!=0 OR NEW.before_json IS NOT NULL OR json_extract(NEW.after_json,'$.archived') IS NOT 0 OR (SELECT COUNT(*) FROM atlas_budgets)>=100 OR EXISTS(SELECT 1 FROM atlas_budgets WHERE id=NEW.budget_id)) THEN RAISE(ABORT,'budget create invalid or capacity') END;
 SELECT CASE WHEN NEW.action!='create' AND NOT EXISTS(
  SELECT 1 FROM atlas_budgets WHERE id=NEW.budget_id AND revision=NEW.expected_revision
  AND month IS json_extract(NEW.before_json,'$.month')
  AND category IS json_extract(NEW.before_json,'$.category')
  AND amount_minor IS json_extract(NEW.before_json,'$.amount_minor')
  AND currency IS json_extract(NEW.before_json,'$.currency')
  AND archived IS json_extract(NEW.before_json,'$.archived')
 ) THEN RAISE(ABORT,'stale budget state') END;
 SELECT CASE WHEN NEW.action='edit' AND json_extract(NEW.after_json,'$.archived') IS NOT json_extract(NEW.before_json,'$.archived') THEN RAISE(ABORT,'edit cannot change archive state') END;
 SELECT CASE WHEN NEW.action IN ('archive','restore') AND (
  json_extract(NEW.before_json,'$.archived') IS NOT CASE NEW.action WHEN 'archive' THEN 0 ELSE 1 END
  OR json_extract(NEW.after_json,'$.archived') IS NOT CASE NEW.action WHEN 'archive' THEN 1 ELSE 0 END
  OR json_extract(NEW.after_json,'$.month') IS NOT json_extract(NEW.before_json,'$.month')
  OR json_extract(NEW.after_json,'$.category') IS NOT json_extract(NEW.before_json,'$.category')
  OR json_extract(NEW.after_json,'$.amount_minor') IS NOT json_extract(NEW.before_json,'$.amount_minor')
  OR json_extract(NEW.after_json,'$.currency') IS NOT json_extract(NEW.before_json,'$.currency')
 ) THEN RAISE(ABORT,'invalid budget archive transition') END;
END;
CREATE TRIGGER atlas_budget_operations_create AFTER INSERT ON atlas_budget_operations
WHEN NEW.action='create'
BEGIN
 INSERT INTO atlas_budgets(id,month,category,amount_minor,currency,archived,revision,created_at,updated_at,last_operation_id)
 VALUES(NEW.budget_id,json_extract(NEW.after_json,'$.month'),json_extract(NEW.after_json,'$.category'),json_extract(NEW.after_json,'$.amount_minor'),json_extract(NEW.after_json,'$.currency'),0,1,NEW.created_at,NEW.created_at,NEW.id);
END;
CREATE TRIGGER atlas_budget_operations_apply AFTER INSERT ON atlas_budget_operations
WHEN NEW.action IN ('edit','archive','restore')
BEGIN
 UPDATE atlas_budgets SET month=json_extract(NEW.after_json,'$.month'),category=json_extract(NEW.after_json,'$.category'),amount_minor=json_extract(NEW.after_json,'$.amount_minor'),currency=json_extract(NEW.after_json,'$.currency'),archived=json_extract(NEW.after_json,'$.archived'),revision=revision+1,updated_at=NEW.created_at,last_operation_id=NEW.id WHERE id=NEW.budget_id;
END;
CREATE TRIGGER atlas_budget_operations_no_update BEFORE UPDATE ON atlas_budget_operations
BEGIN SELECT RAISE(ABORT,'budget history is immutable'); END;
CREATE TRIGGER atlas_budget_operations_no_delete BEFORE DELETE ON atlas_budget_operations
BEGIN SELECT RAISE(ABORT,'budget history is immutable'); END;
CREATE TRIGGER atlas_budgets_no_delete BEFORE DELETE ON atlas_budgets
BEGIN SELECT RAISE(ABORT,'archive budgets instead of deleting'); END;
