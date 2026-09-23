import { add, zero, type ClaimBatch, type Transaction } from '@finance/shared';
import type { DbClient } from '../db/pool.js';
import { mapTransactionRow } from '../db/mappers.js';
import { recordAudit } from '../domain/auditLog.js';
import { Errors } from '../domain/errors.js';

interface Ctx {
  userId: string;
  sessionId: string;
}

/**
 * Claim batches group several `pending_claim` transactions into one submission
 * to whoever reimburses them, so the paperwork can be tracked as a unit.
 *
 * No ledger effects happen here by design: a pending_claim already debited the
 * paying account when it was recorded, and the money only comes back when an
 * item reaches 'received' (handled in transactionService.updateClaimStatus).
 * Batching is bookkeeping about *submission*, not about cash movement.
 */

const WITH_CATEGORY = `
  SELECT t.*, c.name AS category_name, c.is_claimable AS category_is_claimable
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
`;

/** `BATCH-YYYYMM-001`, continuing from the highest suffix already used that month. */
async function nextReferenceNo(client: DbClient, userId: string, now: Date): Promise<string> {
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `BATCH-${yyyymm}-`;
  const res = await client.query<{ reference_no: string }>(
    `SELECT reference_no FROM claim_batches
     WHERE user_id = $1 AND reference_no LIKE $2
     ORDER BY reference_no DESC LIMIT 1`,
    [userId, `${prefix}%`]
  );
  // Taken from the highest existing number rather than a row count, so deleting
  // a batch never causes a later one to reuse its reference.
  const last = res.rows[0]?.reference_no;
  const lastSeq = last ? Number.parseInt(last.slice(prefix.length), 10) : 0;
  const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

function settlementOf(items: Transaction[]): ClaimBatch['settlement'] {
  if (items.length === 0) return 'submitted';
  const received = items.filter((t) => t.status === 'received').length;
  if (received === 0) return 'submitted';
  return received === items.length ? 'paid' : 'partially_paid';
}

function mapBatch(row: Record<string, unknown>, items: Transaction[]): ClaimBatch {
  const receivedItems = items.filter((t) => t.status === 'received');
  return {
    id: row.id as string,
    referenceNo: (row.reference_no as string | null) ?? null,
    title: row.title as string,
    status: row.status as ClaimBatch['status'],
    settlement: settlementOf(items),
    totalAmount: String(row.total_amount),
    receivedAmount: receivedItems.reduce((sum, t) => add(sum, t.amount), zero()),
    currencyCode: row.currency_code as string,
    itemCount: items.length,
    receivedCount: receivedItems.length,
    submittedAt: row.submitted_at ? new Date(row.submitted_at as string).toISOString() : null,
    receivedAt: row.received_at ? new Date(row.received_at as string).toISOString() : null,
    createdAt: new Date(row.created_at as string).toISOString(),
    items,
  };
}

export async function createClaimBatch(
  client: DbClient,
  ctx: Ctx,
  input: { transactionIds: string[]; title?: string }
): Promise<ClaimBatch> {
  if (input.transactionIds.length === 0) throw Errors.validation('เลือกอย่างน้อย 1 รายการเพื่อสร้างล็อต');

  // Locked up front: without FOR UPDATE two concurrent submissions could both
  // read these as unbatched and file the same bill into two different batches.
  const res = await client.query(
    `SELECT * FROM transactions
     WHERE id = ANY($1::uuid[]) AND user_id = $2 AND deleted_at IS NULL
     FOR UPDATE`,
    [input.transactionIds, ctx.userId]
  );
  const rows = res.rows;

  if (rows.length !== input.transactionIds.length) {
    throw Errors.validation('มีบางรายการที่ไม่พบหรือถูกลบไปแล้ว');
  }
  const wrongType = rows.find((r) => r.type !== 'pending_claim');
  if (wrongType) throw Errors.validation('รวมได้เฉพาะรายการประเภท "รอเบิก" เท่านั้น');

  const alreadyBatched = rows.find((r) => r.claim_batch_id !== null);
  if (alreadyBatched) throw Errors.validation('มีบางรายการอยู่ในล็อตอื่นอยู่แล้ว');

  const notPending = rows.find((r) => r.status !== 'pending');
  if (notPending) throw Errors.validation('รวมได้เฉพาะรายการที่สถานะ "รอตั้งเบิก" เท่านั้น');

  const currencyCode = rows[0]!.currency_code as string;
  if (rows.some((r) => r.currency_code !== currencyCode)) {
    throw Errors.validation('รายการในล็อตเดียวกันต้องเป็นสกุลเงินเดียวกัน');
  }

  const total = rows.reduce((sum, r) => add(sum, String(r.amount)), zero());
  const now = new Date();
  const referenceNo = await nextReferenceNo(client, ctx.userId, now);
  const title = input.title?.trim() || referenceNo;

  const batchRes = await client.query(
    `INSERT INTO claim_batches (user_id, reference_no, title, status, total_amount, currency_code, submitted_at)
     VALUES ($1, $2, $3, 'claimed', $4, $5, now())
     RETURNING *`,
    [ctx.userId, referenceNo, title, total, currencyCode]
  );
  const batch = batchRes.rows[0]!;

  // 'pending' -> 'claimed' is exactly the one-step advance updateClaimStatus
  // allows, applied to the whole batch at once.
  const updated = await client.query(
    `UPDATE transactions
     SET claim_batch_id = $1, status = 'claimed', claimed_at = now()
     WHERE id = ANY($2::uuid[])
     RETURNING id`,
    [batch.id, input.transactionIds]
  );

  for (const row of rows) {
    await recordAudit(client, {
      userId: ctx.userId,
      entityType: 'transaction',
      entityId: row.id as string,
      action: 'status_change',
      before: row,
      after: { ...row, claim_batch_id: batch.id, status: 'claimed' },
      actorId: ctx.userId,
    });
  }
  if (updated.rowCount !== rows.length) throw Errors.validation('อัปเดตรายการในล็อตไม่ครบ กรุณาลองใหม่');

  const items = await client.query(`${WITH_CATEGORY} WHERE t.claim_batch_id = $1 ORDER BY t.transaction_date`, [batch.id]);
  return mapBatch(batch, items.rows.map(mapTransactionRow));
}

export async function listClaimBatches(client: DbClient, userId: string): Promise<ClaimBatch[]> {
  const batchesRes = await client.query(
    `SELECT * FROM claim_batches WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
    [userId]
  );
  if (batchesRes.rows.length === 0) return [];

  // One query for every batch's items, grouped in memory — avoids a query per
  // batch as the history grows.
  const itemsRes = await client.query(
    `${WITH_CATEGORY} WHERE t.claim_batch_id = ANY($1::uuid[]) AND t.deleted_at IS NULL ORDER BY t.transaction_date`,
    [batchesRes.rows.map((b) => b.id)]
  );
  const itemsByBatch = new Map<string, Transaction[]>();
  for (const row of itemsRes.rows) {
    const tx = mapTransactionRow(row);
    const list = itemsByBatch.get(tx.claimBatchId!) ?? [];
    list.push(tx);
    itemsByBatch.set(tx.claimBatchId!, list);
  }

  return batchesRes.rows.map((b) => mapBatch(b, itemsByBatch.get(b.id as string) ?? []));
}

/**
 * Unwinds a batch: puts its bills back to 'รอตั้งเบิก' and frees them to be
 * filed into a different one. Refused once any item has been reimbursed, since
 * that money movement is already booked and shouldn't be quietly reopened.
 */
export async function deleteClaimBatch(client: DbClient, ctx: Ctx, batchId: string): Promise<void> {
  const batchRes = await client.query(
    'SELECT * FROM claim_batches WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE',
    [batchId, ctx.userId]
  );
  if (batchRes.rows.length === 0) throw Errors.notFound('claim batch');

  const itemsRes = await client.query(
    `SELECT * FROM transactions WHERE claim_batch_id = $1 AND deleted_at IS NULL FOR UPDATE`,
    [batchId]
  );
  if (itemsRes.rows.some((r) => r.status === 'received')) {
    throw Errors.validation('ล็อตนี้มีรายการที่ได้รับเงินคืนแล้ว ยกเลิกล็อตไม่ได้');
  }

  await client.query(
    `UPDATE transactions SET claim_batch_id = NULL, status = 'pending', claimed_at = NULL WHERE claim_batch_id = $1`,
    [batchId]
  );
  await client.query('UPDATE claim_batches SET deleted_at = now() WHERE id = $1', [batchId]);

  for (const row of itemsRes.rows) {
    await recordAudit(client, {
      userId: ctx.userId,
      entityType: 'transaction',
      entityId: row.id as string,
      action: 'status_change',
      before: row,
      after: { ...row, claim_batch_id: null, status: 'pending' },
      actorId: ctx.userId,
    });
  }
}

/**
 * Called after a transaction reaches 'received'. When it was the last
 * outstanding bill in its batch, the batch itself is closed out too, so the
 * history view reflects reality without needing a nightly sweep.
 */
export async function syncBatchStatus(client: DbClient, batchId: string): Promise<void> {
  const res = await client.query<{ total: string; received: string }>(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'received') AS received
     FROM transactions WHERE claim_batch_id = $1 AND deleted_at IS NULL`,
    [batchId]
  );
  const { total, received } = res.rows[0]!;
  if (total === '0') return;
  if (total === received) {
    await client.query(`UPDATE claim_batches SET status = 'received', received_at = now() WHERE id = $1`, [batchId]);
  } else {
    await client.query(`UPDATE claim_batches SET status = 'claimed', received_at = NULL WHERE id = $1`, [batchId]);
  }
}
