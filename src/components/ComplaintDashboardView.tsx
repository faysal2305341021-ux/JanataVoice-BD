import * as React from 'react';
import {
  CheckCircle2,
  Clock,
  RefreshCw,
  RotateCcw,
  Search,
  UserCheck,
  Wrench,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../context/AuthContext.tsx';
import { STATUS_LABELS, TRANSLATIONS } from '../lib/i18n.ts';
import {
  ROLE_LABELS,
  type Complaint,
  type ComplaintCategory,
  type ComplaintEvent,
  type ComplaintStatus,
  type DashboardSummary,
  type Department,
  type UserRole,
} from '../types/domain.ts';
import { ComplaintProgressStepper } from './ComplaintProgressStepper.tsx';
import { computeSlaMetrics, SlaCountdownTimer } from './SlaCountdownTimer.tsx';
import { Button, Input, Select, Surface } from './ui/primitives.tsx';

type DashboardFilter = 'ALL' | 'MINE' | 'RISK' | 'RESOLVED';

interface StaffOption {
  id: string;
  name: string;
  role: UserRole;
  departmentId: string | null;
  district: string;
}

function getProgressPercent(status: ComplaintStatus): number {
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

function getStatusBarColor(status: ComplaintStatus): string {
  switch (status) {
    case 'ESCALATED':
      return '#dc2626';
    case 'TRIAGING':
    case 'REOPENED':
      return '#d97706';
    case 'RESOLVED':
    case 'CLOSED':
      return '#047857';
    default:
      return '#006a4e';
  }
}

export function ComplaintDashboardView({
  categories,
  departments,
  focusedComplaintId,
  onClearFocusedComplaint,
}: {
  categories: ComplaintCategory[];
  departments: Department[];
  focusedComplaintId?: string | null;
  onClearFocusedComplaint?: () => void;
}) {
  const { user, locale, apiFetch, complaintUpdateVersion, refreshNotifications } = useAuth();
  const t = TRANSLATIONS[locale];

  const [complaints, setComplaints] = React.useState<Complaint[]>([]);
  const [summary, setSummary] = React.useState<DashboardSummary | null>(null);
  const [assignableStaff, setAssignableStaff] = React.useState<StaffOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [lastSyncedAt, setLastSyncedAt] = React.useState<Date | null>(null);
  const [nowMs, setNowMs] = React.useState<number>(() => Date.now());

  const [filterMode, setFilterMode] = React.useState<DashboardFilter>('ALL');
  const [deptFilter, setDeptFilter] = React.useState<string>('ALL');
  const [searchQuery, setSearchQuery] = React.useState('');

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [timeline, setTimeline] = React.useState<{
    complaint: Complaint;
    events: ComplaintEvent[];
  } | null>(null);
  const [lookupError, setLookupError] = React.useState<string | null>(null);

  // Action states
  const [assigneeSelection, setAssigneeSelection] = React.useState<string>('');
  const [actionNotes, setActionNotes] = React.useState<string>('');
  const [actionBusy, setActionBusy] = React.useState(false);
  const [actionMessage, setActionMessage] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // Live 1-second tick for SLA countdowns
  React.useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const loadDashboard = React.useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await apiFetch('/api/complaints/dashboard');
        const data = await res.json();
        if (res.ok && Array.isArray(data.complaints)) {
          setComplaints(data.complaints);
          setSummary(data.summary || null);
          setAssignableStaff(data.assignableStaff || []);
          setLastSyncedAt(new Date());
          setSelectedId((prev) => focusedComplaintId || prev || data.complaints[0]?.id || null);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [apiFetch, focusedComplaintId]
  );

  const loadTimeline = React.useCallback(
    async (idOrTracking: string) => {
      setLookupError(null);
      try {
        const res = await apiFetch(`/api/complaints/${encodeURIComponent(idOrTracking)}/timeline`);
        const data = await res.json();
        if (!res.ok) {
          setLookupError(data.error || 'Complaint not found.');
          return;
        }
        setTimeline({ complaint: data.complaint, events: data.events || [] });
        setSelectedId(data.complaint.id);
      } catch {
        setLookupError('Failed to load complaint details.');
      }
    },
    [apiFetch]
  );

  React.useEffect(() => {
    loadDashboard(false);
  }, [loadDashboard, complaintUpdateVersion]);

  React.useEffect(() => {
    if (focusedComplaintId) {
      setSelectedId(focusedComplaintId);
      setFilterMode('ALL');
      setDeptFilter('ALL');
      setSearchQuery('');
      loadTimeline(focusedComplaintId);
      onClearFocusedComplaint?.();
    }
  }, [focusedComplaintId, loadTimeline, onClearFocusedComplaint]);

  React.useEffect(() => {
    if (selectedId) {
      loadTimeline(selectedId);
    }
  }, [selectedId, loadTimeline]);

  React.useEffect(() => {
    if (!timeline?.complaint || assignableStaff.length === 0) return;
    const deptWorkers = assignableStaff.filter(
      (s) =>
        s.role === 'field_worker' &&
        (!timeline.complaint.departmentId || s.departmentId === timeline.complaint.departmentId)
    );
    const defaultPick =
      timeline.complaint.assignedWorkerId || deptWorkers[0]?.id || assignableStaff[0]?.id || '';
    setAssigneeSelection(defaultPick);
  }, [timeline?.complaint?.id, timeline?.complaint?.departmentId, timeline?.complaint?.assignedWorkerId, assignableStaff]);

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

  const formatResponsibleRole = (role?: UserRole | 'system') => {
    if (!role || role === 'system') return 'System';
    return ROLE_LABELS[role]?.[locale] || role;
  };

  const handleAssign = async () => {
    if (!timeline?.complaint || !assigneeSelection) return;
    setActionBusy(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await apiFetch(`/api/complaints/${timeline.complaint.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ assigneeId: assigneeSelection, notes: actionNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Assignment failed.');
      setActionNotes('');
      setActionMessage(
        `${data.complaint.trackingId} → ${data.complaint.responsibleUserName || assigneeSelection}`
      );
      await Promise.all([loadDashboard(true), loadTimeline(timeline.complaint.id), refreshNotifications()]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to assign complaint.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleStatusUpdate = async (nextStatus: ComplaintStatus) => {
    if (!timeline?.complaint) return;
    setActionBusy(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await apiFetch(`/api/complaints/${timeline.complaint.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus, notes: actionNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Status update failed.');
      setActionNotes('');
      setActionMessage(`${data.complaint.trackingId} → ${STATUS_LABELS[nextStatus][locale]}`);
      await Promise.all([loadDashboard(true), loadTimeline(timeline.complaint.id), refreshNotifications()]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update status.');
    } finally {
      setActionBusy(false);
    }
  };

  if (!user) return null;

  const isCitizen = user.role === 'citizen';
  const canAssign = user.role === 'dept_officer' || user.role === 'dept_head' || user.role === 'admin';
  const canProgressWork =
    user.role === 'field_worker' ||
    user.role === 'dept_officer' ||
    user.role === 'dept_head' ||
    user.role === 'high_authority' ||
    user.role === 'admin';

  const mineOrActiveCount = isCitizen
    ? summary?.active ?? 0
    : summary?.assignedToMe ?? 0;

  const riskOrEscalatedCount = complaints.filter((c) => {
    if (c.status === 'ESCALATED' || c.status === 'REOPENED') return true;
    const m = computeSlaMetrics(c, nowMs);
    return m.isBreached || m.isAtRisk;
  }).length;

  const resolvedCount = summary?.resolvedClosed ?? 0;

  const filteredComplaints = complaints.filter((c) => {
    if (deptFilter !== 'ALL' && c.departmentId !== deptFilter) return false;

    if (filterMode === 'MINE') {
      if (isCitizen) {
        if (c.status === 'RESOLVED' || c.status === 'CLOSED') return false;
      } else {
        const isMine =
          c.responsibleUserId === user.id ||
          c.assignedOfficerId === user.id ||
          c.assignedWorkerId === user.id ||
          (user.role === 'triage_officer' && c.status === 'TRIAGING');
        if (!isMine || c.status === 'CLOSED' || c.status === 'RESOLVED') return false;
      }
    } else if (filterMode === 'RISK') {
      const m = computeSlaMetrics(c, nowMs);
      if (!(c.status === 'ESCALATED' || c.status === 'REOPENED' || m.isBreached || m.isAtRisk)) {
        return false;
      }
    } else if (filterMode === 'RESOLVED') {
      if (c.status !== 'RESOLVED' && c.status !== 'CLOSED') return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const hay = `${c.trackingId} ${c.rawText} ${c.district} ${c.division} ${c.responsibleUserName || ''} ${c.categoryCode || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const statusChartData = (summary?.byStatus || []).map((item) => ({
    name: STATUS_LABELS[item.status]?.[locale] || item.status,
    status: item.status,
    count: item.count,
  }));

  const deptChartData = summary?.byDepartment || [];

  const workerOptions = assignableStaff.filter(
    (s) =>
      !timeline?.complaint?.departmentId ||
      s.departmentId === timeline.complaint.departmentId ||
      user.role === 'admin' ||
      user.role === 'high_authority'
  );

  return (
    <div className="space-y-6">
      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Surface className="p-4">
          <div className="text-xs text-slate-500">
            {isCitizen ? t.kpiTotalFiled : t.complaintsLabel}
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold text-emerald-950 tabular-nums">
            {summary?.total ?? complaints.length}
          </div>
        </Surface>
        <Surface className="p-4">
          <div className="text-xs text-slate-500">
            {isCitizen ? t.kpiActiveTrack : t.kpiAssignedToMe}
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold text-[#006a4e] tabular-nums">
            {mineOrActiveCount}
          </div>
        </Surface>
        <Surface className="p-4">
          <div className="text-xs text-slate-500">{t.kpiEscalatedRisk}</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-amber-700 tabular-nums">
            {riskOrEscalatedCount}
          </div>
        </Surface>
        <Surface className="p-4">
          <div className="text-xs text-slate-500">{t.kpiResolvedClosed}</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-emerald-950 tabular-nums">
            {resolvedCount}
          </div>
        </Surface>
      </div>

      {/* Analytics Row (Recharts) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Surface className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-emerald-950">
              {t.chartStatusTitle}
            </h2>
            <span className="font-mono text-[11px] text-slate-500 tabular-nums">
              {summary?.total ?? 0} {t.recordsSuffix}
            </span>
          </div>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusChartData} margin={{ top: 4, right: 8, left: -18, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2efe7" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fill: '#334155' }}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickLine={false}
                  interval={0}
                  angle={-15}
                  textAnchor="end"
                  height={42}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10, fill: '#475569' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: '#f0fdf4' }}
                  contentStyle={{
                    borderRadius: '6px',
                    border: '1px solid #bbf7d0',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={32}>
                  {statusChartData.map((entry) => (
                    <Cell key={entry.status} fill={getStatusBarColor(entry.status)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Surface>

        <Surface className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-emerald-950">
              {t.chartDeptTitle}
            </h2>
            <span className="font-mono text-[11px] text-[#006a4e] tabular-nums">
              {t.kpiSlaBreached}: {summary?.breached ?? 0}
            </span>
          </div>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deptChartData} margin={{ top: 4, right: 8, left: -18, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2efe7" vertical={false} />
                <XAxis
                  dataKey="code"
                  tick={{ fontSize: 11, fill: '#0c2419' }}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10, fill: '#475569' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: '#f0fdf4' }}
                  contentStyle={{
                    borderRadius: '6px',
                    border: '1px solid #bbf7d0',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="active" name={t.filterActive} stackId="a" fill="#006a4e" maxBarSize={32} />
                <Bar dataKey="breached" name={t.kpiSlaBreached} stackId="a" fill="#dc2626" maxBarSize={32} />
                <Bar
                  dataKey="resolved"
                  name={t.filterResolved}
                  stackId="a"
                  fill="#6ee7b7"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={32}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Surface>
      </div>

      {/* Filter, Search & Sync Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-md border border-emerald-100 bg-emerald-50/70 p-1">
          {(
            [
              { id: 'ALL', label: `${t.filterAll} (${summary?.total ?? complaints.length})` },
              {
                id: 'MINE',
                label: `${isCitizen ? t.filterActive : t.filterMine} (${mineOrActiveCount})`,
              },
              { id: 'RISK', label: `${t.filterEscalated} (${riskOrEscalatedCount})` },
              { id: 'RESOLVED', label: `${t.filterResolved} (${resolvedCount})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterMode(tab.id)}
              className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                filterMode === tab.id
                  ? 'bg-white text-emerald-950 shadow-sm'
                  : 'text-emerald-900/70 hover:text-emerald-950'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {lastSyncedAt && (
            <span className="font-mono text-[11px] text-slate-500 tabular-nums">
              {t.lastSyncedLabel}: {lastSyncedAt.toLocaleTimeString()}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              loadDashboard(true);
              if (selectedId) loadTimeline(selectedId);
            }}
            disabled={refreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{t.refreshStatusBtn}</span>
          </Button>
        </div>
      </div>

      {/* Master-Detail Workspace */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-start">
        {/* Left Column: Search + Dept Filter + Queue */}
        <div className="lg:col-span-5 space-y-4">
          <Surface className="p-4 space-y-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (searchQuery.trim().toUpperCase().startsWith('BD-')) {
                  loadTimeline(searchQuery.trim());
                }
              }}
              className="flex gap-2"
            >
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.searchDashboardPlaceholder}
                className="text-xs"
              />
              <Button type="submit" variant="outline" size="sm">
                <Search className="h-3.5 w-3.5" />
                <span>{t.trackBtn}</span>
              </Button>
            </form>

            <Select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
              <option value="ALL">{t.allDepartmentsOpt}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {locale === 'bn' ? d.nameBn : d.name}
                </option>
              ))}
            </Select>

            {lookupError && <p className="text-xs text-red-600">{lookupError}</p>}
          </Surface>

          <Surface className="overflow-hidden">
            <div className="border-b border-emerald-200/80 px-5 py-3.5 flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-emerald-950">
                {isCitizen ? t.myFiledHeading : t.dashboardTitleStaff}
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
              <div className="divide-y divide-emerald-100 max-h-[640px] overflow-y-auto">
                {filteredComplaints.map((c) => {
                  const pct = getProgressPercent(c.status);
                  const isSelected = selectedId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={`w-full text-left px-5 py-4 transition-colors cursor-pointer ${
                        isSelected ? 'bg-emerald-50/60' : 'hover:bg-emerald-50/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono font-semibold text-emerald-950 tabular-nums">
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
                                  : 'text-[#006a4e]'
                          }`}
                        >
                          {STATUS_LABELS[c.status][locale]}
                        </span>
                      </div>

                      <p className="mt-1.5 text-xs text-slate-700 line-clamp-2">{c.rawText}</p>

                      <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-emerald-100">
                        <div
                          className={`h-full transition-all duration-300 ${
                            c.status === 'ESCALATED'
                              ? 'bg-red-600'
                              : c.status === 'TRIAGING' || c.status === 'REOPENED'
                                ? 'bg-amber-500'
                                : 'bg-[#006a4e]'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                        <div className="flex items-center gap-1.5 truncate max-w-[65%]">
                          <span className="truncate font-medium text-emerald-950">
                            {c.responsibleUserName || t.unassignedLabel}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{getLocalizedCategory(c.categoryCode)}</span>
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

        {/* Right Column: Detail, Responsible Authority, Stepper, Actions & Timeline */}
        <div className="lg:col-span-7">
          <Surface className="p-6">
            {timeline ? (
              <div className="space-y-6">
                {/* Summary Header */}
                <div className="border-b border-emerald-100 pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-base font-bold text-emerald-950 tabular-nums">
                      {timeline.complaint.trackingId}
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        timeline.complaint.status === 'ESCALATED'
                          ? 'text-red-700'
                          : timeline.complaint.status === 'TRIAGING' ||
                              timeline.complaint.status === 'REOPENED'
                            ? 'text-amber-700'
                            : 'text-[#006a4e]'
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

                  {/* Responsible Party Line */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200/80 bg-emerald-50/40 px-3.5 py-2.5 text-xs">
                    <div className="flex items-center gap-2 text-emerald-950">
                      <UserCheck className="h-3.5 w-3.5 text-[#006a4e]" />
                      <span className="text-slate-500">{t.responsibleLabel}:</span>
                      <span className="font-semibold">
                        {timeline.complaint.responsibleUserName || t.unassignedLabel}
                      </span>
                      <span className="text-emerald-300">·</span>
                      <span className="text-[#006a4e] font-medium">
                        {formatResponsibleRole(timeline.complaint.responsibleUserRole)}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                      L{timeline.complaint.currentLevel}
                    </span>
                  </div>
                </div>

                {/* Live SLA Countdown */}
                <SlaCountdownTimer
                  complaint={timeline.complaint}
                  nowMs={nowMs}
                  variant="detailed"
                />

                {/* Lifecycle Stepper */}
                <div className="border-t border-emerald-100 pt-5">
                  <ComplaintProgressStepper
                    complaint={timeline.complaint}
                    events={timeline.events}
                  />
                </div>

                {/* Role-Based Actions */}
                {(canAssign ||
                  (canProgressWork &&
                    timeline.complaint.status !== 'CLOSED' &&
                    timeline.complaint.status !== 'RESOLVED') ||
                  (isCitizen &&
                    timeline.complaint.citizenId === user.id &&
                    timeline.complaint.status === 'RESOLVED')) && (
                  <div className="border-t border-emerald-100 pt-5 space-y-3">
                    {actionMessage && (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-[#006a4e]">
                        {actionMessage}
                      </div>
                    )}
                    {actionError && (
                      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        {actionError}
                      </div>
                    )}

                    <Input
                      value={actionNotes}
                      onChange={(e) => setActionNotes(e.target.value)}
                      placeholder={t.actionNotesPlaceholder}
                      className="text-xs"
                    />

                    {canAssign &&
                      timeline.complaint.status !== 'CLOSED' &&
                      timeline.complaint.status !== 'TRIAGING' &&
                      workerOptions.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex-1 min-w-[200px]">
                            <Select
                              value={assigneeSelection}
                              onChange={(e) => setAssigneeSelection(e.target.value)}
                              aria-label={t.dispatchWorkerLabel}
                            >
                              {workerOptions.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name} ({ROLE_LABELS[s.role][locale]}) · {s.district}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={actionBusy || !assigneeSelection}
                            onClick={handleAssign}
                          >
                            <Wrench className="h-3.5 w-3.5" />
                            <span>{actionBusy ? t.assigningBtn : t.assignBtn}</span>
                          </Button>
                        </div>
                      )}

                    <div className="flex flex-wrap items-center gap-2">
                      {canProgressWork &&
                        timeline.complaint.status !== 'CLOSED' &&
                        timeline.complaint.status !== 'RESOLVED' && (
                          <>
                            {timeline.complaint.status !== 'IN_PROGRESS' && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={actionBusy}
                                onClick={() => handleStatusUpdate('IN_PROGRESS')}
                              >
                                <Clock className="h-3.5 w-3.5" />
                                <span>{t.markInProgressBtn}</span>
                              </Button>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              disabled={actionBusy}
                              onClick={() => handleStatusUpdate('RESOLVED')}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>{t.markResolvedBtn}</span>
                            </Button>
                          </>
                        )}

                      {isCitizen &&
                        timeline.complaint.citizenId === user.id &&
                        timeline.complaint.status === 'RESOLVED' && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              disabled={actionBusy}
                              onClick={() => handleStatusUpdate('CLOSED')}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>{t.confirmCloseBtn}</span>
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={actionBusy}
                              onClick={() => handleStatusUpdate('REOPENED')}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              <span>{t.reopenComplaintBtn}</span>
                            </Button>
                          </>
                        )}
                    </div>
                  </div>
                )}

                {/* Vertical Audit Event Timeline */}
                <div className="border-t border-emerald-100 pt-5">
                  <h3 className="font-display text-xs font-semibold text-emerald-950 mb-3 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-[#006a4e]" />
                    <span>{t.timelineHeading}</span>
                  </h3>
                  <div className="divide-y divide-emerald-100">
                    {timeline.events.map((ev) => (
                      <div key={ev.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-mono font-semibold text-emerald-950">
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
