-- Additive-only: seeds the RECURRING_DUE_SOON notification rule.
INSERT INTO notification_rules (code, default_severity, title_i18n, body_i18n) VALUES
  ('RECURRING_DUE_SOON', 'warning',
    '{"th":"บิลประจำใกล้ถึงกำหนด","en":"Upcoming recurring bill"}',
    '{"th":"รายการ \"{description}\" จะถึงกำหนดในอีก {days} วัน","en":"\"{description}\" is due in {days} days"}')
ON CONFLICT (code) DO NOTHING;
