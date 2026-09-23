import { negate } from '@finance/shared';
import type { DbClient } from '../db/pool.js';

/** A snapshot of one row's columns, taken before and/or after a mutation. */
export interface RowSnapshot {
  table: 'transactions' | 'accounts' | 'debts';
  id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/**
 * A *relative* change to one numeric column, for figures that more than one
 * command can legitimately move: account/debt balances are shared running
 * totals, not values owned by a single transaction.
 *
 * Restoring those from an absolute before/after snapshot silently discards
 * every change made in between — undoing a transaction from this morning
 * would rewind the balance past the recurring rule that fired at noon, so the
 * noon charge would vanish from the balance while its transaction row stayed.
 * Storing the delta instead means undo replays as `balance - delta`, which
 * composes correctly no matter what else touched the row meanwhile.
 */
export interface DeltaSnapshot {
  kind: 'delta';
  table: 'accounts' | 'debts';
  id: string;
  column: string;
  delta: string; // signed minor units, in the direction this command applied
}

export type CommandSnapshot = RowSnapshot | DeltaSnapshot;

function isDelta(snapshot: CommandSnapshot): snapshot is DeltaSnapshot {
  return 'kind' in snapshot && snapshot.kind === 'delta';
}

interface PatchEntry {
  table: string;
  id: string;
  /** absolute column values to write (row-owned data) */
  values?: Record<string, unknown>;
  /** signed amounts to add to the named columns (shared running totals) */
  deltas?: Record<string, string>;
}

const MAX_UNDO_DEPTH = 20;

/**
 * Generic snapshot-based Command Pattern: every mutation records enough of
 * a before/after row snapshot to invert itself, without each call site
 * needing to hand-write bespoke undo logic. Undo restores `before`; redo
 * re-applies `after`.
 */
export async function recordCommand(
  client: DbClient,
  ctx: { userId: string; sessionId: string; commandType: string },
  snapshots: CommandSnapshot[]
): Promise<string> {
  // A brand-new action invalidates any pending redo stack.
  await client.query('DELETE FROM undo_commands WHERE session_id = $1 AND is_undone = TRUE', [ctx.sessionId]);

  const seqRes = await client.query<{ next_seq: string }>(
    `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_seq FROM undo_commands WHERE session_id = $1`,
    [ctx.sessionId]
  );
  const sequenceNo = Number(seqRes.rows[0]?.next_seq ?? 1);

  const forwardPatch: PatchEntry[] = [];
  const inversePatch: PatchEntry[] = [];
  for (const snapshot of snapshots) {
    if (isDelta(snapshot)) {
      forwardPatch.push({ table: snapshot.table, id: snapshot.id, deltas: { [snapshot.column]: snapshot.delta } });
      inversePatch.push({ table: snapshot.table, id: snapshot.id, deltas: { [snapshot.column]: negate(snapshot.delta) } });
      continue;
    }
    if (snapshot.after !== null) forwardPatch.push({ table: snapshot.table, id: snapshot.id, values: snapshot.after });
    if (snapshot.before !== null) inversePatch.push({ table: snapshot.table, id: snapshot.id, values: snapshot.before });
  }
  const affected = snapshots.map((s) => ({ table: s.table, id: s.id }));

  const insertRes = await client.query<{ id: string }>(
    `INSERT INTO undo_commands (user_id, session_id, sequence_no, command_type, forward_patch, inverse_patch, affected)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      ctx.userId,
      ctx.sessionId,
      sequenceNo,
      ctx.commandType,
      JSON.stringify(forwardPatch),
      JSON.stringify(inversePatch),
      JSON.stringify(affected),
    ]
  );

  // Trim the undo stack to the most recent MAX_UNDO_DEPTH active commands.
  await client.query(
    `DELETE FROM undo_commands
     WHERE session_id = $1 AND is_undone = FALSE
       AND sequence_no <= $2`,
    [ctx.sessionId, sequenceNo - MAX_UNDO_DEPTH]
  );

  return insertRes.rows[0]!.id;
}

async function applyPatch(client: DbClient, patch: PatchEntry[]): Promise<void> {
  for (const entry of patch) {
    // Relative entries are applied against the row's *current* value, so an
    // undo lands on "whatever the balance is now, minus what this command
    // added" instead of rewinding to a figure captured before other commands
    // ran. Entries written before deltas existed still carry `values` only,
    // so both shapes stay readable here.
    if (entry.deltas) {
      const columns = Object.keys(entry.deltas);
      if (columns.length === 0) continue;
      const setClause = columns.map((col, i) => `"${col}" = "${col}" + $${i + 2}::bigint`).join(', ');
      const amounts = columns.map((col) => entry.deltas![col]);
      await client.query(`UPDATE "${entry.table}" SET ${setClause} WHERE id = $1`, [entry.id, ...amounts]);
      continue;
    }
    if (!entry.values) continue;
    const columns = Object.keys(entry.values).filter((c) => c !== 'id');
    if (columns.length === 0) continue;
    const setClause = columns.map((col, i) => `"${col}" = $${i + 2}`).join(', ');
    const values = columns.map((col) => entry.values![col]);
    await client.query(`UPDATE "${entry.table}" SET ${setClause} WHERE id = $1`, [entry.id, ...values]);
  }
}

interface UndoCommandRow {
  id: string;
  command_type: string;
  forward_patch: PatchEntry[];
  inverse_patch: PatchEntry[];
  sequence_no: number;
}

/** Undoes the most recent not-yet-undone command in this session. */
export async function undoLast(client: DbClient, sessionId: string): Promise<UndoCommandRow | null> {
  const res = await client.query<UndoCommandRow>(
    `SELECT id, command_type, forward_patch, inverse_patch, sequence_no
     FROM undo_commands
     WHERE session_id = $1 AND is_undone = FALSE
     ORDER BY sequence_no DESC
     LIMIT 1
     FOR UPDATE`,
    [sessionId]
  );
  const command = res.rows[0];
  if (!command) return null;

  await applyPatch(client, command.inverse_patch);
  await client.query('UPDATE undo_commands SET is_undone = TRUE WHERE id = $1', [command.id]);
  return command;
}

/** Redoes the most recently undone command (top of the redo stack) in this session. */
export async function redoLast(client: DbClient, sessionId: string): Promise<UndoCommandRow | null> {
  const res = await client.query<UndoCommandRow>(
    `SELECT id, command_type, forward_patch, inverse_patch, sequence_no
     FROM undo_commands
     WHERE session_id = $1 AND is_undone = TRUE
     ORDER BY sequence_no ASC
     LIMIT 1
     FOR UPDATE`,
    [sessionId]
  );
  const command = res.rows[0];
  if (!command) return null;

  await applyPatch(client, command.forward_patch);
  await client.query('UPDATE undo_commands SET is_undone = FALSE WHERE id = $1', [command.id]);
  return command;
}

export async function fetchRow(
  client: DbClient,
  table: RowSnapshot['table'],
  id: string
): Promise<Record<string, unknown> | null> {
  const res = await client.query(`SELECT * FROM "${table}" WHERE id = $1`, [id]);
  return res.rows[0] ?? null;
}
