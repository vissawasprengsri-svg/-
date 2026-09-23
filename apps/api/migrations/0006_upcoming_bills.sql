-- Additive-only: upcoming bills (known-in-advance due dates the user jots down
-- ahead of time) plus the notification rule that reminds before they're due.
CREATE TABLE IF NOT EXISTS upcoming_bills (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  amount         BIGINT NOT NULL CHECK (amount > 0),
  currency_code  VARCHAR(3) NOT NULL DEFAULT 'THB' REFERENCES currencies(code),
  due_date       DATE NOT NULL,
  note           TEXT,
  is_paid        BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at        TIMESTAMPTZ,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_upcoming_bills_due
  ON upcoming_bills (user_id, due_date)
  WHERE deleted_at IS NULL AND is_paid = FALSE;

INSERT INTO notification_rules (code, default_severity, title_i18n, body_i18n)
VALUES (
  'BILL_DUE_SOON', 'warning',
  '{"th":"มีบิลใกล้ถึงกำหนดชำระ","en":"Bill due soon"}',
  '{"th":"รายการ \"{title}\" ครบกำหนดจ่ายใน {days} วัน","en":"\"{title}\" is due in {days} days"}'
) ON CONFLICT (code) DO NOTHING;
