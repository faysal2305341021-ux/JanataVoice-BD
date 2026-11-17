import * as React from 'react';
import { Clock, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { STATUS_LABELS, TRANSLATIONS } from '../lib/i18n.ts';
import type {
  Complaint,
  ComplaintCategory,
  ComplaintEvent,
  Department,
} from '../types/domain.ts';
import { ComplaintProgressStepper } from './ComplaintProgressStepper.tsx';
import { computeSlaMetrics, SlaCountdownTimer } from './SlaCountdownTimer.tsx';
import { Button, Input, Surface } from './ui/primitives.tsx';

type StatusFilter = 'ALL' | 'ACTIVE' | 'ESCALATED' | 'RESOLVED';

function getProgressPercent(status: Complaint['status']): number {
  switch (status) {
    case 'SUBMITTED':
      return 20;
    case 'TRIAGING':
    case 'ASSIGNED':
      return 40;
    case 'IN_PROGRESS':
    case 'ESCALATED':
    case 'REOPENED':
      return 65;
    case 'RESOLVED':
      return 85;
    case 'CLOSED':
      return 100;
    default:
      return 20;
  }
}

export function MyComplaintsView({
  categories,
  departments = [],
}: {
  categories: ComplaintCategory[];
  departments?: Department[];
}) {
  const { apiFetch, locale } = useAuth();
  const t = TRANSLATIONS[locale];

  const [complaints, setComplaints] = React.useState<Complaint[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [lastSyncedAt, setLastSyncedAt] = React.useState<Date | null>(null);
  const [nowMs, setNowMs] = React.useState<number>(() => Date.now());
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('ALL');

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [timeline, setTimeline] = React.useState<{
    complaint: Complaint;
    events: ComplaintEvent[];
  } | null>(null);
  const [lookupInput, setLookupInput] = React.useState('');
  const [lookupError, setLookupError] = React.useState<string | null>(null);

  // Live 1-second tick for SLA countdown timers
  React.useEffect(() => {
    const tick = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const loadMyComplaints = React.useCallback(
    async (silent = false) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      try {
        const res = await apiFetch('/api/complaints/my');
        const data = await res.json();
        if (Array.isArray(data.complaints)) {
          setComplaints(data.complaints);
          setLastSyncedAt(new Date());
          setSelectedId((prev) => prev || data.complaints[0]?.id || null);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [apiFetch]
  );

  const loadTimeline = React.useCallback(
    async (idOrTracking: string) => {
      setLookupError(null);
      try {
        const res = await apiFetch(`/api/complaints/${encodeURIComponent(idOrTracking)}/timeline`);
        const data = await res.json();
        if (!res.ok) {
          setLookupError(data.error || 'Not found.');
          return;
        }
        setTimeline({ complaint: data.complaint, events: data.events });
        setSelectedId(data.complaint.id);
      } catch {
        setLookupError('Failed to load complaint timeline.');
      }
    },
    [apiFetch]
  );

  // Initial load + real-time 15-second status polling
  React.useEffect(() => {
    loadMyComplaints(false);
    const poll = setInterval(() => {
      loadMyComplaints(true);
    }, 15000);
    return () => clearInterval(poll);
  }, [loadMyComplaints]);

  React.useEffect(() => {
    if (selectedId) {
      loadTimeline(selectedId);
    }
  }, [selectedId, loadTimeline]);

  const getLocalizedCategory = (code?: string) => {
    if (!code) return t.pendingTriageLabel;
    const cat = categories.find((c) => c.code === code);
    if (!cat) return code;
    return locale === 'bn' ? cat.nameBn : cat.nameEn;
  };

  const getLocalizedDept = (deptId?: string) => {
    if (!deptId) return t.pendingTriageLabel;
    const dept = departments.find((d) => d.id === deptId);
    if (!dept) return deptId.replace('dept_', '').toUpperCase();
    return locale === 'bn' ? dept.nameBn : dept.name;
  };

  // Summary metrics
  const totalCount = complaints.length;
  const activeCount = complaints.filter(
    (c) => c.status !== 'RESOLVED' && c.status !== 'CLOSED'
  ).length;
  const escalatedOrRiskCount = complaints.filter((c) => {
    if (c.status === 'ESCALATED' || c.status === 'REOPENED') return true;
    const m = computeSlaMetrics(c, nowMs);
    return m.isBreached || m.isAtRisk;
  }).length;
  const resolvedCount = complaints.filter(
    (c) => c.status === 'RESOLVED' || c.status === 'CLOSED'
  ).length;

  const filteredComplaints = complaints.filter((c) => {
    if (statusFilter === 'ALL') return true;
    if (statusFilter === 'ACTIVE') {
      return c.status !== 'RESOLVED' && c.status !== 'CLOSED';
    }
    if (statusFilter === 'ESCALATED') {
      const m = computeSlaMetrics(c, nowMs);
      return c.status === 'ESCALATED' || c.status === 'REOPENED' || m.isBreached || m.isAtRisk;
    }
    if (statusFilter === 'RESOLVED') {
      return c.status === 'RESOLVED' || c.status === 'CLOSED';
    }
    return true;
  });

  const handleManualRefresh = async () => {
    await loadMyComplaints(true);
    if (selectedId) {
      await loadTimeline(selectedId);
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Surface className="p-4">
          <div className="text-xs text-slate-500">{t.kpiTotalFiled}</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {totalCount}
          </div>
        </Surface>
        <Surface className="p-4">
          <div className="text-xs text-slate-500">{t.kpiActiveTrack}</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
            {activeCount}
          </div>
        </Surface>
        <Surface className="p-4">
          <div className="text-xs text-slate-500">{t.kpiEscalatedRisk}</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-amber-700 tabular-nums">
            {escalatedOrRiskCount}
          </div>
        </Surface>
        <Surface className="p-4">
          <div className="text-xs text-slate-500">{t.kpiResolvedClosed}</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {resolvedCount}
          </div>
        </Surface>
      </div>

      {/* Interactive Status Filter & Real-Time Sync Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1">
          {(
            [
              { id: 'ALL', label: `${t.filterAll} (${totalCount})` },
              { id: 'ACTIVE', label: `${t.filterActive} (${activeCount})` },
              { id: 'ESCALATED', label: `${t.filterEscalated} (${escalatedOrRiskCount})` },
              { id: 'RESOLVED', label: `${t.filterResolved} (${resolvedCount})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                statusFilter === tab.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {lastSyncedAt && (
            <span className="font-mono text-[11px] text-slate-500 tabular-nums">
              {t.lastSyncedLabel}: {lastSyncedAt.toLocaleTimeString()}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{t.refreshStatusBtn}</span>
          </Button>
        </div>
      </div>

      {/* Master-Detail Dashboard Split */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-start">
        {/* Left Column: Tracking Search + Complaint List with Live Compact Countdowns */}
        <div className="lg:col-span-5 space-y-4">
          <Surface className="p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (lookupInput.trim()) loadTimeline(lookupInput.trim());
              }}
              className="flex gap-2"
            >
              <Input
                value={lookupInput}
                onChange={(e) => setLookupInput(e.target.value)}
                placeholder={t.trackPlaceholder}
                className="font-mono text-xs"
              />
              <Button type="submit" variant="outline" size="sm">
                <Search className="h-3.5 w-3.5" />
                <span>{t.trackBtn}</span>
              </Button>
            </form>
            {lookupError && <p className="mt-2 text-xs text-red-600">{lookupError}</p>}
          </Surface>

          <Surface className="overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-3.5 flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                {t.myFiledHeading}
              </h2>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {filteredComplaints.length} {t.recordsSuffix}
              </span>
            </div>

            {loading ? (
              <div className="p-6 text-xs text-slate-500">{t.loadingComplaints}</div>
            ) : filteredComplaints.length === 0 ? (
              <div className="p-6 text-xs text-slate-500">{t.noComplaintsYet}</div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[640px] overflow-y-auto">
                {filteredComplaints.map((c) => {
                  const pct = getProgressPercent(c.status);
                  const isSelected = selectedId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={`w-full text-left px-5 py-4 transition-colors cursor-pointer ${
                        isSelected ? 'bg-slate-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          {c.trackingId}
                        </span>
                        <span
                          className={`font-medium ${
                            c.status === 'TRIAGING' || c.status === 'REOPENED'
                              ? 'text-amber-700'
                              : c.status === 'ESCALATED'
                                ? 'text-red-700'
                                : c.status === 'CLOSED'
                                  ? 'text-slate-600'
                                  : 'text-emerald-700'
                          }`}
                        >
                          {STATUS_LABELS[c.status][locale]}
                        </span>
                      </div>

                      <p className="mt-1.5 text-xs text-slate-700 line-clamp-2">{c.rawText}</p>

                      {/* Mini lifecycle progress bar */}
                      <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-slate-200">
                        <div
                          className={`h-full transition-all duration-300 ${
                            c.status === 'ESCALATED'
                              ? 'bg-red-600'
                              : c.status === 'TRIAGING' || c.status === 'REOPENED'
                                ? 'bg-amber-500'
                                : 'bg-emerald-600'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="truncate">{getLocalizedCategory(c.categoryCode)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">L{c.currentLevel}</span>
                        </div>
                        <SlaCountdownTimer complaint={c} nowMs={nowMs} variant="compact" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Surface>
        </div>

        {/* Right Column: Live Progress Stepper, Detailed SLA Countdown & Vertical Audit Timeline */}
        <div className="lg:col-span-7">
          <Surface className="p-6">
            {timeline ? (
              <div className="space-y-6">
                {/* Complaint Summary Header */}
                <div className="border-b border-slate-100 pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-base font-bold text-slate-900 tabular-nums">
                      {timeline.complaint.trackingId}
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        timeline.complaint.status === 'ESCALATED'
                          ? 'text-red-700'
                          : timeline.complaint.status === 'TRIAGING' ||
                              timeline.complaint.status === 'REOPENED'
                            ? 'text-amber-700'
                            : 'text-emerald-700'
                      }`}
                    >
                      {STATUS_LABELS[timeline.complaint.status][locale]}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-800">
                    {timeline.complaint.rawText}
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{getLocalizedDept(timeline.complaint.departmentId)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{getLocalizedCategory(timeline.complaint.categoryCode)}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {timeline.complaint.district}, {timeline.complaint.division}
                    </span>
                  </div>
                </div>

                {/* Live SLA Countdown Timer Panel */}
                <SlaCountdownTimer
                  complaint={timeline.complaint}
                  nowMs={nowMs}
                  variant="detailed"
                />

                {/* Visual Lifecycle Progress Stepper */}
                <div className="border-t border-slate-100 pt-5">
                  <ComplaintProgressStepper
                    complaint={timeline.complaint}
                    events={timeline.events}
                  />
                </div>

                {/* Vertical Audit Event Timeline */}
                <div className="border-t border-slate-100 pt-5">
                  <h3 className="font-display text-xs font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    <span>{t.timelineHeading}</span>
                  </h3>
                  <div className="divide-y divide-slate-100">
                    {timeline.events.map((ev) => (
                      <div key={ev.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-mono font-semibold text-slate-900">
                            {ev.eventType}
                          </span>
                          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                            {new Date(ev.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                          <span>
                            {ev.actorName || ev.actorId}
                            {ev.toStatus
                              ? ` → ${STATUS_LABELS[ev.toStatus]?.[locale] || ev.toStatus}`
                              : ''}
                          </span>
                          <span
                            className="font-mono text-[10px] text-slate-400 tabular-nums"
                            title={ev.hash}
                          >
                            SHA-256 · {ev.hash.slice(0, 8)}…{ev.hash.slice(-6)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500">{t.selectComplaintPrompt}</div>
            )}
          </Surface>
        </div>
      </div>
    </div>
  );
}
