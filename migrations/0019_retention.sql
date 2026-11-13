-- Retention windows. History stays immutable while it is recent; only the TTL
-- sweeper may remove rows older than the window, so deleting a fresh row still
-- aborts and the audit trail cannot be edited from the API.
DROP TRIGGER IF EXISTS atlas_record_changes_no_delete;
CREATE TRIGGER atlas_record_changes_no_delete BEFORE DELETE ON atlas_record_changes
WHEN julianday(OLD.created_at) >= julianday('now','-90 days')
BEGIN SELECT RAISE(ABORT,'record history is immutable'); END;

DROP TRIGGER IF EXISTS atlas_list_changes_no_delete;
CREATE TRIGGER atlas_list_changes_no_delete BEFORE DELETE ON atlas_list_changes
WHEN julianday(OLD.created_at) >= julianday('now','-90 days')
BEGIN SELECT RAISE(ABORT,'list history is immutable'); END;

DROP TRIGGER IF EXISTS atlas_offline_receipts_no_delete;
CREATE TRIGGER atlas_offline_receipts_no_delete BEFORE DELETE ON atlas_offline_receipts
WHEN julianday(OLD.created_at) >= julianday('now','-30 days')
BEGIN SELECT RAISE(ABORT,'immutable offline receipt'); END;

DROP TRIGGER IF EXISTS atlas_multi_no_delete;
CREATE TRIGGER atlas_multi_no_delete BEFORE DELETE ON atlas_multi_receipts
WHEN julianday(OLD.created_at) >= julianday('now','-30 days')
BEGIN SELECT RAISE(ABORT,'immutable multi receipt'); END;

DROP TRIGGER IF EXISTS atlas_budget_operations_no_delete;
CREATE TRIGGER atlas_budget_operations_no_delete BEFORE DELETE ON atlas_budget_operations
WHEN julianday(OLD.created_at) >= julianday('now','-30 days')
BEGIN SELECT RAISE(ABORT,'budget history is immutable'); END;

DROP TRIGGER IF EXISTS atlas_bill_operations_no_delete;
CREATE TRIGGER atlas_bill_operations_no_delete BEFORE DELETE ON atlas_bill_operations
WHEN julianday(OLD.created_at) >= julianday('now','-30 days')
BEGIN SELECT RAISE(ABORT,'bill operation history is immutable'); END;

DROP TRIGGER IF EXISTS atlas_waiting_operations_no_delete;
CREATE TRIGGER atlas_waiting_operations_no_delete BEFORE DELETE ON atlas_waiting_operations
WHEN julianday(OLD.created_at) >= julianday('now','-30 days')
BEGIN SELECT RAISE(ABORT,'waiting operation history is immutable'); END;
