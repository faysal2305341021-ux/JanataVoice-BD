import * as React from 'react';
import { GitFork, AlertCircle, CheckCircle2, FileCode2, History } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { STATUS_LABELS } from '../lib/i18n.ts';
import type {
  AiCorrection,
  Complaint,
  ComplaintCategory,
  Department,
} from '../types/domain.ts';
import { Button, Input, Select, Surface } from './ui/primitives.tsx';

interface TriageQueueResponse {
  queue: Complaint[];
  corrections: AiCorrection[];
  stats: {
    pendingTriage: number;
    totalLowConfidence: number;
    loggedOverrides: number;
  };
}

function parseRawReasoning(complaint: Complaint): {
  reasoning: string;
  topCandidate?: string;
  runnerUp?: string;
  rawJsonPretty?: string;
} {
  if (!complaint.aiRawResponse) {
    return {
      reasoning: complaint.aiReasonCode || 'Confidence fell below 70% automatic routing threshold.',
    };
  }
  try {
    const parsed = JSON.parse(complaint.aiRawResponse) as {
      reasoning?: string;
      raw_reasoning?: string;
      top_candidate?: string;
      category_code?: string;
      runner_up?: string;
    };
    return {
      reasoning:
        parsed.reasoning ||
        parsed.raw_reasoning ||
        complaint.aiReasonCode ||
        'Low-confidence model output.',
      topCandidate: parsed.top_candidate || parsed.category_code,
      runnerUp: parsed.runner_up,
      rawJsonPretty: JSON.stringify(parsed, null, 2),
    };
  } catch {
    return {
      reasoning: complaint.aiRawResponse,
      rawJsonPretty: complaint.aiRawResponse,
    };
  }
}

export function TriageQueueView({
  departments,
  categories,
}: {
  departments: Department[];
  categories: ComplaintCategory[];
}) {
  const { apiFetch, locale } = useAuth();
  const [data, setData] = React.useState<TriageQueueResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [subTab, setSubTab] = React.useState<'pending' | 'all_low' | 'overrides'>('pending');

  // Per-complaint reroute selections & notes
  const [selectedCategories, setSelectedCategories] = React.useState<Record<string, string>>({});
  const [notesById, setNotesById] = React.useState<Record<string, string>>({});
  const [expandedRawId, setExpandedRawId] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const loadQueue = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/triage/queue');
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || 'Failed to load triage queue.');
      }
      setData(body);
      setSelectedCategories((prev) => {
        const next = { ...prev };
        for (const item of body.queue as Complaint[]) {
          if (!next[item.id]) {
            const parsed = parseRawReasoning(item);
            next[item.id] = item.categoryCode || parsed.topCandidate || categories[0]?.code || '';
          }
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load triage queue.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, categories]);

  React.useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const handleReroute = async (complaint: Complaint) => {
    const targetCategoryCode = selectedCategories[complaint.id];
    if (!targetCategoryCode) return;

    setBusyId(complaint.id);
    setToast(null);
    setError(null);
    try {
      const res = await apiFetch(`/api/triage/${complaint.id}/reroute`, {
        method: 'POST',
        body: JSON.stringify({
          targetCategoryCode,
          notes: notesById[complaint.id] || '',
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || 'Re-route failed.');
      }
      setToast(
        `Re-routed ${complaint.trackingId} → ${targetCategoryCode} (${body.complaint.departmentId?.replace('dept_', '').toUpperCase()}). Override logged as ${body.correction.id}.`
      );
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-route complaint.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading && !data) {
    return <div className="text-xs text-slate-500">Loading human triage queue...</div>;
  }

  if (error && !data) {
    return (
      <Surface className="p-6 text-xs text-red-700 border-red-200 bg-red-50">
        {error}
      </Surface>
    );
  }

  const pendingItems = data?.queue.filter((c) => c.status === 'TRIAGING') || [];
  const allLowItems = data?.queue || [];
  const corrections = data?.corrections || [];
  const visibleItems = subTab === 'pending' ? pendingItems : allLowItems;

  return (
    <div className="space-y-6">
      {/* KPI Metrics Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Surface className="p-4">
          <div className="text-xs text-slate-500">Pending Triage Review</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-amber-700 tabular-nums">
            {data?.stats.pendingTriage ?? 0}
          </div>
        </Surface>
        <Surface className="p-4">
          <div className="text-xs text-slate-500">Low-Confidence Queue (&lt; 70%)</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-emerald-950 tabular-nums">
            {data?.stats.totalLowConfidence ?? 0}
          </div>
        </Surface>
        <Surface className="p-4">
          <div className="text-xs text-slate-500">Logged Human Overrides</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-[#006a4e] tabular-nums">
            {data?.stats.loggedOverrides ?? 0}
          </div>
        </Surface>
      </div>

      {/* Segmented View Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex rounded-md border border-emerald-100 bg-emerald-50/70 p-1">
          <button
            type="button"
            onClick={() => setSubTab('pending')}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              subTab === 'pending'
                ? 'bg-white text-emerald-950 shadow-sm'
                : 'text-emerald-900/70 hover:text-emerald-950'
            }`}
          >
            Pending Triage ({pendingItems.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('all_low')}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              subTab === 'all_low'
                ? 'bg-white text-emerald-950 shadow-sm'
                : 'text-emerald-900/70 hover:text-emerald-950'
            }`}
          >
            All Low-Confidence ({allLowItems.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('overrides')}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              subTab === 'overrides'
                ? 'bg-white text-emerald-950 shadow-sm'
                : 'text-emerald-900/70 hover:text-emerald-950'
            }`}
          >
            Override Training Log ({corrections.length})
          </button>
        </div>

        <Button type="button" variant="outline" size="sm" onClick={loadQueue}>
          Refresh Queue
        </Button>
      </div>

      {toast && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Queue List */}
      {subTab !== 'overrides' ? (
        <div className="space-y-4">
          {visibleItems.length === 0 ? (
            <Surface className="p-8 text-center text-xs text-slate-500">
              No complaints currently awaiting human triage.
            </Surface>
          ) : (
            visibleItems.map((item) => {
              const aiInfo = parseRawReasoning(item);
              const selectedCode = selectedCategories[item.id] || '';
              const isRawExpanded = expandedRawId === item.id;
              return (
                <Surface key={item.id} className="p-5 space-y-4">
                  {/* Top Metadata Line (Zero-Pill) */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 pb-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-emerald-950 tabular-nums">
                        {item.trackingId}
                      </span>
                      <span className="text-emerald-300">·</span>
                      <span
                        className={`font-medium ${
                          item.status === 'TRIAGING' ? 'text-amber-700' : 'text-[#006a4e]'
                        }`}
                      >
                        {STATUS_LABELS[item.status][locale]}
                      </span>
                      <span className="text-emerald-300">·</span>
                      <span className="text-slate-600">
                        {item.district}, {item.division}
                      </span>
                      <span className="text-emerald-300">·</span>
                      <span className="font-mono text-slate-500">lang: {item.language}</span>
                    </div>

                    <div className="flex items-center gap-3 text-xs">
                      <span className="font-mono font-semibold text-red-700 tabular-nums flex items-center gap-1">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {Math.round(item.aiConfidence * 100)}% AI confidence
                      </span>
                      <span className="font-mono text-slate-400">{item.aiModelVersion}</span>
                    </div>
                  </div>

                  {/* Complaint Body & Raw AI Reasoning */}
                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                    <div className="lg:col-span-6 space-y-3">
                      <div>
                        <div className="text-[11px] font-medium text-slate-500">
                          Citizen Complaint ({item.citizenName})
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-emerald-950">
                          {item.rawText}
                        </p>
                      </div>

                      <div className="rounded-md border border-emerald-200/80 bg-emerald-50/40 p-3 space-y-2">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-medium text-emerald-950">AI Raw Reasoning</span>
                          {aiInfo.rawJsonPretty && (
                            <button
                              type="button"
                              onClick={() => setExpandedRawId(isRawExpanded ? null : item.id)}
                              className="inline-flex items-center gap-1 font-mono text-[#006a4e] hover:underline cursor-pointer"
                            >
                              <FileCode2 className="h-3 w-3" />
                              <span>{isRawExpanded ? 'Hide Raw JSON' : 'View Raw JSON'}</span>
                            </button>
                          )}
                        </div>
                        <p className="text-xs leading-relaxed text-slate-700">{aiInfo.reasoning}</p>
                        {(aiInfo.topCandidate || aiInfo.runnerUp) && (
                          <div className="flex flex-wrap gap-3 pt-1 font-mono text-[11px] text-slate-500">
                            {aiInfo.topCandidate && <span>1st guess: {aiInfo.topCandidate}</span>}
                            {aiInfo.runnerUp && <span>Runner-up: {aiInfo.runnerUp}</span>}
                          </div>
                        )}
                        {isRawExpanded && aiInfo.rawJsonPretty && (
                          <pre className="mt-2 max-h-40 overflow-auto rounded bg-emerald-950 p-2.5 font-mono text-[11px] text-emerald-50">
                            {aiInfo.rawJsonPretty}
                          </pre>
                        )}
                      </div>
                    </div>

                    {/* Re-route Controls */}
                    <div className="lg:col-span-6 flex flex-col justify-between space-y-3 rounded-md border border-emerald-200/80 bg-white p-4">
                      <div className="space-y-3">
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-slate-700">
                            Re-route to Department & Category
                          </label>
                          <Select
                            value={selectedCode}
                            onChange={(e) =>
                              setSelectedCategories((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))
                            }
                          >
                            {departments.map((dept) => (
                              <optgroup
                                key={dept.id}
                                label={`${dept.code} — ${locale === 'bn' ? dept.nameBn : dept.name}`}
                              >
                                {categories
                                  .filter((c) => c.departmentId === dept.id)
                                  .map((cat) => (
                                    <option key={cat.id} value={cat.code}>
                                      {locale === 'bn' ? cat.nameBn : cat.nameEn} · {cat.slaTier} ({cat.resolutionDays}d SLA)
                                    </option>
                                  ))}
                              </optgroup>
                            ))}
                          </Select>
                        </div>

                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-slate-700">
                            Re-route Rationale
                          </label>
                          <Input
                            value={notesById[item.id] || ''}
                            onChange={(e) =>
                              setNotesById((prev) => ({ ...prev, [item.id]: e.target.value }))
                            }
                            placeholder="e.g. Confirmed drainage blockage rather than sewer burst"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2">
                        <span className="text-[11px] text-slate-500">
                          Assigns to department officer &amp; logs training override
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          disabled={busyId === item.id || !selectedCode}
                          onClick={() => handleReroute(item)}
                        >
                          <GitFork className="h-3.5 w-3.5" />
                          <span>
                            {busyId === item.id ? 'Routing...' : 'Re-route & Log Override'}
                          </span>
                        </Button>
                      </div>
                    </div>
                  </div>
                </Surface>
              );
            })
          )}
        </div>
      ) : (
        /* Logged Overrides Table */
        <Surface className="overflow-hidden">
          <div className="border-b border-emerald-200/80 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-[#006a4e]" />
              <h3 className="font-display text-sm font-semibold text-emerald-950">
                Logged AI Classification Overrides (Ground-Truth Training Data)
              </h3>
            </div>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {corrections.length} overrides
            </span>
          </div>
          {corrections.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No human overrides logged yet. Re-route a complaint from the Pending Triage tab to log
              one.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-emerald-200/80 bg-emerald-50/60 text-emerald-950">
                  <tr>
                    <th className="px-4 py-3 font-medium">Tracking ID</th>
                    <th className="px-4 py-3 font-medium">AI Predicted</th>
                    <th className="px-4 py-3 font-medium">Human Corrected</th>
                    <th className="px-4 py-3 font-medium">Actor</th>
                    <th className="px-4 py-3 text-right font-medium">AI Conf</th>
                    <th className="px-4 py-3 font-medium">Notes &amp; Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-100">
                  {corrections.map((corr) => (
                    <tr key={corr.id} className="hover:bg-emerald-50/40">
                      <td className="px-4 py-3 font-mono font-semibold text-emerald-950 whitespace-nowrap">
                        {corr.trackingId || corr.complaintId}
                      </td>
                      <td className="px-4 py-3 font-mono text-red-700 whitespace-nowrap">
                        {corr.predictedCategoryCode}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-[#006a4e] whitespace-nowrap">
                        {corr.correctedCategoryCode}
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                        {corr.actorName || corr.actorId} ({corr.actorRole})
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                        {Math.round(corr.confidence * 100)}%
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <div>{corr.notes || '—'}</div>
                        <div className="font-mono text-[11px] text-slate-400">
                          {new Date(corr.createdAt).toLocaleString()}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Surface>
      )}
    </div>
  );
}
