-- Additive-only: seeds the fixed set of notification rules Phase 2 implements.
INSERT INTO notification_rules (code, default_severity, title_i18n, body_i18n) VALUES
  ('CLAIM_OVERDUE', 'warning',
    '{"th":"เงินรอเบิกค้างนาน","en":"Reimbursement overdue"}',
    '{"th":"รายการ \"{description}\" รอเบิกมา {days} วันแล้ว","en":"\"{description}\" has been pending reimbursement for {days} days"}'),
  ('CREDIT_CARD_DUE_SOON', 'warning',
    '{"th":"บิลบัตรเครดิตใกล้ครบกำหนด","en":"Credit card due soon"}',
    '{"th":"บัตร {cardName} ครบกำหนดชำระใน {days} วัน","en":"{cardName} is due in {days} days"}'),
  ('BUDGET_THRESHOLD', 'warning',
    '{"th":"ใช้จ่ายใกล้เกินงบ","en":"Approaching budget limit"}',
    '{"th":"งบ \"{budgetName}\" ใช้ไปแล้ว {pct}%","en":"Budget \"{budgetName}\" is at {pct}%"}'),
  ('CREDIT_CARD_NEAR_LIMIT', 'critical',
    '{"th":"ยอดบัตรเครดิตใกล้เต็มวงเงิน","en":"Credit card near its limit"}',
    '{"th":"บัตร {cardName} ใช้ไปแล้ว {pct}% ของวงเงิน","en":"{cardName} has used {pct}% of its limit"}'),
  ('LOAN_OVERDUE', 'warning',
    '{"th":"เงินให้ยืมเกินกำหนดคืน","en":"Loan overdue"}',
    '{"th":"\"{description}\" เกินกำหนดคืนแล้ว","en":"\"{description}\" is overdue for repayment"}'),
  ('DAILY_LOG_REMINDER', 'info',
    '{"th":"อย่าลืมบันทึกรายจ่ายวันนี้","en":"Don''t forget to log today''s spending"}',
    '{"th":"วันนี้ยังไม่มีการบันทึกรายการเลย","en":"No transactions logged yet today"}')
ON CONFLICT (code) DO NOTHING;
