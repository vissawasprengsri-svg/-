import { useEffect } from 'react';
import { useI18n } from '../i18n/I18nContext';

export interface ToastState {
  message: string;
  onUndo?: () => void;
}

const AUTO_DISMISS_MS = 7000;

export function Toast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return (
    <div className="toast" role="status">
      <span>{toast.message}</span>
      {toast.onUndo && (
        <button
          type="button"
          onClick={() => {
            toast.onUndo?.();
            onDismiss();
          }}
        >
          {t('toast.undo')}
        </button>
      )}
    </div>
  );
}
