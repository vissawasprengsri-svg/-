# บัญชีเงินผม — Personal Finance Tracker

Monorepo (npm workspaces): `apps/api` + `apps/web` + `packages/shared`.

## โครงสร้าง

```
apps/api/       Express + TypeScript + pg (raw SQL, no ORM). Owns the DB.
apps/web/       React + Vite. Talks to apps/api over /api.
packages/shared/  Types + integer-minor-units money math shared by both.
schema.sql      Fixed DB spec (do not edit) — the source of truth for tables.
apps/api/migrations/  Additive-only SQL layered on top of schema.sql.
docker-compose.yml    Local Postgres 15 for development.
```

## เริ่มต้นใช้งาน

```bash
docker compose up -d
npm install
npm run migrate -w apps/api
npm run dev:api      # http://localhost:4000
npm run dev:web      # http://localhost:5173 (proxies /api -> :4000)
```

Copy `apps/api/.env.example` to `apps/api/.env` if you need a non-default `DATABASE_URL`.

## Phase 1 — ความปลอดภัยของข้อมูล (this drop)

- **Soft delete + toast undo**: [transactionService.ts](apps/api/src/services/transactionService.ts) never hard-deletes; `deleted_at`/`deleted_by` are set instead, and every read filters `deleted_at IS NULL`. The web app's delete button shows a "ลบแล้ว — เลิกทำ" toast for 7s.
- **Undo/redo stack**: [commandStore.ts](apps/api/src/domain/commandStore.ts) implements a generic snapshot-based Command Pattern (up to 20 steps/session) backed by the given `undo_commands` table. Ctrl+Z / Cmd+Z and Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y are wired in [useUndoRedo.ts](apps/web/src/hooks/useUndoRedo.ts).
- **Trash page**: `GET /api/trash` + `POST /api/trash/:id/restore`; [purgeExpiredTrash](apps/api/src/services/transactionService.ts) hard-deletes anything older than 30 days — call it from a scheduled job, not a request handler.
- **Audit log**: every money-impacting mutation writes a before/after/diff row to `audit_logs` ([auditLog.ts](apps/api/src/domain/auditLog.ts)); `GET /api/audit/transactions/:id` lists an item's history.
- **Idempotency**: mutating endpoints require an `Idempotency-Key` header ([idempotencyRunner.ts](apps/api/src/middleware/idempotencyRunner.ts)); a retried request with the same key + body replays the cached response instead of re-running the mutation. `transactions.client_id` gives a second, schema-level dedupe layer specifically for double-tapped "save" clicks.
- **Money**: every amount is an integer string of minor units end to end ([money.ts](packages/shared/src/money.ts)) — no `parseFloat`/`Number()` ever touches an amount.

### รู้ขอบเขตที่ยังไม่ทำ (ตั้งใจเก็บไว้ phase ถัดไป)

- Auth is a stub (`x-user-id` header, defaults to one seeded dev user) — real auth is out of scope for Phase 1.
- Only `income` / `personal_expense` / `pending_claim` have a form in the web UI yet; the service layer already supports `investment` / `debt_payment` / `loan_given` / `transfer`.

## Phase 2 — ระบบแจ้งเตือน (this drop)

- **Rule engine**: [ruleEngine.ts](apps/api/src/domain/notifications/ruleEngine.ts) implements all six required triggers — claim overdue, credit card due soon (lead days configurable), budget threshold (per-budget `alert_pcts`), credit card near limit, loan overdue, and the daily log reminder. [runChecks.ts](apps/api/src/domain/notifications/runChecks.ts) runs them all for a user and relies on the schema's own partial unique index (`user_id, dedupe_key WHERE dismissed_at IS NULL`) to make re-running always safe — no separate "already notified" bookkeeping needed.
- **Notification structure**: `notifications` / `notification_rules` / `notification_preferences` (all already in `schema.sql`) are used as given; [0002_notification_rules.sql](apps/api/migrations/0002_notification_rules.sql) seeds the six rule definitions.
- **Channels**: In-app center is fully live (`GET /api/notifications`, unread badge, mark-read, dismiss — see the 🔔 in the web header). Push and the weekly email digest are built as real integration points ([channels.ts](apps/api/src/domain/notifications/channels.ts)) that log intent and mark `sent_at`/return delivery status — wiring an actual FCM/APNs or SMTP/SES provider needs credentials this environment doesn't have, so that's a drop-in swap, not a redesign, whenever those exist.
- **Quiet hours**: [quietHours.ts](apps/api/src/domain/notifications/quietHours.ts) suppresses *push* only (handles the overnight-wrap case, e.g. 22:00→07:00); in-app notifications still land immediately since seeing a badge next time you open the app isn't an interruption.
- **Digest**: [digest.ts](apps/api/src/domain/notifications/digest.ts) groups a user's last 7 days of notifications by rule so the weekly email is one summary, not N separate emails — the anti-spam requirement from the prompt.
- **Settings**: `GET/PUT /api/settings` (claim overdue days, card usage %, daily reminder time, quiet hours) and `GET/PUT /api/settings/notification-preferences/:ruleCode` (per-rule in-app/push/email toggle + lead days), with a settings page in the web app.
- **Scheduling**: [apps/api/src/jobs/daily.ts](apps/api/src/jobs/daily.ts) is the entry point a real scheduler (OS cron / pg_cron / a task queue) calls once a day — it purges expired trash, runs the rule engine for every user, and fires the weekly digest on Mondays. `POST /api/notifications/run-checks` triggers it on demand for the current user (used by the "ตรวจสอบตอนนี้" button in Settings while there's no scheduler wired up yet).

### รู้ขอบเขตที่ยังไม่ทำ (Phase 2)

- No real push provider (FCM/APNs) or email provider (SMTP/SES) is wired — see `channels.ts` above.
- No scheduler process is actually running `jobs/daily.ts` on a timer; that's an infra/deploy decision (this environment has neither Docker nor a task scheduler available to verify one against).
- `purgeExpiredTrash()` now runs from `jobs/daily.ts` (previously unwired in Phase 1).

## Phase 3 — ทำให้เป็นสากล (this drop)

- **Multi-currency, exact FX math**: [`convertAmount`](packages/shared/src/money.ts) converts between any two currencies' minor units — 2↔2, 2↔0 (JPY), 3↔2 (KWD) decimal places — using pure bigint long division (round-half-up on the final minor unit only), never a float. [`resolveExchangeRate`](apps/api/src/domain/exchangeRate.ts) looks up `exchange_rates` (direct, or inverted via [`invertDecimal`](packages/shared/src/money.ts) if only the reverse pair is recorded) for the transaction's own date and **locks** that rate onto the row at creation — a later correction to `exchange_rates` never retroactively changes an already-booked `base_amount` (see the integration test `locks the exchange rate at booking time`). `POST /api/exchange-rates` is the manual entry point; [0003_sample_exchange_rates.sql](apps/api/migrations/0003_sample_exchange_rates.sql) seeds a few illustrative rates so it's testable out of the box. A live rate-provider feed would need external API credentials this environment doesn't have, so manual entry (`source='manual'`) is what's wired today — a scheduled job could write into the same table with a different `source` value without touching anything else.
- **i18n, backend**: `notification_rules.title_i18n`/`body_i18n` (already in `schema.sql`) are now actually used — [`runChecks.ts`](apps/api/src/domain/notifications/runChecks.ts) picks the template for the user's own `users.locale`, falling back to English, and [`renderTemplate`](apps/api/src/domain/notifications/template.ts) fills in `{placeholders}` (amounts, day counts, names) — notification text was hardcoded Thai in the Phase 2 drop; it's now genuinely per-user-locale.
- **i18n, frontend**: [apps/web/src/i18n](apps/web/src/i18n) — `translations.ts` (th-TH + en-US dictionaries), `I18nContext.tsx` (a `t()` hook, `Intl.DateTimeFormat` for dates using the user's own `users.timezone`, and a locale switcher in the header that persists to `users.locale` via `GET/PUT /api/settings/locale`, syncing the backend's notification language with the UI language). Amounts render through [`useCurrencies`](apps/web/src/hooks/useCurrencies.ts), which fetches `GET /api/currencies` for the right symbol/decimal places and hands the exact minor-unit-derived decimal string to `Intl.NumberFormat` purely for locale-correct grouping/symbol placement — the stored value itself never passes through a float.
- **RTL-ready structure**: [`SUPPORTED_LOCALES`](packages/shared/src/types.ts) carries a `dir` per locale; the provider sets `<html dir>`/`lang` reactively, and the handful of physically-`left`/`right` CSS rules that mattered were converted to logical properties (`inset-inline-end`, `text-align: start`, `margin-inline-start`). Neither th nor en is RTL, so this is scaffolding for whenever one is added, not something pixel-tested here.
- **Timestamps**: already UTC end-to-end (Postgres `TIMESTAMPTZ`); Phase 3 adds the *display* half — converting to each user's `timezone` at render time via `Intl`.

### รู้ขอบเขตที่ยังไม่ทำ (Phase 3)

- The web transaction form is still hardcoded to the dev account's base currency (THB); the API fully supports any currency with a resolvable rate, but there's no currency picker in the UI yet.
- No live FX rate provider is wired (see above) — rates are manual/seeded only.
- Only th-TH and en-US are implemented; adding a third locale is "add a dictionary + a `SUPPORTED_LOCALES` entry," not a redesign.

## Phase 4 — งบประมาณ, รายการประจำ, ค้นหา, รายงาน (this drop)

Phase 4 in the prompt bundles ten very different features (budgets, recurring transactions, receipt OCR, exports, full-text search, offline-first sync, biometric lock, backup/restore, accessibility). This drop covers the four that build directly on the existing service-layer architecture; the rest are called out below with why they're a separate decision, not a shortcut.

- **Budgets + rollover**: [budgetService.ts](apps/api/src/services/budgetService.ts) — `spent` is computed live from `transactions` (never a stale cached counter), and the progress bar in [BudgetsPage.tsx](apps/web/src/pages/BudgetsPage.tsx) reuses the exact same 0–100 bigint math as the Phase 2 budget-threshold notification. `rolloverEndedBudgets()` closes out any budget whose `period_end` has passed, carries the unspent amount forward only when `rollover=true` (never negative), and keeps the old period's row as `is_active=false` history rather than deleting it.
- **Recurring transactions**: [recurringService.ts](apps/api/src/services/recurringService.ts) stamps out due occurrences from `recurring_rules.template` using the same `createTransaction()` as manual entry (so ledger effects, audit log, and the undo stack all apply identically to a recurring-generated transaction). Each occurrence gets a deterministic `idempotency_key` (`ruleId:occurrenceNumber`) set atomically in the same INSERT, so re-running the job after a crash can never double-book — see the integration test `stamps out a due recurring transaction exactly once even if run twice`.
- **Search & filter**: [searchService.ts](apps/api/src/services/searchService.ts) uses `schema.sql`'s own `search_vector`/GIN index (already trigger-maintained) for full-text search, combined with date range / category / type / status / amount filters — amount bounds compare against `base_amount` so a mixed-currency result set still filters sensibly. Wired into the dashboard's search bar with a 300ms debounce.
- **Reports**: [reportService.ts](apps/api/src/services/reportService.ts) — monthly income/expense/net-cash-flow + category breakdown, and a 6-month trend. Charted with plain SVG/CSS bars in [ReportsPage.tsx](apps/web/src/pages/ReportsPage.tsx) rather than pulling in a charting library, since the shapes are simple.
- **Bug fix found along the way**: date pickers defaulting to "today" via `new Date().toISOString().slice(0,10)` silently rolled back a day in timezones ahead of UTC (that call converts to UTC *before* slicing). Fixed in [apps/web/src/utils/date.ts](apps/web/src/utils/date.ts) (`toLocalDateStr`, never round-trips through UTC) and in [`I18nContext.formatDate`](apps/web/src/i18n/I18nContext.tsx), which was doing the same UTC-reprojection when displaying a pure calendar date like `transaction_date`.

### รู้ขอบเขตที่ยังไม่ทำ (Phase 4 — deferred with reasons, not skipped silently)

- **แนบไฟล์ใบเสร็จ + OCR**: needs file storage (S3-compatible bucket or similar) and a vision/OCR API — real credentials/infra decisions this environment can't make on your behalf.
- **Export/Import (CSV/Excel/PDF, bank statement import)**: straightforward to add (CSV needs no new dependency; Excel/PDF would each add one library) but is a UI-heavy feature in its own right, and bank statement import formats vary per bank — worth scoping with you rather than guessing a format.
- **Offline-first + conflict resolution**: this is a different client architecture (a local-first store, e.g. IndexedDB + a sync protocol) — `sync_cursors`/`sync_status`/`version` already exist in `schema.sql` for exactly this, but building it properly is its own project, not an incremental add to the current React/fetch app.
- **PIN/biometric lock, auto-lock, at-rest encryption**: biometric APIs are mobile/native or WebAuthn-specific — worth confirming whether this stays a web app or targets a native/PWA shell before building device-specific security UX.
- **Backup & restore**: needs a storage destination (where does the backup go?) — same category as OCR/export above.
- **Accessibility**: not addressed as a dedicated pass in this drop; the existing markup uses semantic `<label>`/`<button>` and the color palette wasn't contrast-audited. Worth a focused accessibility pass over the whole UI rather than a partial one here.

## ทดสอบ

```bash
npm run test -w packages/shared   # money math — pure, no DB
npm run test -w apps/api          # ledger/notification/recurring-date math (pure) + Postgres integration suites (transactions, notifications, Phase 4)
```

The integration suites (`apps/api/test/*.integration.test.ts`) need a real Postgres — they self-skip if `DATABASE_URL` isn't reachable, because `schema.sql`'s enums/triggers/GIN-trgm indexes aren't faithfully emulated by in-memory Postgres shims. Run `docker compose up -d && npm run migrate -w apps/api` first, then `npm run test -w apps/api`.

## Pre-deploy checklist

- [ ] `docker compose up -d && npm run migrate -w apps/api` runs clean against a fresh DB
- [ ] `npm run test -w packages/shared` and `npm run test -w apps/api` (with `DATABASE_URL` set) both green
- [ ] `npm run typecheck` passes for all three packages
- [ ] A scheduler calls `npm run jobs:daily -w apps/api` once a day (trash purge, due recurring transactions, budget rollover, notification checks, Monday digest)
- [ ] `idempotency_keys` / `undo_commands` cleanup job for rows past `expires_at` (schema defaults: 24h / 7d)
- [ ] Replace the `x-user-id` dev stub with real auth before any non-local deployment
- [ ] Swap `consoleLogPushChannel` / `consoleLogEmailChannel` for real FCM/APNs and SMTP/SES integrations before relying on push or email in production
- [ ] Wire a real FX rate feed (a scheduled job writing into `exchange_rates` with `source != 'manual'`) before relying on multi-currency for real trades
