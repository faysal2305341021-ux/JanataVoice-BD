import * as React from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { TRANSLATIONS } from '../lib/i18n.ts';
import type { Complaint } from '../types/domain.ts';

function formatDuration(ms: number): string {
  const abs = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(abs / 86400);
  const hours = Math.floor((abs % 86400) / 3600);
  const mins = Math.floor((abs % 3600) / 60);
  const secs = abs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) {
    return `${days}d ${pad(hours)}h ${pad(mins)}m ${pad(secs)}s`;
  }
  return `${pad(hours)}h ${pad(mins)}m ${pad(secs)}s`;
}

export function computeSlaMetrics(complaint: Complaint, nowMs: number) {
  const createdMs = new Date(complaint.createdAt).getTime();
  const dueMs = new Date(complaint.slaDueAt).getTime();
  const totalMs = Math.max(1, dueMs - createdMs);
  const remainingMs = dueMs - nowMs;
  const elapsedMs = Math.max(0, nowMs - createdMs);
  const elapsedPercent = Math.min(100, Math.max(0, Math.round((elapsedMs / totalMs) * 100)));
  const isTerminal = complaint.status === 'RESOLVED' || complaint.status === 'CLOSED';
  const isBreached = !isTerminal && remainingMs <= 0;
  const isAtRisk = !isTerminal && !isBreached && elapsedPercent >= 80;

  return {
    remainingMs,
    overdueMs: Math.max(0, -remainingMs),
    elapsedPercent,
    isTerminal,
    isBreached,
    isAtRisk,
  };
}

export function SlaCountdownTimer({
  complaint,
  nowMs,
  variant = 'detailed',
}: {
  complaint: Complaint;
  nowMs: number;
  variant?: 'compact' | 'detailed';
}) {
  const { locale } = useAuth();
  const t = TRANSLATIONS[locale];
  const m = computeSlaMetrics(complaint, nowMs);

  if (variant === 'compact') {
    if (complaint.status === 'CLOSED') {
      return (
        <span className="font-mono text-[11px] text-slate-500 tabular-nums">
          {t.slaCompletedLabel}
        </span>
      );
    }
    if (complaint.status === 'RESOLVED') {
      return (
        <span className="font-mono text-[11px] text-emerald-700 tabular-nums">
          {t.slaCompletedLabel}
        </span>
      );
    }
    if (m.isBreached) {
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-red-700 tabular-nums">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span>+{formatDuration(m.overdueMs)}</span>
        </span>
      );
    }
    return (
      <span
        className={`inline-flex items-center gap-1 font-mono text-[11px] font-medium tabular-nums ${
          m.isAtRisk ? 'text-amber-700' : 'text-emerald-700'
        }`}
      >
        <Clock className="h-3 w-3 shrink-0" />
        <span>{formatDuration(m.remainingMs)}</span>
      </span>
    );
  }

  // Detailed view for selected complaint dashboard panel
  const toneColor = m.isTerminal
    ? 'text-emerald-700'
    : m.isBreached
      ? 'text-red-700'
      : m.isAtRisk
        ? 'text-amber-700'
        : 'text-emerald-700';

  const barColor = m.isTerminal
    ? 'bg-emerald-600'
    : m.isBreached
      ? 'bg-red-600'
      : m.isAtRisk
        ? 'bg-amber-500'
        : 'bg-emerald-600';

  const firstRespDueMs = new Date(complaint.firstResponseDueAt).getTime();
  const firstRespPassed = nowMs >= firstRespDueMs;

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
          {m.isTerminal ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
          ) : m.isBreached ? (
            <AlertTriangle className="h-3.5 w-3.5 text-red-700" />
          ) : (
            <Clock className={`h-3.5 w-3.5 ${toneColor}`} />
          )}
          <span>{t.slaTimerTitle}</span>
        </div>

        <span className={`font-mono text-xs font-semibold tabular-nums ${toneColor}`}>
          {m.isTerminal
            ? t.slaCompletedLabel
            : m.isBreached
              ? `${t.slaOverdueLabel}: +${formatDuration(m.overdueMs)}`
              : `${t.slaRemainingLabel}: ${formatDuration(m.remainingMs)}`}
        </span>
      </div>

      {/* Linear SLA progress track */}
      <div className="space-y-1.5">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full transition-all duration-300 ${barColor}`}
            style={{ width: `${m.isTerminal ? 100 : m.elapsedPercent}%` }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <span className="font-mono tabular-nums">
            {m.elapsedPercent}
            {t.slaElapsedSuffix}
            {complaint.reminderSent80 && !m.isTerminal ? ` · ${t.slaWarning80Tag}` : ''}
          </span>
          <span className="font-mono tabular-nums">
            {t.slaDeadlineLabel}: {new Date(complaint.slaDueAt).toLocaleString()}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2.5 text-[11px] text-slate-600">
        <span>
          {t.slaFirstRespLabel}:{' '}
          <span className="font-mono tabular-nums text-slate-800">
            {new Date(complaint.firstResponseDueAt).toLocaleString()}
          </span>
        </span>
        <span className="font-mono text-slate-500 tabular-nums">
          {firstRespPassed && !m.isTerminal ? '1st response window elapsed' : ''}
        </span>
      </div>
    </div>
  );
}
