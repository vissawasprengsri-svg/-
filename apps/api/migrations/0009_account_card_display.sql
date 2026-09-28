-- Additive-only: purely cosmetic fields for the gradient card visual on the
-- dashboard (last 4 digits + network badge) — no ledger meaning, safe to
-- leave NULL for accounts that don't need a card look (plain cash, etc).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last4 CHAR(4);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS network TEXT
  CHECK (network IS NULL OR network IN ('visa', 'mastercard', 'jcb', 'amex', 'unionpay', 'truemoney', 'other'));
