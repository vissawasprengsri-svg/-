-- Additive-only: records which account a reimbursement/repayment actually
-- landed in (distinct from the account that originally paid), so history
-- views can say "received into ..." instead of just "received on ...".
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS claim_received_account_id UUID REFERENCES accounts(id);
