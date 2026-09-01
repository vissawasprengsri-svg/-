import { useState } from 'react';
import { Clock, Home, LayoutGrid, PieChart, PlusCircle, Settings as SettingsIcon } from 'lucide-react';
import type { Transaction, TransactionType } from '@finance/shared';
import { Toast, type ToastState } from './components/Toast';
import { NotificationBell } from './components/NotificationBell';
import { HomeDashboard } from './pages/HomeDashboard';
import { AddTransactionPage } from './pages/AddTransactionPage';
import { CategorizePage } from './pages/CategorizePage';
import { ClaimsPage } from './pages/ClaimsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useI18n } from './i18n/I18nContext';

type Tab = 'home' | 'add' | 'categorize' | 'claims' | 'reports';

export default function App() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('home');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addType, setAddType] = useState<TransactionType>('personal_expense');
  const [toast, setToast] = useState<ToastState | null>(null);
  const [error, setError] = useState('');
  const [refreshSignal, setRefreshSignal] = useState(0);

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

  return (
    <div className="app">
      <header className="app-header">
        <span className="mark">฿</span>
        <div className="header-txt">
          <h1>{t('app.title')}</h1>
          <p className="subtitle">{t('app.subtitle')}</p>
        </div>
        <NotificationBell onError={setError} />
        <button className="gear-btn" onClick={() => setSettingsOpen(true)} aria-label={t('settings.title')}>
          <SettingsIcon size={18} />
        </button>
      </header>

      <nav className="tabs icon-tabs">
        <button className={tab === 'home' ? 'active' : ''} onClick={() => setTab('home')}>
          <Home size={17} />
          <span>{t('tabs.home')}</span>
        </button>
        <button className={tab === 'add' ? 'active' : ''} onClick={() => setTab('add')}>
          <PlusCircle size={17} />
          <span>{t('tabs.add')}</span>
        </button>
        <button className={tab === 'categorize' ? 'active' : ''} onClick={() => setTab('categorize')}>
          <LayoutGrid size={17} />
          <span>{t('tabs.categorize')}</span>
        </button>
        <button className={tab === 'claims' ? 'active' : ''} onClick={() => setTab('claims')}>
          <Clock size={17} />
          <span>{t('tabs.claims')}</span>
        </button>
        <button className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}>
          <PieChart size={17} />
          <span>{t('tabs.reports')}</span>
        </button>
      </nav>

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

        {tab === 'categorize' && <CategorizePage onError={setError} onChanged={bump} />}

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
        />
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
