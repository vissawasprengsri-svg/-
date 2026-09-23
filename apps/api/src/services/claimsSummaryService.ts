import { add, zero, type ClaimGroup, type ClaimsSummary } from '@finance/shared';
import type { DbClient } from '../db/pool.js';
import { mapTransactionRow } from '../db/mappers.js';

const WITH_CATEGORY = `
  SELECT t.*, c.name AS category_name, c.is_claimable AS category_is_claimable,
         c.default_claim_status AS category_default_status, c.icon AS category_status_label
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
`;

const WITH_CATEGORY_AND_RECEIVED_ACCOUNT = `
  SELECT t.*, c.name AS category_name, c.is_claimable AS category_is_claimable,
         c.default_claim_status AS category_default_status, c.icon AS category_status_label,
         ra.name AS claim_received_account_name
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN accounts ra ON ra.id = t.claim_received_account_id
`;

function groupBy(rows: Record<string, unknown>[]): ClaimGroup[] {
  const groups = new Map<string, ClaimGroup>();
  for (const row of rows) {
    const key = (row.category_id as string | null) ?? '__none__';
    const existing = groups.get(key) ?? {
      categoryId: (row.category_id as string | null) ?? null,
      categoryName: (row.category_name as string | null) ?? 'ไม่ระบุหมวด',
      defaultClaimStatus: (row.category_default_status as ClaimGroup['defaultClaimStatus']) ?? null,
      statusLabel: (row.category_status_label as string | null) ?? null,
      total: zero(),
      items: [],
    };
    existing.total = add(existing.total, String(row.amount));
    existing.items.push(mapTransactionRow(row));
    groups.set(key, existing);
  }
  return [...groups.values()].sort((a, b) => (BigInt(b.total) > BigInt(a.total) ? 1 : -1));
}

export async function getClaimsSummary(client: DbClient, userId: string): Promise<ClaimsSummary> {
  const folderRes = await client.query(
    `${WITH_CATEGORY}
     WHERE t.user_id = $1 AND t.deleted_at IS NULL AND t.type = 'personal_expense'
       AND t.claim_received = FALSE AND c.is_claimable = TRUE
     ORDER BY t.transaction_date DESC`,
    [userId]
  );
  const folderGroups = groupBy(folderRes.rows);

  const claimRes = await client.query(
    `${WITH_CATEGORY}
     WHERE t.user_id = $1 AND t.deleted_at IS NULL AND t.type = 'pending_claim' AND t.status != 'received'
     ORDER BY t.transaction_date DESC`,
    [userId]
  );
  const claimGroups = groupBy(claimRes.rows);

  const loanRes = await client.query(
    `${WITH_CATEGORY}
     WHERE t.user_id = $1 AND t.deleted_at IS NULL AND t.type = 'loan_given' AND t.claim_received = FALSE
     ORDER BY t.transaction_date DESC`,
    [userId]
  );
  const loanGroups = groupBy(loanRes.rows);

  // History for the bulk-receive workflow: expenses/loans already paid back, most
  // recent first. Capped so a long-lived install's history doesn't balloon the
  // response — this is a recent-activity view, not a full ledger export.
  const completedRes = await client.query(
    `${WITH_CATEGORY_AND_RECEIVED_ACCOUNT}
     WHERE t.user_id = $1 AND t.deleted_at IS NULL
       AND (
         (t.type IN ('personal_expense', 'loan_given') AND t.claim_received = TRUE)
         OR (t.type = 'pending_claim' AND t.status = 'received')
       )
     ORDER BY t.updated_at DESC
     LIMIT 100`,
    [userId]
  );
  const completedGroups = groupBy(completedRes.rows);

  let totalOutstanding = zero();
  for (const g of [...folderGroups, ...claimGroups, ...loanGroups]) totalOutstanding = add(totalOutstanding, g.total);

  return { totalOutstanding, folderGroups, claimGroups, loanGroups, completedGroups };
}
