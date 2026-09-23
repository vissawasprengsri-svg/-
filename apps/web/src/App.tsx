import { useEffect, useState } from 'react';
import { Clock, CloudSun, Home, LayoutGrid, Moon, PieChart, PlusCircle, Settings as SettingsIcon, Sun } from 'lucide-react';
import type { Transaction, TransactionType } from '@finance/shared';
import { api, ApiError, UNAUTHENTICATED_EVENT } from './api/client';
import { Toast, type ToastState } from './components/Toast';
import { NotificationBell } from './components/NotificationBell';
import { LoginPage } from './pages/LoginPage';
import { HomeDashboard } from './pages/HomeDashboard';
import { AddTransactionPage } from './pages/AddTransactionPage';
import { CategorizePage } from './pages/CategorizePage';
import { ClaimsPage } from './pages/ClaimsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useBrowserBack } from './hooks/useBrowserBack';
import { useI18n } from './i18n/I18nContext';

type Tab = 'home' | 'add' | 'categorize' | 'claims' | 'reports';
type Theme = 'light' | 'gray' | 'dark';
const THEME_KEY = 'finance.theme';
const THEME_ICON: Record<Theme, typeof Sun> = { light: Sun, gray: CloudSun, dark: Moon };

export default function App() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('home');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addType, setAddType] = useState<TransactionType>('personal_expense');
  const [toast, setToast] = useState<ToastState | null>(null);
  const [error, setError] = useState('');
  const [refreshSignal, setRefreshSignal] = useState(0);
  // theme is a per-device preference (screen glare varies a lot between an office desk and
  // outdoors), so it's kept in localStorage rather than synced server-side.
  const [theme, setTheme] = useState<Theme>('light');
  // 'checking' until the boot probe answers, so a signed-in reload doesn't flash the
  // login screen before the cookie has been validated.
  const [auth, setAuth] = useState<'checking' | 'needs-setup' | 'signed-out' | 'signed-in'>('checking');

  async function checkSession() {
    try {
      const session = await api.getSession();
      setAuth(session.authenticated ? 'signed-in' : session.needsSetup ? 'needs-setup' : 'signed-out');
    } catch (err) {
      // A failed probe means the API is unreachable, not that the user is
      // signed out — surface it instead of silently showing a login box.
      setError(err instanceof ApiError ? err.message : String(err));
      setAuth('signed-out');
    }
  }

  useEffect(() => {
    checkSession();
  }, []);

  // Any 401 from a normal API call (cookie expired mid-session) drops straight back to login.
  useEffect(() => {
    const onUnauthenticated = () => setAuth('signed-out');
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
  }, []);

  async function logout() {
    try {
      await api.logout();
    } catch {
      // clearing local state matters more than the round-trip succeeding
    }
    setSettingsOpen(false);
    setAuth('signed-out');
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'gray' || saved === 'dark') setTheme(saved);
    } catch {
      // ignore — theme just falls back to light
    }
  }, []);

  // applied on <html> (not the .app div) so `body`'s own background — visible outside the
  // app's 560px column on wide viewports — re-themes too, instead of only content inside .app.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  function cycleTheme() {
    setTheme((prev) => {
      const next: Theme = prev === 'light' ? 'gray' : prev === 'gray' ? 'dark' : 'light';
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // ignore — theme just won't persist across reloads
      }
      return next;
    });
  }

  function bump() {
    setRefreshSignal((n) => n + 1);
  }

  useUndoRedo(
    (message) => {
      setToast({ message });
      bump();
    },
    (message) => setError(message)
  );

  // Lets the browser/Android Back gesture step out of a non-home tab or close
  // the Settings overlay instead of leaving the app. Settings is checked
  // second so, when both are open, one Back press closes Settings first and
  // a second returns to home — same order the user opened them in, since
  // Settings can only be reached from whatever tab is already showing.
  useBrowserBack(tab !== 'home', () => setTab('home'));
  useBrowserBack(settingsOpen, () => setSettingsOpen(false));

  function quickAdd(type: TransactionType) {
    setAddType(type);
    setTab('add');
  }

  function onDeleted(tx: Transaction, undo: () => Promise<void>) {
    setToast({
      message: t('dashboard.deleted', { name: tx.description || t(`txType.${tx.type}`) }),
      onUndo: undo,
    });
    bump();
  }

  const ThemeIcon = THEME_ICON[theme];

  if (auth === 'checking') {
    return <div className="app boot-wrap" />;
  }

  if (auth !== 'signed-in') {
    return <LoginPage needsSetup={auth === 'needs-setup'} onAuthenticated={() => setAuth('signed-in')} />;
  }

  return (
    <div className="app">
      <div className="header-wrap">
        <header className="app-header">
          <span className="mark">฿</span>
          <div className="header-txt">
            <p className="eyebrow">{t('app.title')}</p>
            <h1>{t(`header.${tab}`)}</h1>
          </div>
          <div className="header-actions">
            <button className="icon-toggle" onClick={cycleTheme} title={t(`theme.${theme}`)} aria-label={t(`theme.${theme}`)}>
              <ThemeIcon size={17} />
            </button>
            <NotificationBell onError={setError} />
            <button className="gear-btn" onClick={() => setSettingsOpen(true)} aria-label={t('settings.title')}>
              <SettingsIcon size={18} />
            </button>
          </div>
        </header>

        <nav className="tabs icon-tabs">
          <button className={tab === 'home' ? 'active' : ''} onClick={() => setTab('home')}>
            <Home size={19} />
            <span>{t('tabs.home')}</span>
          </button>
          <button className={tab === 'add' ? 'active' : ''} onClick={() => setTab('add')}>
            <PlusCircle size={19} />
            <span>{t('tabs.add')}</span>
          </button>
          <button className={tab === 'categorize' ? 'active' : ''} onClick={() => setTab('categorize')}>
            <LayoutGrid size={19} />
            <span>{t('tabs.categorize')}</span>
          </button>
          <button className={tab === 'claims' ? 'active' : ''} onClick={() => setTab('claims')}>
            <Clock size={19} />
            <span>{t('tabs.claims')}</span>
          </button>
          <button className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}>
            <PieChart size={19} />
            <span>{t('tabs.reports')}</span>
          </button>
        </nav>
      </div>

      <main className="main-area">
        {error && <div className="error-banner">{error}</div>}

        {tab === 'home' && (
          <HomeDashboard
            refreshSignal={refreshSignal}
            onQuickAdd={quickAdd}
            onGoCategorize={() => setTab('categorize')}
            onGoClaims={() => setTab('claims')}
            onDeleted={onDeleted}
            onError={setError}
          />
        )}

        {tab === 'add' && (
          <AddTransactionPage
            presetType={addType}
            onError={setError}
            onDone={() => {
              bump();
              setTab('home');
            }}
          />
        )}

        {tab === 'categorize' && <CategorizePage onError={setError} onChanged={bump} onDeleted={onDeleted} />}

        {tab === 'claims' && <ClaimsPage onError={setError} onChanged={bump} />}

        {tab === 'reports' && <ReportsPage onError={setError} />}
      </main>

      {settingsOpen && (
        <SettingsPage
          onClose={() => {
            setSettingsOpen(false);
            bump();
          }}
          onError={setError}
          onChanged={bump}
          onLogout={logout}
        />
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
