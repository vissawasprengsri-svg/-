-- Additive-only: supplementary indexes for Phase 4 query patterns
-- (budgets/recurring_rules ship in schema.sql without these).
CREATE INDEX IF NOT EXISTS idx_budgets_user_active ON budgets (user_id, is_active)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_recurring_due ON recurring_rules (next_run_date)
  WHERE is_active = TRUE AND auto_create = TRUE AND deleted_at IS NULL;
