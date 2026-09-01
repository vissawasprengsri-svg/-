import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import { useCategories } from '../../hooks/useCategories';

export function CategoriesSection({ onError }: { onError: (message: string) => void }) {
  const { t } = useI18n();
  const { categories, refresh } = useCategories('personal_expense', onError);
  const [newName, setNewName] = useState('');

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

  async function toggleClaimable(id: string, isClaimable: boolean) {
    try {
      await api.updateCategoryClaimSettings(id, { isClaimable, defaultClaimStatus: isClaimable ? 'pending' : null });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteCategory(id);
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
      <ul className="list">
        {categories.map((c) => (
          <li key={c.id} className="category-row">
            <input
              className="rename-input"
              defaultValue={c.name}
              onBlur={(e) => e.target.value.trim() !== c.name && rename(c.id, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <label className="checkbox-row claimable-toggle">
              <input type="checkbox" checked={c.isClaimable} onChange={(e) => toggleClaimable(c.id, e.target.checked)} />
              <span>{t('settings.claimable')}</span>
            </label>
            <button className="icon-btn" onClick={() => remove(c.id)}>
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
