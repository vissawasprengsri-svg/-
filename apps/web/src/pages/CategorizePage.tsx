import { useEffect, useRef, useState } from 'react';
import type { AccountWithCard, Transaction, TransactionType } from '@finance/shared';
import { add, formatCurrency, fromMajorInput, toMajorString, zero } from '@finance/shared';
import { ArrowDownCircle, Check, HandCoins, Landmark, Pencil, Plus, Split, Trash2, X } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { ConfirmModal } from '../components/ConfirmModal';
import { useI18n } from '../i18n/I18nContext';
import { useCategories } from '../hooks/useCategories';
import { useAccounts } from '../hooks/useAccounts';
import { formatAmountDisplay, sanitizeAmountInput } from '../utils/amountFormat';

const CATEGORIZABLE_TYPES: TransactionType[] = ['personal_expense', 'pending_claim', 'loan_given'];

// Same palette + hash as categoryService.ts's colorForName — a fallback for
// categories created before colors were auto-assigned server-side, so every
// pill gets a stable, distinguishing color even if `category.color` is null.
const CATEGORY_PALETTE = ['#E2691B', '#3E6B4C', '#1B4965', '#8E44AD', '#A23A2E', '#B8860B', '#2F6690', '#6B4C9A', '#C1594B', '#3D8168'];
function categoryColor(c: { color: string | null; name: string }): string {
  if (c.color) return c.color;
  let hash = 0;
  for (let i = 0; i < c.name.length; i++) hash = (hash * 31 + c.name.charCodeAt(i)) | 0;
  return CATEGORY_PALETTE[Math.abs(hash) % CATEGORY_PALETTE.length]!;
}
const TYPE_ICON: Record<string, React.ReactNode> = {
  personal_expense: <ArrowDownCircle size={16} />,
  pending_claim: <Landmark size={16} />,
  loan_given: <HandCoins size={16} />,
};

function AccountSelect({
  value,
  onChange,
  accounts,
  noAccountLabel,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  accounts: AccountWithCard[];
  noAccountLabel: string;
  disabled?: boolean;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">{noAccountLabel}</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}

export function CategorizePage({
  onError,
  onChanged,
  onDeleted,
}: {
  onError: (message: string) => void;
  onChanged: () => void;
  onDeleted: (tx: Transaction, undo: () => Promise<void>) => void;
}) {
  const { t } = useI18n();
  const [activeType, setActiveType] = useState<TransactionType>('personal_expense');
  const { categories, refresh: refreshCategories } = useCategories(activeType, onError);
  const { accounts } = useAccounts(onError);
  const [unsorted, setUnsorted] = useState<Transaction[]>([]);
  const [unsortedSearch, setUnsortedSearch] = useState('');
  const [allItems, setAllItems] = useState<Transaction[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Which categories currently show their detail card. A Set rather than one id
  // so several can be open side by side on desktop — see the grid this renders
  // into further down, and onColumnClick/toggleExpanded for how entries flip.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showAddCategory, setShowAddCategory] = useState(false);
  // Set when the "รับเงินคืนทั้งล็อต" button is clicked for a category — carries the
  // category's own name so the modal can show "ยืนยันรับเงินเข้าหมวด ... " without
  // needing to look the category back up (and staying correct if its card gets
  // collapsed while the modal is still open).
  const [claimReceiveTarget, setClaimReceiveTarget] = useState<{ categoryId: string; categoryName: string } | null>(null);
  const [receiveTargetAccountId, setReceiveTargetAccountId] = useState('');
  // "Advance clearing": the bills were already covered out of a cash advance the
  // person holds, so this settles them with no money actually moving — sent to
  // the API as the NO_ACCOUNT_SENTINEL value ('NONE') instead of a real account id.
  const [isAdvanceClearing, setIsAdvanceClearing] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryStatusLabel, setNewCategoryStatusLabel] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editCategoryStatusLabel, setEditCategoryStatusLabel] = useState('');
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editAccountId, setEditAccountId] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [confirmDeleteCategoryId, setConfirmDeleteCategoryId] = useState<string | null>(null);
  const [confirmDeleteTxId, setConfirmDeleteTxId] = useState<string | null>(null);
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  // Set on drop, before anything is actually moved — dragging a transaction (or the whole
  // checkbox selection, if the dragged row was part of it) onto a category folder stages the
  // move here instead of firing it immediately, so it goes through the same confirm gate as
  // the bulk-move-bar's button.
  const [pendingDropMove, setPendingDropMove] = useState<{ txIds: string[]; targetCategoryId: string | null; targetCategoryName: string } | null>(
    null
  );
  const [selectedForMove, setSelectedForMove] = useState<Set<string>>(new Set());
  const [bulkTargetCategoryId, setBulkTargetCategoryId] = useState('');
  const [draggingIds, setDraggingIds] = useState<Set<string> | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [draggingCategoryId, setDraggingCategoryId] = useState<string | null>(null);
  const [dragOverTab, setDragOverTab] = useState<TransactionType | null>(null);
  const [splittingTx, setSplittingTx] = useState<Transaction | null>(null);
  const [splitAmounts, setSplitAmounts] = useState<string[]>(['', '']);
  const [sortBy, setSortBy] = useState<'date' | 'amount'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const latestRequestId = useRef(0);

  function statusLabel(c: { statusLabel: string | null; defaultClaimStatus: string | null }): string | null {
    // Categories created/edited before the custom label existed only have
    // the fixed enum value — fall back to its translated text so they don't
    // silently lose their visible status until someone edits them.
    return c.statusLabel ?? (c.defaultClaimStatus ? t(`claimStatus.${c.defaultClaimStatus}`) : null);
  }

  function accountName(accountId: string | null): string {
    if (!accountId) return t('categorize.noAccount');
    return accounts.find((a) => a.id === accountId)?.name ?? t('categorize.noAccount');
  }

  async function refresh() {
    const requestId = ++latestRequestId.current;
    try {
      // Category counts/grouping below need every matching row, not one page of
      // them, so this pages through all of them rather than calling searchTransactions directly.
      // Received/reimbursed items are done — this is the "still needs action" view, so they're
      // excluded here (they still show up in ClaimsPage's completed-history section).
      const [u, allItems] = await Promise.all([
        api.listUnsortedExpenses(activeType, true),
        api.searchAllTransactions({ type: activeType, excludeReceived: true }),
      ]);
      // A slower earlier refresh() call can resolve after a newer one (e.g.
      // several edits fired in quick succession) — ignore it so it can't
      // clobber fresher state.
      if (requestId !== latestRequestId.current) return;
      setUnsorted(u.transactions);
      setAllItems(allItems);
    } catch (err) {
      if (requestId === latestRequestId.current && err instanceof ApiError) onError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType]);

  function switchType(ty: TransactionType) {
    setActiveType(ty);
    setSelectedId(null);
    setExpandedIds(new Set());
    setEditingCategoryId(null);
    setEditingTxId(null);
    setConfirmDeleteCategoryId(null);
    setConfirmDeleteTxId(null);
    setSelectedForMove(new Set());
  }

  async function assign(transactionId: string, categoryId: string | null) {
    try {
      await api.setTransactionCategory(transactionId, categoryId);
      setSelectedId(null);
      await refresh();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function addCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      await api.createCategory({
        name,
        appliesTo: [activeType],
        statusLabel: activeType === 'personal_expense' ? newCategoryStatusLabel.trim() || null : null,
      });
      setNewCategoryName('');
      setNewCategoryStatusLabel('');
      setShowAddCategory(false);
      await refreshCategories();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  function startEditCategory(id: string, name: string, statusLabelValue: string | null) {
    setEditingCategoryId(id);
    setEditCategoryName(name);
    setEditCategoryStatusLabel(statusLabelValue ?? '');
  }

  async function saveEditCategory(id: string, originalStatusLabel: string | null) {
    const name = editCategoryName.trim();
    setEditingCategoryId(null);
    if (!name) return;
    try {
      await api.renameCategory(id, name);
      if (activeType === 'personal_expense') {
        const newStatusLabel = editCategoryStatusLabel.trim() || null;
        if (newStatusLabel !== originalStatusLabel) {
          await api.updateCategoryStatusLabel(id, newStatusLabel);
        }
      }
      await refreshCategories();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  function collapseCategory(id: string) {
    setExpandedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function deleteCategory(id: string) {
    setConfirmDeleteCategoryId(null);
    try {
      await api.deleteCategory(id);
      collapseCategory(id);
      await refreshCategories();
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  function closeReceiveClaims() {
    setClaimReceiveTarget(null);
    setReceiveTargetAccountId('');
    setIsAdvanceClearing(false);
  }

  async function confirmReceiveClaims() {
    if (!claimReceiveTarget) return;
    if (!isAdvanceClearing && !receiveTargetAccountId) return;
    try {
      await api.receiveCategoryClaims(claimReceiveTarget.categoryId, isAdvanceClearing ? 'NONE' : receiveTargetAccountId);
      closeReceiveClaims();
      await refresh();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  function startEditTx(tx: Transaction) {
    setEditingTxId(tx.id);
    setConfirmDeleteTxId(null);
    setEditAmount(toMajorString(tx.amount, 2));
    setEditDesc(tx.description ?? '');
    setEditNote(tx.note ?? '');
    setEditAccountId(tx.accountId ?? '');
    setEditDate(tx.transactionDate);
    if (tx.occurredAt) {
      const d = new Date(tx.occurredAt);
      setEditTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    } else {
      setEditTime('');
    }
  }

  async function saveEditTx(id: string, originalAccountId: string | null) {
    setEditingTxId(null);
    try {
      await api.updateTransactionDetails(id, {
        amountMajor: editAmount || '0',
        description: editDesc,
        note: editNote,
        transactionDate: editDate,
        occurredAt: editTime ? new Date(`${editDate}T${editTime}`).toISOString() : null,
      });
      const newAccountId = editAccountId || null;
      if (newAccountId !== originalAccountId) {
        await api.updateTransactionAccount(id, newAccountId);
      }
      await refresh();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function removeTx(tx: Transaction) {
    setEditingTxId(null);
    setConfirmDeleteTxId(null);
    try {
      // Unassign the category first (its own undo step) so the delete
      // command's own "before" snapshot has no category — restoring it
      // later lands the item back in "unsorted" instead of silently
      // re-filing it under a category the user may not want it in anymore.
      if (tx.categoryId) {
        await api.setTransactionCategory(tx.id, null);
      }
      await api.deleteTransaction(tx.id);
      await refresh();
      onDeleted(tx, async () => {
        await api.undo();
        await refresh();
      });
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function convertTx(tx: Transaction) {
    setEditingTxId(null);
    try {
      await api.convertToClaim(tx.id);
      // The row's type just changed to pending_claim, so it drops out of this
      // (personal_expense-only) view the moment refresh() re-fetches.
      await refresh();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  /** Divides amountMinor into n integer parts that sum back to it exactly — any leftover
   * cent from integer division goes to the first parts, one each, rather than being
   * dropped or piled onto the last part. */
  function equalSplitMajor(amountMinor: string, n: number): string[] {
    const total = BigInt(amountMinor);
    const base = total / BigInt(n);
    const remainder = total % BigInt(n);
    const parts: bigint[] = [];
    for (let i = 0; i < n; i++) {
      parts.push(base + (i < remainder ? 1n : 0n));
    }
    return parts.map((p) => toMajorString(p.toString(), 2));
  }

  function startSplit(tx: Transaction) {
    setEditingTxId(null);
    setSplittingTx(tx);
    setSplitAmounts(equalSplitMajor(tx.amount, 2));
  }

  function setSplitCount(n: number) {
    if (!splittingTx) return;
    setSplitAmounts(equalSplitMajor(splittingTx.amount, n));
  }

  function updateSplitAmount(index: number, value: string) {
    setSplitAmounts((prev) => prev.map((v, i) => (i === index ? value : v)));
  }

  function cancelSplit() {
    setSplittingTx(null);
    setSplitAmounts(['', '']);
  }

  async function submitSplit() {
    if (!splittingTx) return;
    try {
      await api.splitTransaction(
        splittingTx.id,
        splitAmounts.map((a) => ({ amountMajor: a || '0' }))
      );
      cancelSplit();
      await refresh();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  // Dropping a dragged transaction (or the whole checkbox selection) onto a type tab
  // converts it to that type. Only pending_claim and loan_given have a conversion path
  // (from personal_expense) — dropping onto any other tab is a no-op.
  async function handleTabDrop(e: React.DragEvent, ty: TransactionType) {
    e.preventDefault();
    setDragOverTab(null);
    if (ty !== 'pending_claim' && ty !== 'loan_given') return;
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;
    let ids: string[];
    try {
      const parsed = JSON.parse(raw);
      ids = Array.isArray(parsed) ? parsed : [raw];
    } catch {
      ids = [raw];
    }
    if (ids.length === 0) return;
    for (const id of ids) {
      try {
        if (ty === 'pending_claim') await api.convertToClaim(id);
        else await api.convertToLoan(id);
      } catch (err) {
        if (err instanceof ApiError) onError(err.message);
        break;
      }
    }
    setSelectedForMove(new Set());
    await refresh();
    onChanged();
  }

  function onDragStart(e: React.DragEvent, id: string) {
    // Dragging an item that's part of the current checkbox selection drags
    // the whole selection together; dragging an unselected item (even while
    // others are selected) only moves that one item.
    const ids = selectedForMove.has(id) && selectedForMove.size > 0 ? Array.from(selectedForMove) : [id];
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify(ids));
    setDraggingIds(new Set(ids));
  }
  function onDragEnd() {
    setDraggingIds(null);
    setDragOverTarget(null);
  }
  // Category pills are draggable among themselves to reorder, using a distinct
  // MIME type so a drop handler can tell "reorder the pills" apart from "file
  // these transactions under this pill" (text/plain, used by onDragStart above).
  const CATEGORY_REORDER_TYPE = 'application/x-category-id';
  function onCategoryDragStart(e: React.DragEvent, categoryId: string) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(CATEGORY_REORDER_TYPE, categoryId);
    setDraggingCategoryId(categoryId);
  }
  function onCategoryDragEnd() {
    setDraggingCategoryId(null);
    setDragOverTarget(null);
  }
  async function reorderCategoryTo(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const order = categories.map((c) => c.id);
    const from = order.indexOf(draggedId);
    const to = order.indexOf(targetId);
    if (from === -1 || to === -1) return;
    order.splice(from, 1);
    order.splice(to, 0, draggedId);
    try {
      await api.reorderCategories(order);
      await refreshCategories();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  function onDrop(e: React.DragEvent, categoryId: string | null) {
    e.preventDefault();
    setDragOverTarget(null);
    if (e.dataTransfer.types.includes(CATEGORY_REORDER_TYPE)) {
      const draggedCategoryId = e.dataTransfer.getData(CATEGORY_REORDER_TYPE);
      if (draggedCategoryId && categoryId) reorderCategoryTo(draggedCategoryId, categoryId);
      return;
    }
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;
    let ids: string[];
    try {
      const parsed = JSON.parse(raw);
      ids = Array.isArray(parsed) ? parsed : [raw];
    } catch {
      ids = [raw];
    }
    if (ids.length === 0) return;
    const targetCategoryName = categoryId ? categories.find((c) => c.id === categoryId)?.name ?? '' : t('categorize.unsorted');
    setPendingDropMove({ txIds: ids, targetCategoryId: categoryId, targetCategoryName });
  }

  async function confirmDropMove() {
    if (!pendingDropMove) return;
    const { txIds, targetCategoryId } = pendingDropMove;
    setPendingDropMove(null);
    for (const id of txIds) {
      try {
        await api.setTransactionCategory(id, targetCategoryId);
      } catch (err) {
        if (err instanceof ApiError) onError(err.message);
        break;
      }
    }
    setSelectedId(null);
    setSelectedForMove(new Set());
    await refresh();
    onChanged();
  }
  function onColumnClick(categoryId: string | null) {
    if (selectedId) {
      assign(selectedId, categoryId);
      return;
    }
    setConfirmDeleteCategoryId(null);
    setSelectedForMove(new Set());
    setBulkTargetCategoryId('');
    // The "unsorted" pill has no detail card of its own to open — the unsorted
    // queue is always visible below, unconditionally.
    if (categoryId === null) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  function toggleSort(by: 'date' | 'amount') {
    if (sortBy === by) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(by);
      setSortDir('desc');
    }
  }

  function toggleSelectForMove(id: string) {
    setSelectedForMove((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSelectAllToggle(items: Transaction[]) {
    const isAllSelected = items.length > 0 && items.every((tx) => selectedForMove.has(tx.id));
    setSelectedForMove((prev) => {
      const next = new Set(prev);
      for (const tx of items) {
        if (isAllSelected) next.delete(tx.id);
        else next.add(tx.id);
      }
      return next;
    });
  }

  async function bulkMove() {
    setIsMoveModalOpen(false);
    const targetId = bulkTargetCategoryId || null;
    const ids = Array.from(selectedForMove);
    for (const id of ids) {
      try {
        await api.setTransactionCategory(id, targetId);
      } catch (err) {
        if (err instanceof ApiError) onError(err.message);
        break;
      }
    }
    setSelectedForMove(new Set());
    setBulkTargetCategoryId('');
    await refresh();
    onChanged();
  }

  async function handleBulkDelete() {
    setIsBulkDeleteModalOpen(false);
    const ids = Array.from(selectedForMove);
    const byId = new Map([...allItems, ...unsorted].map((tx) => [tx.id, tx]));
    for (const id of ids) {
      try {
        // Same reasoning as the single-row delete: drop the category first so
        // undo's own "before" snapshot has no category, landing the restored
        // row back in "unsorted" instead of silently re-filing it.
        const tx = byId.get(id);
        if (tx?.categoryId) {
          await api.setTransactionCategory(id, null);
        }
        await api.deleteTransaction(id);
      } catch (err) {
        if (err instanceof ApiError) onError(err.message);
        break;
      }
    }
    setSelectedForMove(new Set());
    await refresh();
    onChanged();
  }

  const accountOptions = accounts.filter((a) => !a.isArchived);

  const categoryCounts = new Map<string, number>();
  const categoryTotals = new Map<string, string>();
  for (const tx of allItems) {
    if (tx.categoryId) {
      categoryCounts.set(tx.categoryId, (categoryCounts.get(tx.categoryId) ?? 0) + 1);
      categoryTotals.set(tx.categoryId, add(categoryTotals.get(tx.categoryId) ?? zero(), tx.amount));
    }
  }
  const unsortedTotal = unsorted.reduce((sum, tx) => add(sum, tx.amount), zero());
  const unsortedSearchLower = unsortedSearch.trim().toLowerCase();
  const filteredUnsorted = unsortedSearchLower
    ? unsorted.filter(
        (tx) => (tx.description ?? '').toLowerCase().includes(unsortedSearchLower) || (tx.note ?? '').toLowerCase().includes(unsortedSearchLower)
      )
    : unsorted;

  // Sort preference is shared across every open category card rather than kept
  // per-card — it reads as "how do I want to view lists" globally, the same
  // way it behaved back when only one category could be open at a time.
  function sortedItemsFor(categoryId: string): Transaction[] {
    const items = allItems.filter((tx) => tx.categoryId === categoryId);
    return items.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortBy === 'amount') return dir * (Number(a.amount) - Number(b.amount));
      return dir * (a.transactionDate.localeCompare(b.transactionDate) || a.createdAt.localeCompare(b.createdAt));
    });
  }

  const splitSumMinor = splitAmounts.reduce((sum, a) => sum + BigInt(fromMajorInput(a || '0', 2)), 0n);
  const splitOriginalMinor = splittingTx ? BigInt(splittingTx.amount) : 0n;
  const splitValid = splittingTx !== null && splitSumMinor === splitOriginalMinor && splitAmounts.every((a) => Number(a) > 0);

  return (
    <div className="stack">
      <div className="type-select">
        {CATEGORIZABLE_TYPES.map((ty) => (
          <button
            key={ty}
            className={`${activeType === ty ? 'active' : ''} ${dragOverTab === ty ? 'drag-over' : ''}`}
            onClick={() => switchType(ty)}
            onDragOver={(e) => e.preventDefault()}
            onDragEnter={() => setDragOverTab(ty)}
            onDragLeave={() => setDragOverTab((t) => (t === ty ? null : t))}
            onDrop={(e) => handleTabDrop(e, ty)}
          >
            {TYPE_ICON[ty]}
            {t(`txType.${ty}`)}
          </button>
        ))}
      </div>

      <div className="categorize-bar">
        <p className="hint">
          {unsorted.length > 0 ? t('categorize.hint', { count: unsorted.length }) : t('categorize.allDone')}
        </p>
        <button type="button" className="add-fab" onClick={() => setShowAddCategory(true)} aria-label={t('categorize.newCategoryTitle')}>
          <Plus size={18} />
        </button>
      </div>

      {/* The unsorted pile is the one thing that always needs clearing first, so it
          gets its own full-width banner above the category grid rather than being
          just another tile lost among them. */}
      <div
        role="button"
        tabIndex={0}
        className={`unsorted-card ${dragOverTarget === 'unsorted' ? 'drag-over' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDragEnter={() => setDragOverTarget('unsorted')}
        onDragLeave={() => setDragOverTarget((t) => (t === 'unsorted' ? null : t))}
        onDrop={(e) => onDrop(e, null)}
        onClick={() => onColumnClick(null)}
        onKeyDown={(e) => e.key === 'Enter' && onColumnClick(null)}
      >
        <span className="unsorted-card-name">{t('categorize.unsorted')}</span>
        <span className="unsorted-card-meta">
          <span className="unsorted-card-count">{t('categorize.itemsCount', { count: unsorted.length })}</span>
          {unsorted.length > 0 && <b className="unsorted-card-total">{formatCurrency(unsortedTotal, '฿', 2)}</b>}
        </span>
      </div>

      <div className="category-grid">
        {categories.map((c) =>
          editingCategoryId === c.id ? (
            <div key={c.id} className="cat-card cat-card-editing" onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                className="rename-input"
                placeholder={t('settings.addCategoryNamePlaceholder')}
                value={editCategoryName}
                onChange={(e) => setEditCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveEditCategory(c.id, statusLabel(c));
                  if (e.key === 'Escape') setEditingCategoryId(null);
                }}
              />
              {activeType === 'personal_expense' && (
                <input
                  className="rename-input"
                  placeholder={t('categorize.newCategoryStatusLabel')}
                  value={editCategoryStatusLabel}
                  onChange={(e) => setEditCategoryStatusLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEditCategory(c.id, statusLabel(c));
                    if (e.key === 'Escape') setEditingCategoryId(null);
                  }}
                />
              )}
              <div className="modal-actions">
                <button type="button" className="pill-icon-btn" onClick={() => saveEditCategory(c.id, statusLabel(c))}>
                  <Check size={15} />
                </button>
                <button type="button" className="pill-icon-btn" onClick={() => setEditingCategoryId(null)}>
                  <X size={15} />
                </button>
              </div>
            </div>
          ) : (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              draggable
              className={`cat-card ${expandedIds.has(c.id) ? 'active' : ''} ${dragOverTarget === c.id ? 'drag-over' : ''} ${draggingCategoryId === c.id ? 'dragging' : ''}`}
              style={{ borderTop: `4px solid ${categoryColor(c)}` }}
              onDragStart={(e) => onCategoryDragStart(e, c.id)}
              onDragEnd={onCategoryDragEnd}
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={() => setDragOverTarget(c.id)}
              onDragLeave={() => setDragOverTarget((t) => (t === c.id ? null : t))}
              onDrop={(e) => onDrop(e, c.id)}
              onClick={() => onColumnClick(c.id)}
              onKeyDown={(e) => e.key === 'Enter' && onColumnClick(c.id)}
            >
              <div className="cat-card-head">
                <span className="cat-card-name">{c.name}</span>
                <button
                  type="button"
                  className="pill-icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    startEditCategory(c.id, c.name, statusLabel(c));
                  }}
                >
                  <Pencil size={13} />
                </button>
              </div>
              {statusLabel(c) && <span className="cat-card-status">💰 {statusLabel(c)}</span>}
              <div className="cat-card-meta">
                <span className="cat-card-count">{t('categorize.itemsCount', { count: categoryCounts.get(c.id) ?? 0 })}</span>
                {categoryCounts.has(c.id) && <b className="cat-card-total">{formatCurrency(categoryTotals.get(c.id)!, '฿', 2)}</b>}
              </div>
            </div>
          )
        )}
      </div>

      {expandedIds.size > 1 && (
        <button type="button" className="linklike" onClick={() => setExpandedIds(new Set())}>
          {t('categorize.collapseAll', { count: expandedIds.size })}
        </button>
      )}

      {selectedForMove.size > 0 && (
        <div className="bulk-move-bar">
          <span>{t('categorize.selectedCount', { count: selectedForMove.size })}</span>
          <select value={bulkTargetCategoryId} onChange={(e) => setBulkTargetCategoryId(e.target.value)}>
            <option value="">{t('categorize.unsorted')}</option>
            {categories
              .filter((c) => !expandedIds.has(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <button type="button" className="primary-btn" onClick={() => setIsMoveModalOpen(true)}>
            {t('categorize.moveSelected')}
          </button>
          <button type="button" className="del" onClick={() => setIsBulkDeleteModalOpen(true)}>
            <Trash2 size={13} /> {t('categorize.deleteSelected')}
          </button>
          <button type="button" className="secondary-btn" onClick={() => setSelectedForMove(new Set())}>
            {t('categorize.cancel')}
          </button>
        </div>
      )}

      <ConfirmModal
        isOpen={isBulkDeleteModalOpen}
        message={t('confirm.bulkDeleteMessage', { count: selectedForMove.size })}
        onConfirm={handleBulkDelete}
        onCancel={() => setIsBulkDeleteModalOpen(false)}
      />

      <ConfirmModal
        isOpen={isMoveModalOpen}
        title={t('confirm.moveTitle')}
        message={t('confirm.moveMessage', {
          count: selectedForMove.size,
          category: bulkTargetCategoryId ? categories.find((c) => c.id === bulkTargetCategoryId)?.name ?? '' : t('categorize.unsorted'),
        })}
        confirmText={t('confirm.moveConfirm')}
        confirmVariant="primary"
        onConfirm={bulkMove}
        onCancel={() => setIsMoveModalOpen(false)}
      />

      <ConfirmModal
        isOpen={pendingDropMove !== null}
        title={t('confirm.moveTitle')}
        message={t('confirm.moveMessage', {
          count: pendingDropMove?.txIds.length ?? 0,
          category: pendingDropMove?.targetCategoryName ?? '',
        })}
        confirmText={t('confirm.moveConfirm')}
        confirmVariant="primary"
        onConfirm={confirmDropMove}
        onCancel={() => setPendingDropMove(null)}
      />

      {showAddCategory && (
        <div className="modal-backdrop" onClick={() => setShowAddCategory(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>{t('categorize.newCategoryTitle')}</h3>
            <input
              autoFocus
              type="text"
              placeholder={t('settings.addCategoryNamePlaceholder')}
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCategory()}
            />
            {activeType === 'personal_expense' && (
              <label className="field">
                <span>{t('categorize.newCategoryStatusLabel')}</span>
                <input
                  type="text"
                  placeholder={t('categorize.statusLabelPlaceholder')}
                  value={newCategoryStatusLabel}
                  onChange={(e) => setNewCategoryStatusLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCategory()}
                />
              </label>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary-btn" onClick={() => setShowAddCategory(false)}>
                {t('categorize.cancel')}
              </button>
              <button type="button" className="primary-btn" onClick={addCategory}>
                {t('settings.add')}
              </button>
            </div>
          </div>
        </div>
      )}

      {claimReceiveTarget && (
        <div className="modal-backdrop" onClick={closeReceiveClaims}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>{t('categorize.receiveClaimsTitle')}</h3>
            <p className="confirm-message">{t('categorize.receiveClaimsMessage', { category: claimReceiveTarget.categoryName })}</p>
            <AccountSelect
              value={receiveTargetAccountId}
              onChange={setReceiveTargetAccountId}
              accounts={accounts}
              noAccountLabel={t('categorize.noAccount')}
              disabled={isAdvanceClearing}
            />
            <label className="checkbox-row">
              <input type="checkbox" checked={isAdvanceClearing} onChange={(e) => setIsAdvanceClearing(e.target.checked)} />
              {t('categorize.advanceClearing')}
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary-btn" onClick={closeReceiveClaims}>
                {t('categorize.cancel')}
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={!isAdvanceClearing && !receiveTargetAccountId}
                onClick={confirmReceiveClaims}
              >
                {t('categorize.receiveClaimsConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {splittingTx && (
        <div className="modal-backdrop" onClick={cancelSplit}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>{t('categorize.splitTitle')}</h3>
            <p className="confirm-message">
              {t('categorize.splitOriginal', { desc: splittingTx.description || t(`txType.${splittingTx.type}`), amount: formatCurrency(splittingTx.amount, '฿', 2) })}
            </p>
            <div className="pill-row">
              {[2, 3].map((n) => (
                <button key={n} type="button" className={splitAmounts.length === n ? 'active' : ''} onClick={() => setSplitCount(n)}>
                  {t('categorize.splitParts', { count: n })}
                </button>
              ))}
            </div>
            {splitAmounts.map((amount, i) => (
              <label key={i} className="field">
                <span>{t('categorize.splitPartLabel', { index: i + 1 })}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={formatAmountDisplay(amount)}
                  onChange={(e) => updateSplitAmount(i, sanitizeAmountInput(e.target.value))}
                />
              </label>
            ))}
            <p className={`confirm-message ${splitValid ? '' : 'split-sum-warning'}`}>
              {t('categorize.splitSum', { sum: formatCurrency(splitSumMinor.toString(), '฿', 2), original: formatCurrency(splittingTx.amount, '฿', 2) })}
            </p>
            <div className="modal-actions">
              <button type="button" className="secondary-btn" onClick={cancelSplit}>
                {t('categorize.cancel')}
              </button>
              <button type="button" className="primary-btn" disabled={!splitValid} onClick={submitSplit}>
                {t('categorize.splitConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {expandedIds.size > 0 && (
        <div className="cat-detail-grid">
          {[...expandedIds].map((categoryId) => {
            const category = categories.find((c) => c.id === categoryId);
            if (!category) return null;
            const items = sortedItemsFor(categoryId);
            const total = categoryTotals.get(categoryId) ?? zero();
            return (
              <div className="cat-detail" key={categoryId}>
                <div className="cat-detail-head">
                  <strong>{category.name}</strong>
                  {items.length > 0 && <b className="cat-detail-total">{formatCurrency(total, '฿', 2)}</b>}
                  <div className="cat-detail-actions">
                    {confirmDeleteCategoryId === category.id ? (
                      <>
                        <span className="confirm-text">{t('categorize.confirmDeleteCategory')}</span>
                        <button type="button" className="danger-btn" onClick={() => deleteCategory(category.id)}>
                          {t('categorize.confirmDeleteYes')}
                        </button>
                        <button type="button" onClick={() => setConfirmDeleteCategoryId(null)}>
                          {t('categorize.cancel')}
                        </button>
                      </>
                    ) : (
                      <>
                        {items.length > 0 &&
                          // A "receive" makes sense for a รอเบิก folder or a ให้ยืม folder (repayment
                          // is the whole point of both types) — but for รายจ่าย it only applies to
                          // folders actually tagged as claimable (isClaimable), not an ordinary
                          // everyday expense category, which has nothing to reimburse.
                          (activeType === 'pending_claim' || activeType === 'loan_given' || (activeType === 'personal_expense' && category.isClaimable)) && (
                            <button
                              type="button"
                              className="primary-btn"
                              onClick={() => setClaimReceiveTarget({ categoryId: category.id, categoryName: category.name })}
                            >
                              {t('categorize.receiveClaimsButton')}
                            </button>
                          )}
                        <button type="button" onClick={() => setConfirmDeleteCategoryId(category.id)}>
                          <Trash2 size={14} /> {t('categorize.deleteCategory')}
                        </button>
                        <button type="button" onClick={() => collapseCategory(category.id)}>
                          <X size={14} /> {t('categorize.viewClose')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {items.length === 0 ? (
                  <p className="empty-sm">{t('categorize.emptyCategory')}</p>
                ) : (
                  <>
                    <div className="sort-toolbar">
                      <label className="select-all-label">
                        <input
                          type="checkbox"
                          checked={items.length > 0 && items.every((tx) => selectedForMove.has(tx.id))}
                          onChange={() => handleSelectAllToggle(items)}
                        />
                        {t('categorize.selectAll')}
                      </label>
                      <span className="hint">{t('categorize.sortBy')}</span>
                      <div className="pill-row">
                        <button type="button" className={sortBy === 'date' ? 'active' : ''} onClick={() => toggleSort('date')}>
                          {t('categorize.sortDate')} {sortBy === 'date' && (sortDir === 'asc' ? '↑' : '↓')}
                        </button>
                        <button type="button" className={sortBy === 'amount' ? 'active' : ''} onClick={() => toggleSort('amount')}>
                          {t('categorize.sortAmount')} {sortBy === 'amount' && (sortDir === 'asc' ? '↑' : '↓')}
                        </button>
                      </div>
                    </div>
                    <ul className="list">
                    {items.map((tx) =>
                      editingTxId === tx.id ? (
                        <li key={tx.id} className="row edit-row">
                          <input
                            autoFocus
                            className="rename-input"
                            placeholder={t('categorize.descriptionPlaceholder')}
                            value={editDesc}
                            onChange={(e) => setEditDesc(e.target.value)}
                          />
                          <input
                            className="rename-input"
                            placeholder={t('form.notePlaceholder')}
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                          />
                          <input type="date" style={{ maxWidth: 140 }} value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                          <input type="time" style={{ maxWidth: 110 }} value={editTime} onChange={(e) => setEditTime(e.target.value)} />
                          <input
                            type="text"
                            inputMode="decimal"
                            className="meta-input"
                            placeholder={t('categorize.amountPlaceholder')}
                            value={formatAmountDisplay(editAmount)}
                            onChange={(e) => setEditAmount(sanitizeAmountInput(e.target.value))}
                          />
                          <AccountSelect
                            value={editAccountId}
                            onChange={setEditAccountId}
                            accounts={accountOptions}
                            noAccountLabel={t('categorize.noAccount')}
                          />
                          {confirmDeleteTxId === tx.id ? (
                            <span className="confirm-text">
                              {t('categorize.confirmDeleteTransaction')}
                              <button type="button" className="danger-btn" onClick={() => removeTx(tx)}>
                                {t('categorize.confirmDeleteYes')}
                              </button>
                              <button type="button" onClick={() => setConfirmDeleteTxId(null)}>
                                {t('categorize.cancel')}
                              </button>
                            </span>
                          ) : (
                            <>
                              <button className="icon-btn" onClick={() => saveEditTx(tx.id, tx.accountId ?? null)}>
                                <Check size={14} />
                              </button>
                              <button className="icon-btn" onClick={() => setEditingTxId(null)}>
                                <X size={14} />
                              </button>
                              {activeType === 'personal_expense' && (
                                <button className="icon-btn convert-btn" onClick={() => convertTx(tx)}>
                                  <Landmark size={14} /> {t('categorize.convertToClaim')}
                                </button>
                              )}
                              <button className="icon-btn" onClick={() => startSplit(tx)}>
                                <Split size={14} /> {t('categorize.split')}
                              </button>
                              <button className="icon-btn" aria-label={t('form.removeRow')} onClick={() => setConfirmDeleteTxId(tx.id)}>
                                <Trash2 size={14} />
                              </button>
                            </>
                          )}
                        </li>
                      ) : (
                        <li
                          key={tx.id}
                          draggable
                          onDragStart={(e) => onDragStart(e, tx.id)}
                          onDragEnd={onDragEnd}
                          className={`row draggable ${draggingIds?.has(tx.id) ? 'dragging' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedForMove.has(tx.id)}
                            onChange={() => toggleSelectForMove(tx.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="row-info">
                            <span className="desc">{tx.description || t(`txType.${tx.type}`)}</span>
                            <span className="meta">
                              {tx.transactionDate} · {accountName(tx.accountId)}
                              {tx.note && ` · ${tx.note}`}
                            </span>
                          </div>
                          <span className="amt">{formatCurrency(tx.amount, '฿', 2)}</span>
                          <button className="icon-btn" onClick={() => startEditTx(tx)}>
                            <Pencil size={14} />
                          </button>
                        </li>
                      )
                    )}
                    </ul>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {unsorted.length > 0 && (
        <input
          type="text"
          className="unsorted-search"
          placeholder={t('categorize.searchUnsorted')}
          value={unsortedSearch}
          onChange={(e) => setUnsortedSearch(e.target.value)}
        />
      )}

      {unsorted.length > 0 && (
        <div className="sort-toolbar">
          <label className="select-all-label">
            <input
              type="checkbox"
              checked={filteredUnsorted.length > 0 && filteredUnsorted.every((tx) => selectedForMove.has(tx.id))}
              onChange={() => handleSelectAllToggle(filteredUnsorted)}
            />
            {t('categorize.selectAll')}
          </label>
          {unsortedSearchLower && <span className="hint">{t('categorize.searchResultCount', { count: filteredUnsorted.length })}</span>}
        </div>
      )}

      <ul className="queue">
        {filteredUnsorted.map((tx) =>
          editingTxId === tx.id ? (
            <li key={tx.id} className="queue-item queue-item-editing">
              <input
                autoFocus
                className="rename-input"
                placeholder={t('categorize.descriptionPlaceholder')}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
              />
              <input
                className="rename-input"
                placeholder={t('form.notePlaceholder')}
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
              />
              <input type="date" style={{ maxWidth: 140 }} value={editDate} onChange={(e) => setEditDate(e.target.value)} />
              <input type="time" style={{ maxWidth: 110 }} value={editTime} onChange={(e) => setEditTime(e.target.value)} />
              <input
                type="text"
                inputMode="decimal"
                className="meta-input"
                placeholder={t('categorize.amountPlaceholder')}
                value={formatAmountDisplay(editAmount)}
                onChange={(e) => setEditAmount(sanitizeAmountInput(e.target.value))}
              />
              <AccountSelect
                      value={editAccountId}
                      onChange={setEditAccountId}
                      accounts={accountOptions}
                      noAccountLabel={t('categorize.noAccount')}
                    />
              {confirmDeleteTxId === tx.id ? (
                <span className="confirm-text">
                  {t('categorize.confirmDeleteTransaction')}
                  <button type="button" className="danger-btn" onClick={() => removeTx(tx)}>
                    {t('categorize.confirmDeleteYes')}
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteTxId(null)}>
                    {t('categorize.cancel')}
                  </button>
                </span>
              ) : (
                <>
                  <button className="icon-btn" onClick={() => saveEditTx(tx.id, tx.accountId ?? null)}>
                    <Check size={14} />
                  </button>
                  <button className="icon-btn" onClick={() => setEditingTxId(null)}>
                    <X size={14} />
                  </button>
                  {activeType === 'personal_expense' && (
                    <button className="icon-btn convert-btn" onClick={() => convertTx(tx)}>
                      <Landmark size={14} /> {t('categorize.convertToClaim')}
                    </button>
                  )}
                  <button className="icon-btn" onClick={() => startSplit(tx)}>
                    <Split size={14} /> {t('categorize.split')}
                  </button>
                  <button className="icon-btn" aria-label={t('form.removeRow')} onClick={() => setConfirmDeleteTxId(tx.id)}>
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </li>
          ) : (
            <li
              key={tx.id}
              draggable
              onDragStart={(e) => onDragStart(e, tx.id)}
              onDragEnd={onDragEnd}
              onClick={() => setSelectedId((s) => (s === tx.id ? null : tx.id))}
              className={`queue-item ${selectedId === tx.id ? 'selected' : ''} ${draggingIds?.has(tx.id) ? 'dragging' : ''}`}
            >
              <input
                type="checkbox"
                checked={selectedForMove.has(tx.id)}
                onChange={() => toggleSelectForMove(tx.id)}
                onClick={(e) => e.stopPropagation()}
              />
              <span className="chip-amt">{formatCurrency(tx.amount, '฿', 2)}</span>
              <span className="chip-desc">{tx.description || t(`txType.${tx.type}`)}</span>
              <span className="chip-meta">
                {tx.transactionDate} · {accountName(tx.accountId)}
              </span>
              <button
                type="button"
                className="pill-icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  startEditTx(tx);
                }}
              >
                <Pencil size={12} />
              </button>
            </li>
          )
        )}
        {unsorted.length === 0 && <p className="empty">{t('categorize.queueEmpty')}</p>}
        {unsorted.length > 0 && filteredUnsorted.length === 0 && <p className="empty">{t('categorize.searchNoResults')}</p>}
      </ul>
    </div>
  );
}
