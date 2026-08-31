-- Additive-only: a few illustrative manual rates so multi-currency transactions
-- are testable out of the box. A real deployment should replace/supplement
-- these with a scheduled job pulling from a live rate provider (needs API
-- credentials this environment doesn't have) writing into this same table.
INSERT INTO exchange_rates (base_code, quote_code, rate, rate_date, source) VALUES
  ('USD', 'THB', 35.50, CURRENT_DATE, 'manual'),
  ('EUR', 'THB', 38.20, CURRENT_DATE, 'manual'),
  ('JPY', 'THB', 0.24, CURRENT_DATE, 'manual'),
  ('KWD', 'THB', 115.30, CURRENT_DATE, 'manual')
ON CONFLICT (base_code, quote_code, rate_date) DO NOTHING;
