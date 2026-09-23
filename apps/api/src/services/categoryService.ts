import type { Category, ClaimStatus, TransactionType } from '@finance/shared';
import type { DbClient } from '../db/pool.js';
import { Errors } from '../domain/errors.js';

function mapRow(row: Record<string, unknown>): Category {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    parentId: (row.parent_id as string | null) ?? null,
    name: row.name as string,
    appliesTo: row.applies_to as TransactionType[],
    defaultClaimStatus: (row.default_claim_status as ClaimStatus | null) ?? null,
    isClaimable: Boolean(row.is_claimable),
    // `icon` is otherwise-unused in this fixed schema, so it's repurposed as
    // a free-text status label the user can edit themselves (e.g. "รอรวมยอด")
    // that overrides the fixed claim_status enum's display text everywhere
    // the status pill is shown. default_claim_status still has to be set to
    // some enum value to satisfy the table's CHECK constraint, but nothing
    // branches on which one — it's `statusLabel` that's actually shown.
    statusLabel: (row.icon as string | null) ?? null,
    color: (row.color as string | null) ?? null,
    sortOrder: Number(row.sort_order),
    isSystem: Boolean(row.is_system),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    deletedAt: row.deleted_at ? new Date(row.deleted_at as string).toISOString() : null,
  };
}

export async function listCategories(client: DbClient, userId: string, appliesTo?: TransactionType): Promise<Category[]> {
  const res = await client.query(
    `SELECT * FROM categories
     WHERE user_id = $1 AND deleted_at IS NULL AND ($2::text IS NULL OR $2::transaction_type = ANY(applies_to))
     ORDER BY sort_order, name`,
    [userId, appliesTo ?? null]
  );
  return res.rows.map(mapRow);
}

export interface CreateCategoryInput {
  name: string;
  appliesTo: TransactionType[];
  statusLabel?: string | null;
  color?: string | null;
}

// The enum itself drives no behavior (see mapRow) — 'pending' is just a
// placeholder that satisfies the is_claimable/default_claim_status CHECK
// constraint whenever a category has a custom status label.
const PLACEHOLDER_CLAIM_STATUS: ClaimStatus = 'pending';

// A fixed, readable-on-both-themes palette for auto-assigned category badges —
// picked by a stable hash of the name (not a running count), so a category's
// color never shifts just because an earlier one was deleted or renamed.
const CATEGORY_PALETTE = [
  '#E2691B', '#3E6B4C', '#1B4965', '#8E44AD', '#A23A2E', '#B8860B', '#2F6690', '#6B4C9A', '#C1594B', '#3D8168',
];

function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return CATEGORY_PALETTE[Math.abs(hash) % CATEGORY_PALETTE.length]!;
}

export async function createCategory(client: DbClient, userId: string, input: CreateCategoryInput): Promise<Category> {
  const statusLabel = input.statusLabel?.trim() || null;
  const color = input.color?.trim() || colorForName(input.name);
  const res = await client.query(
    `INSERT INTO categories (user_id, name, applies_to, is_claimable, default_claim_status, icon, color)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [userId, input.name, input.appliesTo, statusLabel !== null, statusLabel !== null ? PLACEHOLDER_CLAIM_STATUS : null, statusLabel, color]
  );
  return mapRow(res.rows[0]);
}

export async function renameCategory(client: DbClient, userId: string, id: string, name: string): Promise<Category> {
  const res = await client.query(
    'UPDATE categories SET name = $1 WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL RETURNING *',
    [name, id, userId]
  );
  if (res.rows.length === 0) throw Errors.notFound('category');
  return mapRow(res.rows[0]);
}

export async function updateCategoryStatusLabel(client: DbClient, userId: string, id: string, statusLabelInput: string | null): Promise<Category> {
  const statusLabel = statusLabelInput?.trim() || null;
  const res = await client.query(
    `UPDATE categories SET is_claimable = $1, default_claim_status = $2, icon = $3
     WHERE id = $4 AND user_id = $5 AND deleted_at IS NULL RETURNING *`,
    [statusLabel !== null, statusLabel !== null ? PLACEHOLDER_CLAIM_STATUS : null, statusLabel, id, userId]
  );
  if (res.rows.length === 0) throw Errors.notFound('category');
  return mapRow(res.rows[0]);
}

export async function reorderCategories(client: DbClient, userId: string, orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await client.query('UPDATE categories SET sort_order = $1 WHERE id = $2 AND user_id = $3', [i, orderedIds[i], userId]);
  }
}

/**
 * Deleting a category leaves any transactions filed under it pointing at a
 * category_id that no longer resolves to anything visible — so they're
 * unassigned back to uncategorized rather than left orphaned/hidden.
 */
export async function deleteCategory(client: DbClient, userId: string, id: string): Promise<void> {
  const res = await client.query(
    'UPDATE categories SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND is_system = FALSE',
    [id, userId]
  );
  if (res.rowCount === 0) throw Errors.notFound('category');
  await client.query('UPDATE transactions SET category_id = NULL WHERE category_id = $1 AND user_id = $2', [id, userId]);
}
