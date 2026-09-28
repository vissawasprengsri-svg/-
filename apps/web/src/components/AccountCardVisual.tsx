import { CreditCard, Wallet } from 'lucide-react';
import type { AccountNetwork, AccountWithCard } from '@finance/shared';
import { formatCurrency } from '@finance/shared';
import { useI18n } from '../i18n/I18nContext';
import { accountGradient } from '../utils/accountColor';

function NetworkBadge({ network }: { network: AccountNetwork }) {
  if (network === 'mastercard') {
    return (
      <span className="card-visual-network card-visual-network-mastercard" aria-label="Mastercard">
        <span />
        <span />
      </span>
    );
  }
  if (network === 'visa') {
    return <span className="card-visual-network card-visual-network-text">VISA</span>;
  }
  const label: Record<Exclude<AccountNetwork, 'visa' | 'mastercard'>, string> = {
    jcb: 'JCB',
    amex: 'AMEX',
    unionpay: 'UnionPay',
    truemoney: 'TrueMoney',
    other: '',
  };
  return label[network] ? <span className="card-visual-network card-visual-network-text">{label[network]}</span> : null;
}

/**
 * The dashboard's gradient card visual for one account — cosmetic only.
 * `last4`/`network` are deliberately just display fields (see Account.last4
 * in shared/types.ts), never the real card number, so there's nothing here
 * an XSS payload or a screenshot could turn into an actual usable number.
 */
export function AccountCardVisual({ account }: { account: AccountWithCard }) {
  const { t } = useI18n();
  const [from, to] = accountGradient(account);
  const isCredit = account.kind === 'credit_card';
  // Credit cards store usage as a negative balance; everything else is a
  // plain running balance — same convention AccountsSection.tsx already uses.
  const displayAmount = isCredit && account.currentBalance.startsWith('-') ? account.currentBalance.slice(1) : account.currentBalance;
  const amountLabel = isCredit ? t('home.cardUsed') : t('home.cardBalance');

  return (
    <div className="card-visual" style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
      <div className="card-visual-top">
        <div>
          <div className="card-visual-name">{account.name}</div>
          <div className="card-visual-kind">{t(`accountKind.${account.kind}`)}</div>
        </div>
        {account.network ? <NetworkBadge network={account.network} /> : isCredit ? <CreditCard size={22} /> : <Wallet size={22} />}
      </div>
      {account.last4 && <div className="card-visual-number">•••• •••• •••• {account.last4}</div>}
      <div className="card-visual-bottom">
        <span className="card-visual-label">{amountLabel}</span>
        <span className="card-visual-amount">{formatCurrency(displayAmount, '฿', 2)}</span>
      </div>
    </div>
  );
}
