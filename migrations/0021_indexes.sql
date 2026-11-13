-- Hot reads order by due date, day or created_at; retention sweeps filter on
-- created_at. Without these, every query scans its table and spends the free
-- D1 rows_read allowance as the history grows.
CREATE INDEX IF NOT EXISTS idx_tasks_done_due ON atlas_tasks(done, due_date);
CREATE INDEX IF NOT EXISTS idx_agenda_starts ON atlas_agenda(starts_at);
CREATE INDEX IF NOT EXISTS idx_expenses_day ON atlas_expenses(spent_day);
CREATE INDEX IF NOT EXISTS idx_memories_created ON atlas_memories(created_at);
CREATE INDEX IF NOT EXISTS idx_notes_created ON atlas_notes(created_at);
CREATE INDEX IF NOT EXISTS idx_bill_payments_due ON atlas_bill_payments(due_date);
CREATE INDEX IF NOT EXISTS idx_focus_day ON atlas_focus_sessions(started_day);
CREATE INDEX IF NOT EXISTS idx_content_due ON atlas_content_calendar(due_date);
CREATE INDEX IF NOT EXISTS idx_waiting_followup ON atlas_waiting(followup_date);
CREATE INDEX IF NOT EXISTS idx_record_changes_created ON atlas_record_changes(created_at);
CREATE INDEX IF NOT EXISTS idx_list_changes_created ON atlas_list_changes(created_at);
CREATE INDEX IF NOT EXISTS idx_offline_receipts_created ON atlas_offline_receipts(created_at);
CREATE INDEX IF NOT EXISTS idx_multi_receipts_created ON atlas_multi_receipts(created_at);
CREATE INDEX IF NOT EXISTS idx_budget_operations_created ON atlas_budget_operations(created_at);
CREATE INDEX IF NOT EXISTS idx_bill_operations_created ON atlas_bill_operations(created_at);
CREATE INDEX IF NOT EXISTS idx_waiting_operations_created ON atlas_waiting_operations(created_at);
