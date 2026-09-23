import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useI18n } from '../../i18n/I18nContext';
import { useCategories } from '../../hooks/useCategories';
import { ReorderableList } from '../../components/ReorderableList';

export function CategoriesSection({ onError }: { onError: (message: string) => void }) {
  const { t } = useI18n();
  const { categories, refresh } = useCategories('personal_expense', onError);
  const [newName, setNewName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function add() {
    const name = newName.trim();
    if (!name) return;
    try {
      await api.createCategory({ name, appliesTo: ['personal_expense'] });
      setNewName('');
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function rename(id: string, name: string) {
    if (!name.trim()) return;
    try {
      await api.renameCategory(id, name.trim());
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function updateStatusLabel(id: string, statusLabel: string) {
    try {
      await api.updateCategoryStatusLabel(id, statusLabel.trim() || null);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function remove(id: string) {
    setConfirmDeleteId(null);
    try {
      await api.deleteCategory(id);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function reorder(orderedIds: string[]) {
    try {
      await api.reorderCategories(orderedIds);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  return (
    <section className="form-card">
      <h2>{t('settings.sections.categories')}</h2>
      <p className="hint">{t('settings.claimableHint')}</p>
      <div className="add-inline-row">
        <input
          type="text"
          placeholder={t('settings.addCategoryNamePlaceholder')}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button type="button" onClick={add}>
          {t('settings.add')}
        </button>
      </div>
      {categories.length === 0 && <p className="empty-sm">—</p>}
      <ReorderableList
        items={categories}
        className="list"
        itemClassName="category-row"
        onReorder={reorder}
        renderItem={(c, dragHandle) => (
          <>
            {dragHandle}
            <input
              className="rename-input"
              defaultValue={c.name}
              onBlur={(e) => e.target.value.trim() !== c.name && rename(c.id, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <input
              className="status-label-input"
              placeholder={t('categorize.statusLabelPlaceholder')}
              defaultValue={c.statusLabel ?? ''}
              onBlur={(e) => e.target.value.trim() !== (c.statusLabel ?? '') && updateStatusLabel(c.id, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <button className="icon-btn" onClick={() => setConfirmDeleteId(c.id)}>
              <Trash2 size={14} />
            </button>
          </>
        )}
      />

      <ConfirmModal
        isOpen={confirmDeleteId !== null}
        message={t('confirm.categoryMessage')}
        onConfirm={() => confirmDeleteId && remove(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </section>
  );
}
