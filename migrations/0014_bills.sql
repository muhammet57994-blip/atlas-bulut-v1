-- Manual declarations only. A journal INSERT and all its effects are one
-- SQLite statement, so an expense limit, stale state or failed ledger write
-- rolls back the whole operation.
CREATE TABLE atlas_bills (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 title_key TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor > 0 AND amount_minor <= 99999999999),
 currency TEXT NOT NULL CHECK(currency IN ('TRY','USD','EUR')),
 recurrence TEXT NOT NULL CHECK(recurrence IN ('monthly','yearly','once')),
 start_date TEXT NOT NULL,
 anchor_day INTEGER NOT NULL CHECK(anchor_day BETWEEN 1 AND 31),
 anchor_month INTEGER NOT NULL CHECK(anchor_month BETWEEN 1 AND 12),
 revision INTEGER NOT NULL CHECK(revision > 0),
 archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 last_operation_id TEXT NOT NULL
);
CREATE TABLE atlas_bill_operations (
 id TEXT PRIMARY KEY,
 bill_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('create','edit','archive','restore','pay')),
 expected_revision INTEGER NOT NULL CHECK(expected_revision >= 0),
 before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
 after_json TEXT NOT NULL CHECK(json_valid(after_json)),
 created_at TEXT NOT NULL
);
CREATE TABLE atlas_bill_payments (
 id TEXT PRIMARY KEY REFERENCES atlas_bill_operations(id),
 bill_id TEXT NOT NULL REFERENCES atlas_bills(id),
 due_date TEXT NOT NULL,
 title TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor > 0 AND amount_minor <= 99999999999),
 planned_amount_minor INTEGER NOT NULL CHECK(planned_amount_minor > 0 AND planned_amount_minor <= 99999999999),
 currency TEXT NOT NULL CHECK(currency IN ('TRY','USD','EUR')),
 paid_date TEXT NOT NULL,
 expense_id INTEGER NOT NULL UNIQUE REFERENCES atlas_expenses(id),
 created_at TEXT NOT NULL,
 UNIQUE(bill_id,due_date)
);
CREATE INDEX atlas_bill_payments_date ON atlas_bill_payments(paid_date,due_date);
CREATE TRIGGER atlas_bill_operations_guard BEFORE INSERT ON atlas_bill_operations
BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM atlas_bill_operations) >= 5000 THEN RAISE(ABORT,'bill operation limit') END;
 SELECT CASE WHEN NEW.action='create' AND ((SELECT COUNT(*) FROM atlas_bills) >= 100 OR EXISTS(SELECT 1 FROM atlas_bills WHERE id=NEW.bill_id)) THEN RAISE(ABORT,'bill record limit or duplicate') END;
 SELECT CASE WHEN NEW.action!='create' AND NOT EXISTS(
  SELECT 1 FROM atlas_bills WHERE id=NEW.bill_id AND revision=NEW.expected_revision
  AND title IS json_extract(NEW.before_json,'$.title')
  AND title_key IS json_extract(NEW.before_json,'$.title_key')
  AND amount_minor IS json_extract(NEW.before_json,'$.amount_minor')
  AND currency IS json_extract(NEW.before_json,'$.currency')
  AND recurrence IS json_extract(NEW.before_json,'$.recurrence')
  AND start_date IS json_extract(NEW.before_json,'$.start_date')
  AND anchor_day IS json_extract(NEW.before_json,'$.anchor_day')
  AND anchor_month IS json_extract(NEW.before_json,'$.anchor_month')
  AND archived IS json_extract(NEW.before_json,'$.archived')
 ) THEN RAISE(ABORT,'stale bill state') END;
 SELECT CASE WHEN NEW.action='pay' AND (
  json_extract(NEW.before_json,'$.archived')!=0
  OR (SELECT COUNT(*) FROM atlas_expenses)>=500
  OR (SELECT COUNT(*) FROM atlas_bill_payments)>=2000
  OR EXISTS(SELECT 1 FROM atlas_bill_payments WHERE bill_id=NEW.bill_id AND due_date=json_extract(NEW.after_json,'$.due_date'))
 ) THEN RAISE(ABORT,'payment capacity or duplicate') END;
END;
CREATE TRIGGER atlas_bill_operations_create AFTER INSERT ON atlas_bill_operations
WHEN NEW.action='create'
BEGIN
 INSERT INTO atlas_bills(id,title,title_key,amount_minor,currency,recurrence,start_date,anchor_day,anchor_month,revision,archived,created_at,updated_at,last_operation_id)
 VALUES(NEW.bill_id,json_extract(NEW.after_json,'$.title'),json_extract(NEW.after_json,'$.title_key'),json_extract(NEW.after_json,'$.amount_minor'),json_extract(NEW.after_json,'$.currency'),json_extract(NEW.after_json,'$.recurrence'),json_extract(NEW.after_json,'$.start_date'),json_extract(NEW.after_json,'$.anchor_day'),json_extract(NEW.after_json,'$.anchor_month'),1,0,NEW.created_at,NEW.created_at,NEW.id);
END;
CREATE TRIGGER atlas_bill_operations_edit AFTER INSERT ON atlas_bill_operations
WHEN NEW.action IN ('edit','archive','restore')
BEGIN
 UPDATE atlas_bills SET title=json_extract(NEW.after_json,'$.title'),title_key=json_extract(NEW.after_json,'$.title_key'),amount_minor=json_extract(NEW.after_json,'$.amount_minor'),currency=json_extract(NEW.after_json,'$.currency'),recurrence=json_extract(NEW.after_json,'$.recurrence'),start_date=json_extract(NEW.after_json,'$.start_date'),anchor_day=json_extract(NEW.after_json,'$.anchor_day'),anchor_month=json_extract(NEW.after_json,'$.anchor_month'),archived=json_extract(NEW.after_json,'$.archived'),revision=revision+1,updated_at=NEW.created_at,last_operation_id=NEW.id WHERE id=NEW.bill_id;
END;
CREATE TRIGGER atlas_bill_operations_pay AFTER INSERT ON atlas_bill_operations
WHEN NEW.action='pay'
BEGIN
 INSERT INTO atlas_expenses(draft_id,title,amount_minor,currency,category,spent_day,created_at)
 VALUES('bill-payment:'||NEW.id,json_extract(NEW.after_json,'$.title'),json_extract(NEW.after_json,'$.amount_minor'),json_extract(NEW.after_json,'$.currency'),'fatura',json_extract(NEW.after_json,'$.paid_date'),NEW.created_at);
 INSERT INTO atlas_bill_payments(id,bill_id,due_date,title,amount_minor,planned_amount_minor,currency,paid_date,expense_id,created_at)
 SELECT NEW.id,NEW.bill_id,json_extract(NEW.after_json,'$.due_date'),json_extract(NEW.after_json,'$.title'),json_extract(NEW.after_json,'$.amount_minor'),json_extract(NEW.after_json,'$.planned_amount_minor'),json_extract(NEW.after_json,'$.currency'),json_extract(NEW.after_json,'$.paid_date'),id,NEW.created_at FROM atlas_expenses WHERE draft_id='bill-payment:'||NEW.id;
 UPDATE atlas_bills SET revision=revision+1,updated_at=NEW.created_at,last_operation_id=NEW.id WHERE id=NEW.bill_id;
END;
CREATE TRIGGER atlas_bill_payments_no_update BEFORE UPDATE ON atlas_bill_payments
BEGIN SELECT RAISE(ABORT,'bill payment history is immutable'); END;
CREATE TRIGGER atlas_bill_payments_no_delete BEFORE DELETE ON atlas_bill_payments
BEGIN SELECT RAISE(ABORT,'bill payment history is immutable'); END;
CREATE TRIGGER atlas_bill_operations_no_update BEFORE UPDATE ON atlas_bill_operations
BEGIN SELECT RAISE(ABORT,'bill operation history is immutable'); END;
CREATE TRIGGER atlas_bill_operations_no_delete BEFORE DELETE ON atlas_bill_operations
BEGIN SELECT RAISE(ABORT,'bill operation history is immutable'); END;
