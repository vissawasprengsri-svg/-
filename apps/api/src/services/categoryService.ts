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
    icon: (row.icon as string | null) ?? null,
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
  isClaimable?: boolean;
  defaultClaimStatus?: ClaimStatus | null;
}

export async function createCategory(client: DbClient, userId: string, input: CreateCategoryInput): Promise<Category> {
  if (input.isClaimable && !input.defaultClaimStatus) {
    throw Errors.validation('A claimable category needs a defaultClaimStatus');
  }
  const res = await client.query(
    `INSERT INTO categories (user_id, name, applies_to, is_claimable, default_claim_status)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [userId, input.name, input.appliesTo, input.isClaimable ?? false, input.defaultClaimStatus ?? null]
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

export async function updateCategoryClaimSettings(
  client: DbClient,
  userId: string,
  id: string,
  patch: { isClaimable: boolean; defaultClaimStatus: ClaimStatus | null }
): Promise<Category> {
  if (patch.isClaimable && !patch.defaultClaimStatus) {
    throw Errors.validation('A claimable category needs a defaultClaimStatus');
  }
  const res = await client.query(
    'UPDATE categories SET is_claimable = $1, default_claim_status = $2 WHERE id = $3 AND user_id = $4 AND deleted_at IS NULL RETURNING *',
    [patch.isClaimable, patch.isClaimable ? patch.defaultClaimStatus : null, id, userId]
  );
  if (res.rows.length === 0) throw Errors.notFound('category');
  return mapRow(res.rows[0]);
}

export async function deleteCategory(client: DbClient, userId: string, id: string): Promise<void> {
  const res = await client.query(
    'UPDATE categories SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND is_system = FALSE',
    [id, userId]
  );
  if (res.rowCount === 0) throw Errors.notFound('category');
}
