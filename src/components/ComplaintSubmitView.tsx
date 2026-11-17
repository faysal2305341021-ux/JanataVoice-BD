import * as React from 'react';
import {
  Sparkles,
  Upload,
  Mic,
  CheckCircle2,
  AlertTriangle,
  Send,
  MapPin,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { SLA_TIER_LABELS, STATUS_LABELS, TRANSLATIONS } from '../lib/i18n.ts';
import type {
  Complaint,
  ComplaintCategory,
  ComplaintEvent,
  Department,
  SlaTier,
} from '../types/domain.ts';
import { Button, Input, Select, Surface } from './ui/primitives.tsx';

interface ClassificationPreview {
  category_code: string;
  category_id: string;
  department_id: string;
  confidence: number;
  priority: string;
  sla_tier: string;
  reason_code: string;
  detected_language: string;
  raw_reasoning: string;
  model_version: string;
  raw_model_response: string;
}

const SAMPLE_PROMPTS = [
  {
    labelEn: 'Bangla (WASA)',
    labelBn: 'বাংলা (ওয়াসা)',
    text: 'গত ৩ দিন ধরে আমাদের এলাকায় ওয়াসার লাইনে কোনো পানি আসছে না, তীব্র পানির সংকট দেখা দিয়েছে।',
  },
  {
    labelEn: 'Banglish (LGD)',
    labelBn: 'বাংলিশ (সিটি কর্পোরেশন)',
    text: 'Mirpur 10 er main rasta puro vanga r gorto hoye geche, bristi holei drain er pani jome thake.',
  },
  {
    labelEn: 'English (Power)',
    labelBn: 'ইংরেজি (বিদ্যুৎ)',
    text: 'Exposed live 11kV wire sparking on electric transformer pole near school gate.',
  },
  {
    labelEn: 'Ambiguous (<70% Triage)',
    labelBn: 'অস্পষ্ট (<৭০% ট্রায়াজ)',
    text: 'The corner outside our building has been awful since Tuesday and nobody came to check it.',
  },
];

export function ComplaintSubmitView({
  departments,
  categories,
  onSubmitted,
}: {
  departments: Department[];
  categories: ComplaintCategory[];
  onSubmitted?: (complaint: Complaint) => void;
}) {
  const { user, locale, apiFetch } = useAuth();
  const t = TRANSLATIONS[locale];

  const [rawText, setRawText] = React.useState('');
  const [addressText, setAddressText] = React.useState(
    user ? `${user.district}, ${user.division}` : ''
  );
  const [voiceNoteTranscript, setVoiceNoteTranscript] = React.useState('');
  const [imageBase64, setImageBase64] = React.useState<string | undefined>();
  const [imageMimeType, setImageMimeType] = React.useState<string | undefined>();
  const [recording, setRecording] = React.useState(false);

  const [classifying, setClassifying] = React.useState(false);
  const [classification, setClassification] = React.useState<ClassificationPreview | null>(null);
  const [overrideCode, setOverrideCode] = React.useState<string>('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [createdResult, setCreatedResult] = React.useState<{
    complaint: Complaint;
    events: ComplaintEvent[];
  } | null>(null);

  if (!user) return null;

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageMimeType(file.type || 'image/jpeg');
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageBase64(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleVoiceDictation = () => {
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;

    if (!SpeechRec) {
      setVoiceNoteTranscript((prev) =>
        prev ||
        (locale === 'bn'
          ? 'এই ব্রাউজারে ভয়েস ডিকটেশন সমর্থিত নয়; এখানে টেক্সট লিখুন।'
          : 'Voice dictation not supported in this browser; enter transcript here.')
      );
      return;
    }

    const rec = new SpeechRec() as {
      lang: string;
      interimResults: boolean;
      onresult: (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onerror: () => void;
      onend: () => void;
      start: () => void;
    };
    rec.lang = locale === 'bn' ? 'bn-BD' : 'en-US';
    rec.interimResults = false;
    setRecording(true);
    rec.onresult = (ev) => {
      const spoken = ev.results?.[0]?.[0]?.transcript || '';
      if (spoken) {
        setVoiceNoteTranscript((prev) => (prev ? `${prev} ${spoken}` : spoken));
      }
    };
    rec.onerror = () => setRecording(false);
    rec.onend = () => setRecording(false);
    rec.start();
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreatedResult(null);
    setClassifying(true);
    try {
      const res = await apiFetch('/api/complaints/classify', {
        method: 'POST',
        body: JSON.stringify({
          rawText,
          imageBase64,
          imageMimeType,
          voiceNoteTranscript,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Classification failed.');
      }
      setClassification(data.classification);
      setOverrideCode(data.classification.category_code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not classify complaint.');
    } finally {
      setClassifying(false);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/complaints', {
        method: 'POST',
        body: JSON.stringify({
          rawText,
          imageBase64,
          imageMimeType,
          voiceNoteTranscript,
          addressText,
          classification,
          citizenOverrideCategoryCode:
            overrideCode && classification && overrideCode !== classification.category_code
              ? overrideCode
              : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Submission failed.');
      }
      setCreatedResult(data);
      setClassification(null);
      setRawText('');
      setVoiceNoteTranscript('');
      setImageBase64(undefined);
      onSubmitted?.(data.complaint);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit complaint.');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedCat = categories.find(
    (c) => c.code === (overrideCode || classification?.category_code)
  );
  const selectedDept = departments.find(
    (d) => d.id === (selectedCat?.departmentId || classification?.department_id)
  );
  const createdDept = departments.find((d) => d.id === createdResult?.complaint.departmentId);
  const createdCat = categories.find((c) => c.code === createdResult?.complaint.categoryCode);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-start">
      <div className="lg:col-span-7 space-y-6">
        <Surface className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                {t.submitTitle}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">{t.submitDesc}</p>
            </div>
          </div>

          {/* Once-only auto-populated citizen banner */}
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-medium text-slate-900">{user.name}</span>
              <span aria-hidden="true" className="mx-2 text-slate-300">·</span>
              <span className="font-mono">{user.phone || '—'}</span>
              <span aria-hidden="true" className="mx-2 text-slate-300">·</span>
              <span>
                {user.district}, {user.division}
              </span>
            </div>
            <span className="font-medium text-emerald-700">
              {user.ekIdVerified ? `ekID: ${user.nidMock}` : t.onceOnlyBadge}
            </span>
          </div>

          {/* Quick sample presets */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-slate-500">{t.testSamplesLabel}</span>
            {SAMPLE_PROMPTS.map((sp) => (
              <button
                key={sp.labelEn}
                type="button"
                onClick={() => {
                  setRawText(sp.text);
                  setClassification(null);
                  setCreatedResult(null);
                }}
                className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                {locale === 'bn' ? sp.labelBn : sp.labelEn}
              </button>
            ))}
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleAnalyze} className="mt-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">
                {t.complaintDetailsLabel}
              </label>
              <textarea
                rows={4}
                required
                minLength={5}
                value={rawText}
                onChange={(e) => {
                  setRawText(e.target.value);
                  setClassification(null);
                }}
                placeholder={t.complaintPlaceholder}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  <MapPin className="h-3.5 w-3.5 text-slate-400" />
                  <span>{t.locationAddressLabel}</span>
                </label>
                <Input
                  value={addressText}
                  onChange={(e) => setAddressText(e.target.value)}
                  placeholder={t.locationAddressPlaceholder}
                />
              </div>
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  <Upload className="h-3.5 w-3.5 text-slate-400" />
                  <span>{t.photoEvidenceLabel}</span>
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="block w-full text-xs text-slate-600 file:mr-3 file:rounded file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                />
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-medium text-slate-700">
                  {t.voiceNoteLabel}
                </label>
                <button
                  type="button"
                  onClick={handleVoiceDictation}
                  className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline cursor-pointer"
                >
                  <Mic className="h-3.5 w-3.5" />
                  <span>{recording ? t.voiceListeningBtn : t.voiceDictateBtn}</span>
                </button>
              </div>
              <Input
                value={voiceNoteTranscript}
                onChange={(e) => setVoiceNoteTranscript(e.target.value)}
                placeholder={t.voiceNotePlaceholder}
              />
            </div>

            {imageBase64 && (
              <div className="rounded border border-slate-200 p-2">
                <img
                  src={imageBase64}
                  alt="Complaint attachment preview"
                  referrerPolicy="no-referrer"
                  className="max-h-40 rounded object-cover"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button type="submit" disabled={classifying || rawText.trim().length < 5}>
                <Sparkles className="h-4 w-4" />
                <span>{classifying ? t.analyzingBtn : t.analyzeBtn}</span>
              </Button>
            </div>
          </form>
        </Surface>
      </div>

      {/* Right Column: AI Classification Preview & Confirmation OR Submitted Receipt */}
      <div className="lg:col-span-5 space-y-6">
        {classification && (
          <Surface className="p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-semibold text-slate-900">
                {t.aiPreviewTitle}
              </h3>
              <span
                className={`font-mono text-xs font-semibold tabular-nums ${
                  classification.confidence < 0.7 ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                {Math.round(classification.confidence * 100)}
                {t.confidenceSuffix}
              </span>
            </div>

            {classification.confidence < 0.7 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>{t.lowConfWarning}</div>
              </div>
            ) : (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  {t.highConfNotice}{' '}
                  <strong>
                    {(locale === 'bn' ? selectedDept?.nameBn : selectedDept?.name) ||
                      classification.department_id}
                  </strong>
                  .
                </div>
              </div>
            )}

            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">{t.modelEngineLabel}</span>
                <span className="font-mono text-slate-800">{classification.model_version}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t.detectedLangLabel}</span>
                <span className="font-mono text-slate-800">{classification.detected_language}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t.slaTierPriorityLabel}</span>
                <span className="font-mono text-slate-800">
                  {SLA_TIER_LABELS[classification.sla_tier as SlaTier]?.[locale] ||
                    classification.sla_tier}{' '}
                  · {classification.priority}
                </span>
              </div>
            </div>

            <div className="rounded border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-medium text-slate-500">{t.aiRawReasoningLabel}</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-700">
                {classification.raw_reasoning}
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">
                {t.overrideCatLabel}
              </label>
              <Select value={overrideCode} onChange={(e) => setOverrideCode(e.target.value)}>
                {departments.map((dept) => (
                  <optgroup
                    key={dept.id}
                    label={`${dept.code} — ${locale === 'bn' ? dept.nameBn : dept.name}`}
                  >
                    {categories
                      .filter((c) => c.departmentId === dept.id)
                      .map((cat) => (
                        <option key={cat.id} value={cat.code}>
                          {locale === 'bn' ? cat.nameBn : cat.nameEn} (
                          {SLA_TIER_LABELS[cat.slaTier][locale]})
                        </option>
                      ))}
                  </optgroup>
                ))}
              </Select>
              {overrideCode !== classification.category_code && (
                <p className="mt-1 text-[11px] text-emerald-700">
                  {t.overrideLoggedHint} ({classification.category_code} → {overrideCode})
                </p>
              )}
            </div>

            <Button
              type="button"
              className="w-full"
              disabled={submitting}
              onClick={handleSubmit}
            >
              <Send className="h-4 w-4" />
              <span>{submitting ? t.filingBtn : t.confirmSubmitBtn}</span>
            </Button>
          </Surface>
        )}

        {createdResult && (
          <Surface className="p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-semibold text-emerald-800">
                {t.complaintRegisteredTitle}
              </h3>
              <span className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                {createdResult.complaint.trackingId}
              </span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">{t.currentStatusLabel}</span>
                <span className="font-semibold text-slate-900">
                  {STATUS_LABELS[createdResult.complaint.status][locale]}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t.departmentLabel}</span>
                <span className="text-slate-800 text-right">
                  {createdDept
                    ? locale === 'bn'
                      ? createdDept.nameBn
                      : createdDept.name
                    : t.pendingTriageLabel}
                </span>
              </div>
              {createdCat && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{t.colCategory}</span>
                  <span className="text-slate-800 text-right">
                    {locale === 'bn' ? createdCat.nameBn : createdCat.nameEn}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">{t.slaDueLabel}</span>
                <span className="font-mono tabular-nums text-slate-700">
                  {new Date(createdResult.complaint.slaDueAt).toLocaleString()}
                </span>
              </div>
            </div>
            <div className="border-t border-slate-100 pt-3">
              <div className="text-[11px] font-medium text-slate-500 mb-2">
                {t.auditRecordedLabel} ({createdResult.events.length})
              </div>
              <div className="divide-y divide-slate-100 rounded border border-slate-200">
                {createdResult.events.map((ev) => (
                  <div key={ev.id} className="text-xs px-3 py-2">
                    <div className="font-mono font-medium text-slate-800">{ev.eventType}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-slate-400 truncate" title={ev.hash}>
                      SHA-256 · {ev.hash.slice(0, 10)}…{ev.hash.slice(-6)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Surface>
        )}

        {!classification && !createdResult && (
          <Surface className="p-6 text-xs text-slate-500 space-y-2">
            <div className="font-display text-sm font-semibold text-slate-900">
              {t.howItWorksTitle}
            </div>
            <p className="leading-relaxed">{t.howItWorks1}</p>
            <p className="leading-relaxed">{t.howItWorks2}</p>
            <p className="leading-relaxed">{t.howItWorks3}</p>
          </Surface>
        )}
      </div>
    </div>
  );
}
