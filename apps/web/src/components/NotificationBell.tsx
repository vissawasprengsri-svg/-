import { useEffect, useRef, useState } from 'react';
import type { NotificationItem } from '@finance/shared';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nContext';

const SEVERITY_ICON: Record<NotificationItem['severity'], string> = {
  info: 'ℹ️',
  warning: '⚠️',
  critical: '🔴',
};

export function NotificationBell({ onError }: { onError: (message: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    try {
      const [list, count] = await Promise.all([api.listNotifications(), api.unreadCount()]);
      setItems(list.notifications);
      setUnread(count.count);
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  async function handleRead(item: NotificationItem) {
    if (!item.readAt) {
      await api.markNotificationRead(item.id);
      await refresh();
    }
  }

  async function handleDismiss(item: NotificationItem) {
    await api.dismissNotification(item.id);
    await refresh();
  }

  return (
    <div className="bell-wrap" ref={boxRef}>
      <button className="bell" onClick={() => setOpen((v) => !v)} aria-label={t('notifications.title')}>
        🔔
        {unread > 0 && <em className="bell-badge">{unread}</em>}
      </button>
      {open && (
        <div className="bell-dropdown">
          <div className="bell-dropdown-head">
            <span>{t('notifications.title')}</span>
            {unread > 0 && (
              <button
                className="linklike"
                onClick={async () => {
                  await api.markAllNotificationsRead();
                  await refresh();
                }}
              >
                {t('notifications.readAll')}
              </button>
            )}
          </div>
          {items.length === 0 && <p className="empty-sm">{t('notifications.empty')}</p>}
          <ul className="bell-list">
            {items.map((n) => (
              <li key={n.id} className={n.readAt ? 'read' : 'unread'} onClick={() => handleRead(n)}>
                <span className="bell-icon">{SEVERITY_ICON[n.severity]}</span>
                <div className="bell-item-body">
                  <span className="bell-title">{n.title}</span>
                  <span className="bell-text">{n.body}</span>
                </div>
                <button
                  className="bell-dismiss"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDismiss(n);
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
