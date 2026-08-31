-- Additive-only migration layered on top of the fixed schema.sql spec.
-- Seeds a single dev user + THB cash account so the API has something to
-- operate against before real auth (Phase 1 scope) lands.
INSERT INTO users (id, email, display_name, base_currency)
VALUES ('00000000-0000-0000-0000-000000000001', 'dev@local.test', 'Dev User', 'THB')
ON CONFLICT (email) DO NOTHING;

INSERT INTO user_settings (user_id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO accounts (id, user_id, name, kind, currency_code)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'เงินสด/โอน', 'cash', 'THB')
ON CONFLICT DO NOTHING;
