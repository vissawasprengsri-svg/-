import { useEffect } from 'react';
import { useI18n } from '../i18n/I18nContext';

/**
 * Shared "are you sure?" gate for destructive actions. Everything except
 * `onConfirm`/`onCancel` has a sensible default, so the common case — a plain
 * delete — is `<ConfirmModal isOpen={...} onConfirm={...} onCancel={...} />`
 * and still gets translated title/message/buttons.
 */
export function ConfirmModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText,
  cancelText,
  confirmVariant = 'danger',
}: {
  isOpen: boolean;
  title?: string;
  message?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  /** 'danger' (default) reads as destructive — filled red, for deletes. 'primary' is
   * for confirmations that aren't destructive (e.g. moving items), filled blue instead. */
  confirmVariant?: 'danger' | 'primary';
}) {
  const { t } = useI18n();

  // Esc cancels, matching every other dismissable surface in the app.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card confirm-card" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <h3>{title ?? t('confirm.title')}</h3>
        <p className="confirm-message">{message ?? t('confirm.message')}</p>
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onCancel}>
            {cancelText ?? t('confirm.cancel')}
          </button>
          <button
            type="button"
            className={confirmVariant === 'primary' ? 'primary-btn' : 'danger-btn confirm-delete-btn'}
            autoFocus
            onClick={onConfirm}
          >
            {confirmText ?? t('confirm.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
