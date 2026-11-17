import * as React from 'react';
import { ArrowUpRight, Bell, Check, CheckCheck, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { TRANSLATIONS } from '../lib/i18n.ts';
import type { NotificationRecord } from '../types/domain.ts';
import { Button, Surface } from './ui/primitives.tsx';

export function NotificationsView({
  onOpenComplaint,
}: {
  onOpenComplaint: (complaintId: string) => void;
}) {
  const {
    user,
    locale,
    apiFetch,
    notifications,
    unreadCount,
    refreshNotifications,
    markNotificationRead,
    markAllNotificationsRead,
  } = useAuth();
  const t = TRANSLATIONS[locale];

  const [filterTab, setFilterTab] = React.useState<'unread' | 'all' | 'outbox'>('unread');
  const [outboxItems, setOutboxItems] = React.useState<NotificationRecord[]>([]);
  const [loadingOutbox, setLoadingOutbox] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);

  const isAdmin = user?.role === 'admin';

  const loadOutbox = React.useCallback(async () => {
    if (!isAdmin) return;
    setLoadingOutbox(true);
    try {
      const res = await apiFetch('/api/notifications?all=true');
      const data = await res.json();
      if (res.ok && Array.isArray(data.notifications)) {
        setOutboxItems(data.notifications);
      }
    } finally {
      setLoadingOutbox(false);
    }
  }, [apiFetch, isAdmin]);

  React.useEffect(() => {
    if (filterTab === 'outbox' && isAdmin) {
      loadOutbox();
    }
  }, [filterTab, isAdmin, loadOutbox]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshNotifications();
      if (filterTab === 'outbox' && isAdmin) {
        await loadOutbox();
      }
    } finally {
      setRefreshing(false);
    }
  };

  const visibleItems =
    filterTab === 'outbox'
      ? outboxItems
      : filterTab === 'unread'
        ? notifications.filter((n) => !n.isRead)
        : notifications;

  return (
    <div className="space-y-6">
      {/* Segmented Filter & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-md border border-emerald-100 bg-emerald-50/70 p-1">
          <button
            type="button"
            onClick={() => setFilterTab('unread')}
            className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              filterTab === 'unread'
                ? 'bg-white text-emerald-950 shadow-sm'
                : 'text-emerald-900/70 hover:text-emerald-950'
            }`}
          >
            {t.tabUnread} ({unreadCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('all')}
            className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              filterTab === 'all'
                ? 'bg-white text-emerald-950 shadow-sm'
                : 'text-emerald-900/70 hover:text-emerald-950'
            }`}
          >
            {t.tabAllNotifs} ({notifications.length})
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setFilterTab('outbox')}
              className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                filterTab === 'outbox'
                  ? 'bg-white text-emerald-950 shadow-sm'
                  : 'text-emerald-900/70 hover:text-emerald-950'
              }`}
            >
              {t.tabOutbox}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && filterTab !== 'outbox' && (
            <Button type="button" variant="outline" size="sm" onClick={markAllNotificationsRead}>
              <CheckCheck className="h-3.5 w-3.5" />
              <span>{t.markAllReadBtn}</span>
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{t.refreshStatusBtn}</span>
          </Button>
        </div>
      </div>

      {/* Notifications List */}
      <Surface className="overflow-hidden">
        <div className="border-b border-emerald-200/80 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-[#006a4e]" />
            <h2 className="font-display text-sm font-semibold text-emerald-950">
              {filterTab === 'outbox' ? t.tabOutbox : t.notificationsTitle}
            </h2>
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {visibleItems.length} {t.recordsSuffix}
          </span>
        </div>

        {filterTab === 'outbox' && loadingOutbox ? (
          <div className="p-8 text-center text-xs text-slate-500">{t.loadingComplaints}</div>
        ) : visibleItems.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">{t.noNotificationsMsg}</div>
        ) : (
          <div className="divide-y divide-emerald-100">
            {visibleItems.map((n) => (
              <div
                key={n.id}
                className={`px-6 py-4 flex flex-wrap items-center justify-between gap-4 transition-colors ${
                  !n.isRead ? 'bg-emerald-50/40' : 'bg-white'
                }`}
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`font-semibold ${
                        !n.isRead ? 'text-[#006a4e]' : 'text-slate-500'
                      }`}
                    >
                      {!n.isRead ? t.unreadLabel : t.readLabel}
                    </span>
                    <span className="text-emerald-300">·</span>
                    <span className="font-mono font-semibold text-emerald-950 tabular-nums">
                      {n.trackingId || n.complaintId}
                    </span>
                    <span className="text-emerald-300">·</span>
                    <span className="font-mono text-slate-500">{n.channel}</span>
                    {n.recipientAddress && (
                      <>
                        <span className="text-emerald-300">·</span>
                        <span className="font-mono text-slate-500 truncate">
                          {n.recipientAddress}
                        </span>
                      </>
                    )}
                    <span className="text-emerald-300">·</span>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      {new Date(n.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-emerald-950 leading-relaxed">{n.message}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!n.isRead && filterTab !== 'outbox' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => markNotificationRead(n.id)}
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>{t.markReadBtn}</span>
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!n.isRead) markNotificationRead(n.id);
                      onOpenComplaint(n.complaintId);
                    }}
                  >
                    <span>{t.viewInDashboardBtn}</span>
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Surface>
    </div>
  );
}
