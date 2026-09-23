import { useEffect, useRef } from 'react';

/**
 * Coordinates every `useBrowserBack` call site through one shared stack and
 * one `popstate` listener, so a single Back press closes only the topmost
 * open layer (e.g. Settings opened on top of the Categorize tab) instead of
 * every listening layer reacting to the same event at once — which is what
 * happens if each call site just attaches its own independent listener.
 */
interface StackEntry {
  onClose: () => void;
}
const stack: StackEntry[] = [];
let listenerAttached = false;

function ensureGlobalListener(): void {
  if (listenerAttached) return;
  listenerAttached = true;
  window.addEventListener('popstate', () => {
    const top = stack.pop();
    top?.onClose();
  });
}

/**
 * Makes the browser/Android Back gesture close an in-app overlay or non-home
 * view instead of leaving the app outright. Call with `isOpen` reflecting
 * whether that view is currently showing, and `onClose` to run when the user
 * presses Back — the caller still owns the actual state change (e.g.
 * `setSettingsOpen(false)`), this hook only decides *when* to call it.
 *
 * A synthetic history entry is pushed for as long as `isOpen` is true. If the
 * view closes some other way (an in-app close/back button, not the browser's
 * Back), that entry is popped with `history.back()` so the browser's history
 * stack never accumulates entries the user didn't ask for — otherwise Back
 * would need pressing multiple times to actually leave the app.
 */
export function useBrowserBack(isOpen: boolean, onClose: () => void): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const entryRef = useRef<StackEntry | null>(null);

  useEffect(() => {
    ensureGlobalListener();
  }, []);

  useEffect(() => {
    if (isOpen && !entryRef.current) {
      window.history.pushState(null, '', window.location.href);
      const entry: StackEntry = { onClose: () => closeRef.current() };
      entryRef.current = entry;
      stack.push(entry);
      return;
    }
    if (!isOpen && entryRef.current) {
      const entry = entryRef.current;
      entryRef.current = null;
      const idx = stack.lastIndexOf(entry);
      if (idx === -1) return; // already popped by a Back press
      const wasTop = idx === stack.length - 1;
      stack.splice(idx, 1);
      // Only consume a step of browser history if we were still on top. If
      // something else got stacked above us and closed first, our entry is
      // just removed from bookkeeping — the leftover browser entry is
      // harmless and gets cleaned up passively the next time Back is pressed.
      if (wasTop) window.history.back();
    }
  }, [isOpen]);
}
