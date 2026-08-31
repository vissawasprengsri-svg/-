import { useEffect } from 'react';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nContext';

/** Wires Ctrl+Z / Cmd+Z (undo) and Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y (redo) to the server-side command stack. */
export function useUndoRedo(onApplied: (message: string) => void, onError: (message: string) => void): void {
  const { t } = useI18n();
  useEffect(() => {
    async function handler(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || (e.key.toLowerCase() !== 'z' && e.key.toLowerCase() !== 'y')) return;
      const isRedo = (e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y';
      e.preventDefault();
      try {
        const result = isRedo ? await api.redo() : await api.undo();
        const label = t(`undoRedo.${result.commandType}`);
        onApplied(t(isRedo ? 'undoRedo.redo' : 'undoRedo.undo', { label }));
      } catch (err) {
        if (err instanceof ApiError) onError(err.message);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onApplied, onError, t]);
}
