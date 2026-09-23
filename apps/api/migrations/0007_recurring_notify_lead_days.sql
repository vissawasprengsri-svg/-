-- Additive-only: per-rule lead time for the RECURRING_DUE_SOON reminder,
-- replacing the one-size-fits-all global preference for this rule.
ALTER TABLE recurring_rules ADD COLUMN IF NOT EXISTS notify_lead_days INT NOT NULL DEFAULT 3;
