import * as React from 'react';
import { AlertTriangle, Check, RotateCcw } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { TRANSLATIONS } from '../lib/i18n.ts';
import type { Complaint, ComplaintEvent, ComplaintStatus } from '../types/domain.ts';

function getActiveStepIndex(status: ComplaintStatus): number {
  switch (status) {
    case 'SUBMITTED':
      return 0;
    case 'TRIAGING':
    case 'ASSIGNED':
      return 1;
    case 'IN_PROGRESS':
    case 'ESCALATED':
    case 'REOPENED':
      return 2;
    case 'RESOLVED':
      return 3;
    case 'CLOSED':
      return 4;
    default:
      return 0;
  }
}

export function ComplaintProgressStepper({
  complaint,
  events,
}: {
  complaint: Complaint;
  events: ComplaintEvent[];
}) {
  const { locale } = useAuth();
  const t = TRANSLATIONS[locale];
  const activeStep = getActiveStepIndex(complaint.status);

  const findTimestampForStep = (stepIndex: number): string | undefined => {
    if (stepIndex === 0) return complaint.createdAt;
    if (stepIndex === 1) {
      const ev = events.find(
        (e) =>
          e.toStatus === 'TRIAGING' ||
          e.toStatus === 'ASSIGNED' ||
          e.eventType === 'AUTO_ASSIGNED' ||
          e.eventType === 'TRIAGE_REROUTED_AND_LOGGED'
      );
      return ev?.createdAt;
    }
    if (stepIndex === 2) {
      const ev = events.find(
        (e) =>
          e.toStatus === 'IN_PROGRESS' ||
          e.toStatus === 'ESCALATED' ||
          e.toStatus === 'REOPENED'
      );
      return ev?.createdAt;
    }
    if (stepIndex === 3) {
      return (
        complaint.resolvedAt ||
        events.find((e) => e.toStatus === 'RESOLVED')?.createdAt
      );
    }
    if (stepIndex === 4) {
      return (
        complaint.closedAt ||
        events.find((e) => e.toStatus === 'CLOSED')?.createdAt
      );
    }
    return undefined;
  };

  const steps = [
    { title: t.step1Title, sub: t.step1Sub },
    {
      title: t.step2Title,
      sub: complaint.status === 'TRIAGING' ? t.step2SubTriage : t.step2SubAssigned,
    },
    { title: t.step3Title, sub: t.step3Sub },
    { title: t.step4Title, sub: t.step4Sub },
    { title: t.step5Title, sub: t.step5Sub },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-xs font-semibold text-emerald-950">
          {t.progressStepperTitle}
        </h3>
        <span className="font-mono text-[11px] text-slate-500 tabular-nums">
          {t.escalationLevelLabel}: L{complaint.currentLevel}
        </span>
      </div>

      {/* Horizontal Stepper on Desktop, Stacked cleanly on narrow screens */}
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-5 sm:gap-2">
        {steps.map((step, idx) => {
          const isCompleted =
            idx < activeStep || (complaint.status === 'CLOSED' && idx === 4);
          const isCurrent =
            idx === activeStep && !(complaint.status === 'CLOSED' && idx === 4);
          const isEscalatedStep = isCurrent && complaint.status === 'ESCALATED';
          const isTriageStep = isCurrent && complaint.status === 'TRIAGING';
          const isReopenedStep = isCurrent && complaint.status === 'REOPENED';
          const ts = findTimestampForStep(idx);

          const nodeClasses = isCompleted
            ? 'border-[#006a4e] bg-[#006a4e] text-white'
            : isEscalatedStep
              ? 'border-red-600 bg-red-50 text-red-700'
              : isTriageStep || isReopenedStep
                ? 'border-amber-600 bg-amber-50 text-amber-800'
                : isCurrent
                  ? 'border-[#006a4e] bg-emerald-50 text-[#006a4e]'
                  : 'border-emerald-200 bg-white text-slate-400';

          return (
            <li key={step.title} className="relative flex sm:flex-col items-start gap-2.5 sm:gap-1.5">
              {/* Connector Line (Desktop) */}
              {idx < steps.length - 1 && (
                <div
                  aria-hidden="true"
                  className={`hidden sm:block absolute top-3.5 left-8 right-0 h-[1.5px] ${
                    idx < activeStep ? 'bg-[#006a4e]' : 'bg-emerald-100'
                  }`}
                />
              )}

              <div
                className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-mono font-semibold tabular-nums transition-colors ${nodeClasses}`}
              >
                {isCompleted ? (
                  <Check className="h-3.5 w-3.5" />
                ) : isEscalatedStep ? (
                  <AlertTriangle className="h-3.5 w-3.5" />
                ) : isReopenedStep ? (
                  <RotateCcw className="h-3.5 w-3.5" />
                ) : (
                  idx + 1
                )}
              </div>

              <div className="min-w-0">
                <div
                  className={`text-xs font-semibold leading-tight ${
                    isCompleted || isCurrent ? 'text-emerald-950' : 'text-slate-400'
                  }`}
                >
                  {step.title}
                </div>
                <div className="mt-0.5 text-[11px] leading-snug text-slate-500">
                  {step.sub}
                </div>
                {ts && (isCompleted || isCurrent) && (
                  <div className="mt-0.5 font-mono text-[10px] text-slate-400 tabular-nums">
                    {new Date(ts).toLocaleDateString()}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {complaint.status === 'ESCALATED' && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            {t.escalatedNoticePrefix} {complaint.currentLevel}
          </span>
        </div>
      )}

      {complaint.status === 'REOPENED' && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <RotateCcw className="h-3.5 w-3.5 shrink-0" />
          <span>{t.reopenedNoticeText}</span>
        </div>
      )}
    </div>
  );
}
