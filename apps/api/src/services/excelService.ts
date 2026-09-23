import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { add, convertAmount, fromMajorInput, toMajorString, zero, type ClaimStatus, type TransactionType } from '@finance/shared';
import type { DbClient } from '../db/pool.js';
import { recordCommand, type CommandSnapshot } from '../domain/commandStore.js';
import { computeLedgerEffects } from '../domain/ledger.js';
import { resolveExchangeRate } from '../domain/exchangeRate.js';
import { Errors } from '../domain/errors.js';
import { listAccounts } from './accountService.js';
import { getClaimsSummary } from './claimsSummaryService.js';

interface Ctx {
  userId: string;
  sessionId: string;
}

const COLUMNS = ['วันที่', 'เวลา', 'ประเภท', 'รายละเอียด', 'จำนวนเงิน', 'สกุลเงิน', 'บัญชี', 'หมวดหมู่', 'สถานะ', 'หมายเหตุ'] as const;

const TYPE_TO_THAI: Record<TransactionType, string> = {
  income: 'รายรับ',
  personal_expense: 'รายจ่าย',
  pending_claim: 'รอเบิก',
  investment: 'ลงทุน',
  debt_payment: 'ชำระหนี้',
  loan_given: 'ให้ยืม',
  transfer: 'โอนเงิน',
};
const THAI_TO_TYPE: Record<string, TransactionType> = Object.fromEntries(
  Object.entries(TYPE_TO_THAI).map(([type, thai]) => [thai, type as TransactionType])
);

// investment/debt_payment/transfer each need an extra field (direction/debtId/toAccountId)
// that a flat one-row-per-transaction spreadsheet has no natural column for — importing
// those would need guessing that data rather than reading it, so they're refused with a
// clear message instead of silently mis-filing them.
const UNSUPPORTED_IMPORT_TYPES = new Set<TransactionType>(['investment', 'debt_payment', 'transfer']);

const STATUS_TO_THAI: Record<ClaimStatus, string> = {
  awaiting_bill: 'รอบิล',
  pending: 'รอตั้งเบิก',
  claimed: 'ตั้งเบิกแล้ว',
  received: 'ได้รับคืนแล้ว',
  rejected: 'ถูกปฏิเสธ',
  cancelled: 'ยกเลิก',
};
const THAI_TO_STATUS: Record<string, ClaimStatus> = Object.fromEntries(
  Object.entries(STATUS_TO_THAI).map(([status, thai]) => [thai, status as ClaimStatus])
);

function excelSerialToDate(serial: number): Date {
  // Excel's day-0 epoch is 1899-12-30 (not 1900-01-01 — it deliberately reproduces Lotus
  // 1-2-3's leap-year bug for compatibility), and serials count whole days.
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
}

function parseDateCell(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return excelSerialToDate(value).toISOString().slice(0, 10);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function parseTimeCell(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim())) return value.trim();
  if (value instanceof Date) return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
  return null;
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF3' } };
const MONEY_FORMAT = '#,##0.00';

/** Sets a bold section heading spanning the row, with a light background so it reads as a divider. */
function writeSectionHeading(sheet: ExcelJS.Worksheet, text: string, span: number): void {
  const row = sheet.addRow([text]);
  row.font = { bold: true, size: 12 };
  sheet.mergeCells(row.number, 1, row.number, span);
  for (let col = 1; col <= span; col++) {
    row.getCell(col).fill = HEADER_FILL;
  }
}

function writeLabelValueRow(sheet: ExcelJS.Worksheet, label: string, value: number, opts: { bold?: boolean } = {}): void {
  const row = sheet.addRow([label, value]);
  row.getCell(1).font = { bold: opts.bold ?? false };
  row.getCell(2).font = { bold: opts.bold ?? false };
  row.getCell(2).numFmt = MONEY_FORMAT;
}

/** Rough auto-fit: widest of the header and any cell content in that column, plus padding. */
function autoFitColumns(sheet: ExcelJS.Worksheet): void {
  sheet.columns.forEach((column) => {
    let maxLen = 10;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const text = cell.value === null || cell.value === undefined ? '' : String(cell.value);
      maxLen = Math.max(maxLen, text.length);
    });
    column.width = maxLen + 2;
  });
}

export async function exportTransactionsWorkbook(client: DbClient, userId: string): Promise<Buffer> {
  const currencyRes = await client.query<{ code: string; minor_unit: number }>('SELECT code, minor_unit FROM currencies');
  const minorUnitByCode = new Map(currencyRes.rows.map((r) => [r.code, r.minor_unit]));

  const res = await client.query(
    `SELECT t.*, a.name AS account_name, c.name AS category_name
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id = $1 AND t.deleted_at IS NULL
     ORDER BY t.transaction_date DESC, t.created_at DESC`,
    [userId]
  );

  // Totals for the summary sheet, computed in each transaction's own base currency
  // (base_amount/base_currency_code) rather than its transaction currency — a mix of
  // THB and USD expenses can't otherwise be added into one meaningful figure. Like the
  // net-worth total below, this assumes a single base currency in practice (the normal
  // case for this app), rather than doing full multi-currency conversion here.
  let totalIncomeBase = 0n;
  let totalExpenseBase = 0n;
  for (const row of res.rows) {
    const baseAmount = BigInt(row.base_amount);
    if (row.type === 'income') totalIncomeBase += baseAmount;
    else if (row.type === 'personal_expense') totalExpenseBase += baseAmount;
  }
  const baseCurrencyCode: string = res.rows[0]?.base_currency_code ?? 'THB';
  const baseMinorUnit = minorUnitByCode.get(baseCurrencyCode) ?? 2;
  const toBaseMajor = (minor: bigint) => Number(toMajorString(minor.toString(), baseMinorUnit));

  const accounts = await listAccounts(client, userId);
  const activeAccounts = accounts.filter((a) => !a.isArchived);
  const cashAccounts = activeAccounts.filter((a) => a.kind !== 'credit_card');
  const creditCards = activeAccounts.filter((a) => a.kind === 'credit_card');
  // Net worth = cash/bank/e-wallet balances (positive) plus credit-card balances, which
  // are already negative in the ledger's sign convention (see domain/ledger.ts) — so a
  // plain sum naturally nets out what's owed against what's on hand.
  const netWorthMinor = activeAccounts.reduce((sum, a) => sum + BigInt(a.currentBalance), 0n);

  const claimsSummary = await getClaimsSummary(client, userId);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Personal Finance Tracker';
  workbook.created = new Date();

  // ---------- Sheet 1: สรุปรายงาน ----------
  const summarySheet = workbook.addWorksheet('สรุปรายงาน');
  summarySheet.getColumn(1).width = 34;
  summarySheet.getColumn(2).width = 20;

  writeSectionHeading(summarySheet, 'ภาพรวม', 2);
  writeLabelValueRow(summarySheet, `ยอดเงินคงเหลือสุทธิ (${baseCurrencyCode})`, toBaseMajor(netWorthMinor), { bold: true });
  writeLabelValueRow(summarySheet, 'รายรับรวม', toBaseMajor(totalIncomeBase));
  writeLabelValueRow(summarySheet, 'รายจ่ายรวม', toBaseMajor(totalExpenseBase));
  writeLabelValueRow(summarySheet, 'ยอดรอเบิก', toBaseMajor(BigInt(claimsSummary.totalOutstanding)));
  summarySheet.addRow([]);

  writeSectionHeading(summarySheet, 'ยอดคงเหลือแต่ละบัญชีและบัตร', 2);
  if (cashAccounts.length > 0) {
    const groupRow = summarySheet.addRow(['เงินฝาก/เงินสด']);
    groupRow.font = { italic: true, color: { argb: 'FF667080' } };
    for (const a of cashAccounts) {
      const minorUnit = minorUnitByCode.get(a.currencyCode) ?? 2;
      writeLabelValueRow(summarySheet, `  ${a.name} (${a.currencyCode})`, Number(toMajorString(a.currentBalance, minorUnit)));
    }
  }
  if (creditCards.length > 0) {
    const groupRow = summarySheet.addRow(['บัตรเครดิต (หนี้สิน)']);
    groupRow.font = { italic: true, color: { argb: 'FF667080' } };
    for (const a of creditCards) {
      const minorUnit = minorUnitByCode.get(a.currencyCode) ?? 2;
      const owedMinor = a.currentBalance.startsWith('-') ? a.currentBalance.slice(1) : a.currentBalance;
      writeLabelValueRow(summarySheet, `  ${a.name} (${a.currencyCode}) — ยอดหนี้คงค้าง`, Number(toMajorString(owedMinor, minorUnit)));
    }
  }

  // ---------- Sheet 2: รายการบัญชี ----------
  const txSheet = workbook.addWorksheet('รายการบัญชี');
  txSheet.columns = COLUMNS.map((header) => ({ header, key: header }));
  txSheet.getRow(1).font = { bold: true };
  txSheet.getRow(1).fill = HEADER_FILL;
  txSheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of res.rows) {
    const occurredAt = row.occurred_at ? new Date(row.occurred_at) : null;
    const minorUnit = minorUnitByCode.get(row.currency_code) ?? 2;
    txSheet.addRow({
      วันที่: String(row.transaction_date).slice(0, 10),
      เวลา: occurredAt ? `${String(occurredAt.getHours()).padStart(2, '0')}:${String(occurredAt.getMinutes()).padStart(2, '0')}` : '',
      ประเภท: TYPE_TO_THAI[row.type as TransactionType] ?? row.type,
      รายละเอียด: row.description ?? '',
      จำนวนเงิน: Number(toMajorString(String(row.amount), minorUnit)),
      สกุลเงิน: row.currency_code,
      บัญชี: row.account_name ?? '',
      หมวดหมู่: row.category_name ?? '',
      สถานะ: row.status ? (STATUS_TO_THAI[row.status as ClaimStatus] ?? row.status) : '',
      หมายเหตุ: row.note ?? '',
    });
  }
  txSheet.getColumn('จำนวนเงิน').numFmt = MONEY_FORMAT;
  autoFitColumns(txSheet);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export interface ImportResult {
  created: number;
  errors: Array<{ row: number; message: string }>;
}

/** A row that passed validation and is ready to insert, once its amount is converted to minor units. */
interface PendingRow {
  rowNum: number;
  type: TransactionType;
  amountMajor: string;
  currencyCode: string;
  description: string | null;
  note: string | null;
  transactionDate: string;
  occurredAt: string | null;
  accountId: string | null;
  categoryId: string | null;
  status: ClaimStatus | null;
  clientId: string;
}

/** Pushes `value` onto `values` and returns its `$N` placeholder — one shared
 * helper for every bulk statement below, so a query's param list and its
 * placeholder numbers can never drift apart from hand-counted offsets (this
 * function replaced an earlier version of this file that got that arithmetic
 * wrong, and two same-named-but-differently-scoped inline closures doing the
 * same job that collided with each other under hoisting — one shared,
 * explicitly-scoped helper avoids both mistakes at once). */
function pushParam(values: unknown[], value: unknown): string {
  values.push(value);
  return `$${values.length}`;
}

function softDeletedVariant(row: Record<string, unknown>, deletedBy: string): Record<string, unknown> {
  return { ...row, deleted_at: new Date().toISOString(), deleted_by: deletedBy };
}
function notDeletedVariant(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, deleted_at: null, deleted_by: null };
}

/** Mirrors auditLog.ts's `diff()` for the one shape a bulk import ever produces: a create, i.e. every field going from null to its value. */
function createDiff(after: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    result[key] = { from: null, to: value };
  }
  return result;
}

/**
 * Parses and validates every row against static/pre-fetched lookups (currency,
 * account, category) — no per-row DB round trip. Kept separate from the
 * insert phase below so a spreadsheet with 1000 rows still only costs a
 * handful of queries total, not one (or several) per row.
 */
function parseRows(
  rawRows: Record<string, unknown>[],
  baseCurrency: string,
  accountIdByName: Map<string, string>,
  categories: Array<{ id: string; name: string; applies_to: string[] }>
): { pending: PendingRow[]; errors: Array<{ row: number; message: string }> } {
  const pending: PendingRow[] = [];
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 0; i < rawRows.length; i++) {
    const rowNum = i + 2; // +1 for 0-index, +1 for the header row
    const row = rawRows[i]!;
    const dateRaw = row['วันที่'];
    const amountRaw = row['จำนวนเงิน'];
    if ((dateRaw === '' || dateRaw === undefined) && (amountRaw === '' || amountRaw === undefined)) continue; // blank row

    try {
      const typeThai = String(row['ประเภท'] ?? '').trim();
      const type = typeThai ? THAI_TO_TYPE[typeThai] : 'personal_expense';
      if (!type) throw new Error(`ไม่รู้จักประเภท "${typeThai}"`);
      if (UNSUPPORTED_IMPORT_TYPES.has(type)) {
        throw new Error(`ยังไม่รองรับการนำเข้าประเภท "${typeThai}" (ต้องเพิ่มเองในแอป)`);
      }

      const transactionDate = parseDateCell(dateRaw);
      if (!transactionDate) throw new Error(`วันที่ไม่ถูกต้อง: "${String(dateRaw)}"`);

      const amountNum = typeof amountRaw === 'number' ? amountRaw : Number(String(amountRaw).replace(/,/g, ''));
      if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error(`จำนวนเงินไม่ถูกต้อง: "${String(amountRaw)}"`);

      const time = parseTimeCell(row['เวลา']);
      const occurredAt = time ? new Date(`${transactionDate}T${time}`).toISOString() : null;

      const currencyCode = String(row['สกุลเงิน'] ?? '').trim().toUpperCase() || baseCurrency;

      const accountName = String(row['บัญชี'] ?? '').trim();
      const accountId = accountName ? accountIdByName.get(accountName.toLowerCase()) ?? null : null;

      const categoryName = String(row['หมวดหมู่'] ?? '').trim();
      const category = categoryName
        ? categories.find((c) => c.name.trim().toLowerCase() === categoryName.toLowerCase() && c.applies_to.includes(type))
        : undefined;

      let status: ClaimStatus | null = null;
      if (type === 'pending_claim') {
        const statusThai = String(row['สถานะ'] ?? '').trim();
        status = (statusThai && THAI_TO_STATUS[statusThai]) || 'awaiting_bill';
      }

      const note = String(row['หมายเหตุ'] ?? '').trim();

      pending.push({
        rowNum,
        type,
        amountMajor: String(amountNum),
        currencyCode,
        description: String(row['รายละเอียด'] ?? '').trim() || null,
        note: note || null,
        transactionDate,
        occurredAt,
        accountId,
        categoryId: category?.id ?? null,
        status,
        clientId: randomUUID(),
      });
    } catch (err) {
      errors.push({ row: rowNum, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { pending, errors };
}

// Comfortably under Postgres's 65535-param limit at 21 params/row, and small
// enough that one chunk's INSERT statement text stays a reasonable size.
const INSERT_CHUNK_SIZE = 500;

/**
 * Bulk-loads a spreadsheet's worth of transactions in a handful of queries
 * total, instead of running the single-row `createTransaction` path (itself
 * several queries: currency + user + exchange-rate lookups, one INSERT, one
 * ledger UPDATE, one undo-command INSERT, one audit INSERT) once per row —
 * for a 1000-row import that's the difference between roughly a dozen
 * queries and several thousand.
 *
 * The trade-off that makes this safe: every row here is a single-account
 * type with no linked debt/transfer (see UNSUPPORTED_IMPORT_TYPES), so the
 * ledger math is just "sum this row's signed amount into its account's
 * running balance" — independent per row, and therefore summable per account
 * before writing anything, rather than needing each row applied in sequence.
 * The whole import also becomes ONE undo command instead of one per row,
 * which is both faster and better UX (Ctrl+Z undoes the whole import, not
 * one of a thousand rows at a time).
 */
export async function importTransactionsFromBuffer(client: DbClient, ctx: Ctx, buffer: Buffer): Promise<ImportResult> {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  // Prefer the transactions sheet by name — our own export is now a 2-sheet workbook
  // ("สรุปรายงาน" + "รายการบัญชี"), so blindly reading SheetNames[0] would parse the
  // summary sheet instead of transaction rows when re-importing an exported file.
  // "Transactions" is kept for older exports; any other single/multi-sheet file (a
  // user's own spreadsheet) falls back to its first sheet, same as before.
  const sheetName = workbook.SheetNames.find((n) => n === 'รายการบัญชี' || n === 'Transactions') ?? workbook.SheetNames[0];
  if (!sheetName) throw Errors.validation('ไฟล์ Excel ไม่มีชีทข้อมูล');
  const sheet = workbook.Sheets[sheetName]!;
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  // Sequential, not Promise.all: `client` here is one pooled connection (see
  // withTransaction), which only ever processes one query at a time anyway —
  // firing these concurrently on it doesn't parallelize anything, it just
  // queues them under the hood while node-postgres warns that doing so is
  // deprecated (each `client.query()` call sharing one connection must
  // resolve before the next starts).
  const userRes = await client.query<{ base_currency: string }>('SELECT base_currency FROM users WHERE id = $1', [ctx.userId]);
  const accountsRes = await client.query<{ id: string; name: string }>(
    'SELECT id, name FROM accounts WHERE user_id = $1 AND deleted_at IS NULL',
    [ctx.userId]
  );
  const categoriesRes = await client.query<{ id: string; name: string; applies_to: string[] }>(
    'SELECT id, name, applies_to FROM categories WHERE user_id = $1 AND deleted_at IS NULL',
    [ctx.userId]
  );
  const baseCurrency = userRes.rows[0]?.base_currency ?? 'THB';
  const accountIdByName = new Map(accountsRes.rows.map((a) => [a.name.trim().toLowerCase(), a.id]));

  const { pending, errors } = parseRows(rawRows, baseCurrency, accountIdByName, categoriesRes.rows);
  if (pending.length === 0) return { created: 0, errors };

  // --- resolve currencies + FX rates once per distinct value, not once per row ---
  const currencyCodes = new Set(pending.map((r) => r.currencyCode));
  currencyCodes.add(baseCurrency);
  const minorUnitRes = await client.query<{ code: string; minor_unit: number }>(
    'SELECT code, minor_unit FROM currencies WHERE code = ANY($1::text[])',
    [Array.from(currencyCodes)]
  );
  const minorUnitByCode = new Map(minorUnitRes.rows.map((r) => [r.code, r.minor_unit]));
  for (const code of currencyCodes) {
    if (!minorUnitByCode.has(code)) throw Errors.validation(`Unknown currency code: ${code}`);
  }
  const baseMinorUnit = minorUnitByCode.get(baseCurrency)!;

  const rateCache = new Map<string, string>(); // `${from}|${date}` -> rate
  for (const row of pending) {
    const rateKey = `${row.currencyCode}|${row.transactionDate}`;
    if (rateCache.has(rateKey)) continue;
    const { rate } = await resolveExchangeRate(client, { fromCode: row.currencyCode, toCode: baseCurrency, date: row.transactionDate });
    rateCache.set(rateKey, rate);
  }

  // --- build every row's insert values now that amounts/rates are known ---
  interface InsertRow extends PendingRow {
    amountMinor: string;
    exchangeRate: string;
    baseAmountMinor: string;
  }
  const insertRows: InsertRow[] = pending.map((row) => {
    const minorUnit = minorUnitByCode.get(row.currencyCode)!;
    const amountMinor = fromMajorInput(row.amountMajor, minorUnit);
    const exchangeRate = rateCache.get(`${row.currencyCode}|${row.transactionDate}`)!;
    const baseAmountMinor = convertAmount(amountMinor, minorUnit, baseMinorUnit, exchangeRate);
    return { ...row, amountMinor, exchangeRate, baseAmountMinor };
  });

  // --- bulk INSERT, chunked to stay under the parameter limit, RETURNING the real rows ---
  // Every value (including the fixed nulls for columns import never sets) is pushed through
  // the same `values` array and its placeholder number taken from the array's own length at
  // that point — no hand-counted offsets to get wrong as columns are added or reordered.
  const insertedRows: Record<string, unknown>[] = [];
  for (let start = 0; start < insertRows.length; start += INSERT_CHUNK_SIZE) {
    const chunk = insertRows.slice(start, start + INSERT_CHUNK_SIZE);
    const values: unknown[] = [];
    const tuples = chunk.map((row) => {
      const rowValues = [
        ctx.userId,
        row.type,
        row.amountMinor,
        row.currencyCode,
        row.exchangeRate,
        row.baseAmountMinor,
        baseCurrency,
        row.description,
        null, // merchant — not represented in the import spreadsheet
        row.note,
        row.transactionDate,
        row.occurredAt,
        row.categoryId,
        row.accountId,
        null, // to_account_id — transfer type is unsupported for import
        row.status,
        null, // debt_id — debt_payment type is unsupported for import
        null, // buyer
        row.clientId,
        ctx.userId, // created_by
      ];
      const placeholders = rowValues.map((v) => pushParam(values, v));
      return `(${placeholders.join(',')})`;
    });

    const res = await client.query(
      `INSERT INTO transactions (
         user_id, type, amount, currency_code, exchange_rate, base_amount, base_currency_code,
         description, merchant, note, transaction_date, occurred_at, category_id, account_id, to_account_id,
         status, debt_id, buyer, client_id, created_by
       ) VALUES ${tuples.join(',')}
       ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO NOTHING
       RETURNING *`,
      values
    );
    insertedRows.push(...res.rows);
  }

  const insertedByClientId = new Map(insertedRows.map((r) => [r.client_id as string, r]));
  for (const row of insertRows) {
    if (!insertedByClientId.has(row.clientId)) {
      errors.push({ row: row.rowNum, message: 'บันทึกไม่สำเร็จ (อาจซ้ำกับรายการที่มีอยู่แล้ว)' });
    }
  }
  if (insertedRows.length === 0) return { created: 0, errors };

  // --- aggregate ledger deltas per account/debt across ALL rows, then one UPDATE per table ---
  const deltaByKey = new Map<string, { table: 'accounts' | 'debts'; id: string; delta: string }>();
  for (const row of insertedRows) {
    const effects = computeLedgerEffects({
      type: row.type as TransactionType,
      amount: String(row.amount),
      accountId: row.account_id as string | null,
      toAccountId: null,
      debtId: null,
      direction: null,
    });
    for (const effect of effects) {
      const table = effect.kind === 'account' ? 'accounts' : 'debts';
      const key = `${table}:${effect.id}`;
      const existing = deltaByKey.get(key);
      deltaByKey.set(key, { table, id: effect.id, delta: add(existing?.delta ?? zero(), effect.delta) });
    }
  }

  const deltaSnapshots: CommandSnapshot[] = Array.from(deltaByKey.values()).map((d) => ({
    kind: 'delta',
    table: d.table,
    id: d.id,
    column: 'current_balance',
    delta: d.delta,
  }));

  for (const table of ['accounts', 'debts'] as const) {
    const entries = Array.from(deltaByKey.values()).filter((d) => d.table === table);
    if (entries.length === 0) continue;
    // One bulk UPDATE per table instead of one per affected row/account: a
    // VALUES list joined against the target table.
    const params: unknown[] = [];
    const tuples = entries.map((e) => `(${pushParam(params, e.id)}::uuid, ${pushParam(params, e.delta)}::bigint)`);
    await client.query(
      `UPDATE "${table}" t SET current_balance = t.current_balance + v.delta
       FROM (VALUES ${tuples.join(',')}) AS v(id, delta)
       WHERE t.id = v.id`,
      params
    );
  }

  // --- one undo command for the whole import, not one per row ---
  const txSnapshots: CommandSnapshot[] = insertedRows.map((row) => ({
    table: 'transactions',
    id: row.id as string,
    before: softDeletedVariant(row, ctx.userId),
    after: notDeletedVariant(row),
  }));
  await recordCommand(client, { ...ctx, commandType: 'IMPORT_TRANSACTIONS' }, [...txSnapshots, ...deltaSnapshots]);

  // --- one bulk audit insert, one row per created transaction for per-entity traceability ---
  const auditValues: unknown[] = [];
  const auditTuples = insertedRows.map((row) => {
    const userIdParam = pushParam(auditValues, ctx.userId);
    const entityIdParam = pushParam(auditValues, row.id);
    const afterParam = pushParam(auditValues, JSON.stringify(row));
    const diffParam = pushParam(auditValues, JSON.stringify(createDiff(row)));
    return `(${userIdParam},'transaction',${entityIdParam},'create',NULL,${afterParam}::jsonb,${diffParam}::jsonb,${userIdParam})`;
  });
  await client.query(
    `INSERT INTO audit_logs (user_id, entity_type, entity_id, action, before_json, after_json, diff_json, actor_id)
     VALUES ${auditTuples.join(',')}`,
    auditValues
  );

  return { created: insertedRows.length, errors };
}
