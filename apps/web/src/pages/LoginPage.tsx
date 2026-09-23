import { useState } from 'react';
import { KeyRound, LogIn } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nContext';

/**
 * Gate shown while signed out. Doubles as first-run setup: on a fresh install
 * the seeded account has no password yet, so the same screen asks the owner to
 * choose one instead of asking for a password that doesn't exist.
 */
export function LoginPage({ needsSetup, onAuthenticated }: { needsSetup: boolean; onAuthenticated: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    if (needsSetup) {
      if (password.length < 8) {
        setError(t('auth.passwordTooShort'));
        return;
      }
      if (password !== confirmPassword) {
        setError(t('auth.passwordMismatch'));
        return;
      }
    } else if (!password) {
      return;
    }

    setBusy(true);
    try {
      if (needsSetup) await api.setupPassword(password);
      else await api.login(password);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setPassword('');
      setConfirmPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <span className="mark">฿</span>
        <p className="eyebrow">{t('app.title')}</p>
        <h1>{needsSetup ? t('auth.setupTitle') : t('auth.loginTitle')}</h1>
        <p className="hint">{needsSetup ? t('auth.setupHint') : t('auth.loginHint')}</p>

        <label className="field">
          <span>{t('auth.password')}</span>
          <input
            autoFocus
            type="password"
            autoComplete={needsSetup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>

        {needsSetup && (
          <label className="field">
            <span>{t('auth.confirmPassword')}</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </label>
        )}

        {error && <p className="login-error">{error}</p>}

        <button className="submit" onClick={submit} disabled={busy}>
          {needsSetup ? <KeyRound size={16} /> : <LogIn size={16} />}
          {busy ? t('auth.working') : needsSetup ? t('auth.setupButton') : t('auth.loginButton')}
        </button>

        {needsSetup && <p className="hint">{t('auth.setupWarning')}</p>}
      </div>
    </div>
  );
}
