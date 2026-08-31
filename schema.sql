-- =====================================================================
-- ระบบบันทึกรายรับ-รายจ่าย : Database Schema (PostgreSQL 15+)
-- ใช้เป็น spec ตายตัว ห้ามแก้โครงสร้าง
-- =====================================================================

-- ---------- [1] EXTENSIONS ----------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ---------- [2] ENUM TYPES ----------
CREATE TYPE transaction_type AS ENUM (
  'income', 'personal_expense', 'pending_claim',
  'investment', 'debt_payment', 'loan_given', 'transfer'
);

CREATE TYPE claim_status AS ENUM (
  'awaiting_bill', 'pending', 'claimed',
  'received', 'rejected', 'cancelled'
);

CREATE TYPE account_kind    AS ENUM ('cash','bank','ewallet','credit_card');
CREATE TYPE investment_dir  AS ENUM ('buy','sell','dividend','fee');
CREATE TYPE audit_action    AS ENUM ('create','update','delete','restore','status_change');
CREATE TYPE notif_severity  AS ENUM ('info','warning','critical');
CREATE TYPE recurrence_freq AS ENUM ('daily','weekly','biweekly','monthly','quarterly','yearly');
CREATE TYPE sync_state      AS ENUM ('synced','pending','conflict');

-- ---------- [3] USERS & CURRENCY ----------
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          CITEXT UNIQUE NOT NULL,
  display_name   TEXT NOT NULL,
  password_hash  TEXT,
  locale         TEXT NOT NULL DEFAULT 'th-TH',
  timezone       TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  base_currency  CHAR(3) NOT NULL DEFAULT 'THB',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);

CREATE TABLE currencies (
  code        CHAR(3) PRIMARY KEY,
  name        TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  minor_unit  SMALLINT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE exchange_rates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_code   CHAR(3) NOT NULL REFERENCES currencies(code),
  quote_code  CHAR(3) NOT NULL REFERENCES currencies(code),
  rate        NUMERIC(20,10) NOT NULL CHECK (rate > 0),
  rate_date   DATE NOT NULL,
  source      TEXT NOT NULL DEFAULT 'manual',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (base_code, quote_code, rate_date)
);

CREATE TABLE user_settings (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  claim_overdue_days   SMALLINT NOT NULL DEFAULT 14,
  card_usage_alert_pct SMALLINT NOT NULL DEFAULT 85,
  budget_alert_pcts    SMALLINT[] NOT NULL DEFAULT '{80,100}',
  daily_reminder_time  TIME,
  quiet_hours_start    TIME DEFAULT '22:00',
  quiet_hours_end      TIME DEFAULT '07:00',
  require_app_lock     BOOLEAN NOT NULL DEFAULT FALSE,
  auto_lock_seconds    INT NOT NULL DEFAULT 60,
  first_day_of_month   SMALLINT NOT NULL DEFAULT 1,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- [4] ACCOUNTS / CARDS / DEBTS ----------
CREATE TABLE accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  kind             account_kind NOT NULL,
  currency_code    CHAR(3) NOT NULL REFERENCES currencies(code),
  opening_balance  BIGINT NOT NULL DEFAULT 0,
  current_balance  BIGINT NOT NULL DEFAULT 0,
  icon             TEXT,
  color            TEXT,
  is_archived      BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order       INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ,
  UNIQUE (user_id, name, deleted_at)
);

CREATE TABLE credit_cards (
  account_id        UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  credit_limit      BIGINT NOT NULL CHECK (credit_limit >= 0),
  statement_day     SMALLINT CHECK (statement_day BETWEEN 1 AND 31),
  due_day           SMALLINT CHECK (due_day BETWEEN 1 AND 31),
  interest_rate_bps INT DEFAULT 0,
  last4             CHAR(4),
  network           TEXT
);

CREATE TABLE debts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  currency_code    CHAR(3) NOT NULL REFERENCES currencies(code),
  principal_amount BIGINT NOT NULL DEFAULT 0,
  current_balance  BIGINT NOT NULL DEFAULT 0,
  counterparty     TEXT,
  is_receivable    BOOLEAN NOT NULL DEFAULT FALSE,
  due_date         DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);

-- ---------- [5] CATEGORIES & TAGS ----------
CREATE TABLE categories (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id            UUID REFERENCES categories(id),
  name                 TEXT NOT NULL,
  name_i18n            JSONB DEFAULT '{}',
  applies_to           transaction_type[] NOT NULL,
  default_claim_status claim_status,
  is_claimable         BOOLEAN NOT NULL DEFAULT FALSE,
  icon                 TEXT,
  color                TEXT,
  sort_order           INT NOT NULL DEFAULT 0,
  is_system            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ,
  CHECK (is_claimable = FALSE OR default_claim_status IS NOT NULL)
);

CREATE TABLE tags (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  color   TEXT,
  UNIQUE (user_id, name)
);

-- ---------- [6] CLAIM BATCHES (ประกาศก่อน transactions เพื่อให้ FK ผูกได้) ----------
CREATE TABLE claim_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference_no  TEXT,
  title         TEXT NOT NULL,
  status        claim_status NOT NULL DEFAULT 'pending',
  total_amount  BIGINT NOT NULL DEFAULT 0,
  currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
  submitted_at  TIMESTAMPTZ,
  expected_date DATE,
  received_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

-- ---------- [7] RECURRING RULES (ประกาศก่อน transactions เช่นกัน) ----------
CREATE TABLE recurring_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template          JSONB NOT NULL,
  frequency         recurrence_freq NOT NULL,
  interval_count    SMALLINT NOT NULL DEFAULT 1,
  day_of_month      SMALLINT,
  day_of_week       SMALLINT,
  start_date        DATE NOT NULL,
  end_date          DATE,
  max_occurrences   INT,
  occurrences_count INT NOT NULL DEFAULT 0,
  next_run_date     DATE,
  last_run_at       TIMESTAMPTZ,
  auto_create       BOOLEAN NOT NULL DEFAULT TRUE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

-- ---------- [8] TRANSACTIONS (ตารางหลัก) ----------
CREATE TABLE transactions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type               transaction_type NOT NULL,

  amount             BIGINT NOT NULL CHECK (amount > 0),
  currency_code      CHAR(3) NOT NULL REFERENCES currencies(code),
  exchange_rate      NUMERIC(20,10) NOT NULL DEFAULT 1,
  base_amount        BIGINT NOT NULL,
  base_currency_code CHAR(3) NOT NULL,

  description        TEXT,
  note               TEXT,
  merchant           TEXT,
  transaction_date   DATE NOT NULL,
  occurred_at        TIMESTAMPTZ,

  category_id        UUID REFERENCES categories(id),
  account_id         UUID REFERENCES accounts(id),
  to_account_id      UUID REFERENCES accounts(id),
  debt_id            UUID REFERENCES debts(id),
  recurring_rule_id  UUID REFERENCES recurring_rules(id),
  claim_batch_id     UUID REFERENCES claim_batches(id),

  status             claim_status,
  buyer              TEXT,
  claim_received     BOOLEAN NOT NULL DEFAULT FALSE,
  claim_due_date     DATE,
  claimed_at         TIMESTAMPTZ,
  received_at        TIMESTAMPTZ,

  direction          investment_dir,

  ai_suggested_category_id UUID REFERENCES categories(id),
  ai_confidence      NUMERIC(4,3),
  ai_source          TEXT,
  user_overrode_ai   BOOLEAN NOT NULL DEFAULT FALSE,

  idempotency_key    TEXT,
  client_id          UUID,
  sync_status        sync_state NOT NULL DEFAULT 'synced',
  version            INT NOT NULL DEFAULT 1,
  search_vector      TSVECTOR,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES users(id),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ,
  deleted_by         UUID REFERENCES users(id),

  CONSTRAINT chk_claim_status CHECK (
    (type = 'pending_claim' AND status IS NOT NULL) OR (type <> 'pending_claim')
  ),
  CONSTRAINT chk_transfer CHECK (
    (type = 'transfer' AND to_account_id IS NOT NULL AND account_id <> to_account_id)
    OR (type <> 'transfer')
  ),
  CONSTRAINT chk_debt CHECK (
    (type = 'debt_payment' AND debt_id IS NOT NULL) OR (type <> 'debt_payment')
  ),
  CONSTRAINT chk_investment CHECK (
    (type = 'investment' AND direction IS NOT NULL) OR (type <> 'investment')
  )
);

CREATE TABLE transaction_splits (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id    UUID NOT NULL REFERENCES categories(id),
  amount         BIGINT NOT NULL CHECK (amount > 0),
  note           TEXT
);

CREATE TABLE transaction_tags (
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id         UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
);

CREATE TABLE claim_status_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  claim_batch_id UUID REFERENCES claim_batches(id) ON DELETE CASCADE,
  from_status    claim_status,
  to_status      claim_status NOT NULL,
  changed_by     UUID REFERENCES users(id),
  note           TEXT,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (transaction_id IS NOT NULL OR claim_batch_id IS NOT NULL)
);

-- ---------- [9] BUDGETS ----------
CREATE TABLE budgets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id   UUID REFERENCES categories(id),
  name          TEXT NOT NULL,
  amount        BIGINT NOT NULL CHECK (amount > 0),
  currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
  period_type   recurrence_freq NOT NULL DEFAULT 'monthly',
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  rollover      BOOLEAN NOT NULL DEFAULT FALSE,
  alert_pcts    SMALLINT[] NOT NULL DEFAULT '{80,100}',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  CHECK (period_end >= period_start)
);

-- ---------- [10] ATTACHMENTS ----------
CREATE TABLE attachments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transaction_id  UUID REFERENCES transactions(id) ON DELETE CASCADE,
  claim_batch_id  UUID REFERENCES claim_batches(id) ON DELETE CASCADE,
  file_key        TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL,
  checksum_sha256 TEXT,
  ocr_status      TEXT DEFAULT 'pending',
  ocr_text        TEXT,
  ocr_amount      BIGINT,
  ocr_date        DATE,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

-- ---------- [11] NOTIFICATIONS ----------
CREATE TABLE notification_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT UNIQUE NOT NULL,
  default_severity notif_severity NOT NULL DEFAULT 'info',
  title_i18n       JSONB NOT NULL,
  body_i18n        JSONB NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE notification_preferences (
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_code      TEXT NOT NULL REFERENCES notification_rules(code),
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  push_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  lead_days      SMALLINT[] DEFAULT '{7,3,1}',
  PRIMARY KEY (user_id, rule_code)
);

CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_code    TEXT REFERENCES notification_rules(code),
  severity     notif_severity NOT NULL DEFAULT 'info',
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  deep_link    TEXT,
  entity_type  TEXT,
  entity_id    UUID,
  payload      JSONB DEFAULT '{}',
  dedupe_key   TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at      TIMESTAMPTZ,
  read_at      TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- [12] SYSTEM: AUDIT / UNDO / IDEMPOTENCY / SYNC ----------
CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  action      audit_action NOT NULL,
  before_json JSONB,
  after_json  JSONB,
  diff_json   JSONB,
  actor_id    UUID REFERENCES users(id),
  ip_address  INET,
  user_agent  TEXT,
  request_id  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE undo_commands (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id    UUID NOT NULL,
  sequence_no   BIGINT NOT NULL,
  command_type  TEXT NOT NULL,
  forward_patch JSONB NOT NULL,
  inverse_patch JSONB NOT NULL,
  affected      JSONB NOT NULL,
  is_undone     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  UNIQUE (session_id, sequence_no)
);

CREATE TABLE idempotency_keys (
  key           TEXT PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  response_body JSONB,
  status_code   INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours')
);

CREATE TABLE sync_cursors (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id   TEXT NOT NULL,
  last_synced TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01',
  server_seq  BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, device_id)
);

-- ---------- [13] INDEXES ----------
CREATE INDEX idx_tx_user_date ON transactions (user_id, transaction_date DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_tx_user_type_date ON transactions (user_id, type, transaction_date DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_tx_pending_claims ON transactions (user_id, status, transaction_date)
  WHERE deleted_at IS NULL AND type = 'pending_claim'
    AND status IN ('awaiting_bill','pending','claimed');
CREATE INDEX idx_tx_account  ON transactions (account_id)  WHERE deleted_at IS NULL;
CREATE INDEX idx_tx_category ON transactions (category_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_tx_debt     ON transactions (debt_id)     WHERE deleted_at IS NULL;
CREATE INDEX idx_tx_merchant ON transactions USING GIN (merchant gin_trgm_ops);
CREATE INDEX idx_tx_search   ON transactions USING GIN (search_vector);
CREATE INDEX idx_tx_trash    ON transactions (user_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

CREATE UNIQUE INDEX uq_tx_idempotency ON transactions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX uq_tx_client_id ON transactions (user_id, client_id)
  WHERE client_id IS NOT NULL;

CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_user   ON audit_logs (user_id, created_at DESC);

CREATE UNIQUE INDEX uq_notif_dedupe ON notifications (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND dismissed_at IS NULL;
CREATE INDEX idx_notif_unread ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX idx_notif_due ON notifications (scheduled_at) WHERE sent_at IS NULL;

CREATE INDEX idx_undo_stack ON undo_commands (user_id, session_id, sequence_no DESC)
  WHERE is_undone = FALSE;

-- ---------- [14] TRIGGERS ----------
CREATE OR REPLACE FUNCTION fn_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := COALESCE(OLD.version, 0) + 1;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tx_touch BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

CREATE OR REPLACE FUNCTION fn_tx_search_vector() RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
      setweight(to_tsvector('simple', COALESCE(NEW.description,'')), 'A')
    || setweight(to_tsvector('simple', COALESCE(NEW.merchant,'')), 'B')
    || setweight(to_tsvector('simple', COALESCE(NEW.note,'')), 'C');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tx_search BEFORE INSERT OR UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION fn_tx_search_vector();

CREATE OR REPLACE FUNCTION fn_log_claim_status() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO claim_status_history (transaction_id, from_status, to_status, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, NEW.created_by);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_claim_history AFTER UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION fn_log_claim_status();

-- ---------- [15] VIEWS ----------
CREATE VIEW v_outstanding_claims AS
SELECT
  t.user_id,
  t.currency_code,
  COUNT(*)                                                AS claim_count,
  SUM(t.amount)                                           AS total_outstanding,
  SUM(t.amount) FILTER (WHERE t.status = 'awaiting_bill') AS awaiting_bill,
  SUM(t.amount) FILTER (WHERE t.status = 'pending')       AS pending,
  SUM(t.amount) FILTER (WHERE t.status = 'claimed')       AS claimed,
  MIN(t.transaction_date)                                 AS oldest_date,
  MAX(CURRENT_DATE - t.transaction_date)                  AS max_days_outstanding
FROM transactions t
WHERE t.deleted_at IS NULL
  AND t.type = 'pending_claim'
  AND t.status IN ('awaiting_bill','pending','claimed')
GROUP BY t.user_id, t.currency_code;

CREATE VIEW v_account_balances AS
SELECT
  a.id AS account_id,
  a.user_id,
  a.name,
  a.kind,
  a.currency_code,
  a.opening_balance
    + COALESCE(SUM(CASE
        WHEN t.type = 'income' THEN t.amount
        WHEN t.type = 'transfer' AND t.to_account_id = a.id THEN t.amount
        ELSE -t.amount END), 0) AS computed_balance,
  cc.credit_limit,
  cc.credit_limit - ABS(a.current_balance) AS available_credit
FROM accounts a
LEFT JOIN credit_cards cc ON cc.account_id = a.id
LEFT JOIN transactions t
       ON (t.account_id = a.id OR t.to_account_id = a.id)
      AND t.deleted_at IS NULL
WHERE a.deleted_at IS NULL
GROUP BY a.id, a.user_id, a.name, a.kind, a.currency_code,
         a.opening_balance, a.current_balance, cc.credit_limit;

-- ---------- [16] SEED CURRENCIES ----------
INSERT INTO currencies (code, name, symbol, minor_unit) VALUES
  ('THB','Thai Baht','฿',2),
  ('USD','US Dollar','$',2),
  ('EUR','Euro','€',2),
  ('GBP','British Pound','£',2),
  ('JPY','Japanese Yen','¥',0),
  ('SGD','Singapore Dollar','S$',2),
  ('KWD','Kuwaiti Dinar','د.ك',3)
ON CONFLICT (code) DO NOTHING;
