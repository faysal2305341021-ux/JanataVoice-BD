import * as React from 'react';
import {
  ShieldCheck,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Globe,
  LogOut,
  UserCheck,
  Building2,
  Bell,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { SLA_TIER_LABELS, TRANSLATIONS } from '../lib/i18n.ts';
import {
  BANGLADESH_DIVISIONS,
  ROLE_LABELS,
  type ComplaintCategory,
  type Department,
  type SlaConfig,
  type UserRole,
} from '../types/domain.ts';
import { ComplaintDashboardView } from './ComplaintDashboardView.tsx';
import { ComplaintSubmitView } from './ComplaintSubmitView.tsx';
import { NotificationsView } from './NotificationsView.tsx';
import { TriageQueueView } from './TriageQueueView.tsx';
import { Button, Input, Select, Surface } from './ui/primitives.tsx';

interface CatalogData {
  departments: Department[];
  categories: ComplaintCategory[];
  slaConfigs: SlaConfig[];
  counts: Record<string, number>;
}

interface DirectoryUser {
  id: string;
  name: string;
  role: UserRole;
  departmentId: string | null;
  division: string;
  district: string;
  ekIdVerified: boolean;
}

const ROUTE_GUARD_MATRIX: Array<{
  route: string;
  routeBn: string;
  stage: string;
  stageBn: string;
  allowedRoles: UserRole[];
  purpose: string;
  purposeBn: string;
}> = [
  {
    route: 'Identity & Once-Only Profile',
    routeBn: 'পরিচয় ও নাগরিক প্রোফাইল',
    stage: 'Identity',
    stageBn: 'পরিচয়',
    allowedRoles: ['citizen', 'triage_officer', 'field_worker', 'dept_officer', 'dept_head', 'high_authority', 'admin'],
    purpose: 'Unified ekID verification and auto-populated citizen details',
    purposeBn: 'একীভূত ekID যাচাইকরণ এবং নাগরিকের তথ্য স্বয়ংক্রিয়ভাবে পূরণ',
  },
  {
    route: 'Staff & User Directory',
    routeBn: 'কর্মকর্তা ও কর্মী তালিকা',
    stage: 'Directory',
    stageBn: 'ডিরেক্টরি',
    allowedRoles: ['triage_officer', 'dept_officer', 'dept_head', 'high_authority', 'admin'],
    purpose: 'Role-gated personnel lookup for assignment and oversight',
    purposeBn: 'দায়িত্ব বণ্টন ও তদারকির জন্য কর্মকর্তা অনুসন্ধান',
  },
  {
    route: 'Complaint Submission & AI Router',
    routeBn: 'অভিযোগ দাখিল ও এআই রাউটার',
    stage: 'Intake',
    stageBn: 'অভিযোগ গ্রহণ',
    allowedRoles: ['citizen', 'admin'],
    purpose: 'Bangla/English/Banglish intake with AI + keyword fallback & citizen override',
    purposeBn: 'বাংলা/ইংরেজি/বাংলিশ অভিযোগ গ্রহণ, এআই ও কীওয়ার্ড ফলব্যাক এবং নাগরিক সংশোধন',
  },
  {
    route: 'Human Triage Queue (confidence < 70%)',
    routeBn: 'মানব ট্রায়াজ কিউ (কনফিডেন্স < ৭০%)',
    stage: 'Triage',
    stageBn: 'ট্রায়াজ',
    allowedRoles: ['triage_officer', 'admin'],
    purpose: 'Manual categorization for ambiguous grievances and training feedback logging',
    purposeBn: 'অস্পষ্ট অভিযোগ ম্যানুয়ালি বিভাগ নির্ধারণ ও প্রশিক্ষণ ডেটা সংরক্ষণ',
  },
  {
    route: 'SLA Monitor & Escalation Engine',
    routeBn: 'এসএলএ মনিটর ও এসকালেশন ইঞ্জিন',
    stage: 'SLA',
    stageBn: 'এসএলএ',
    allowedRoles: ['dept_officer', 'dept_head', 'high_authority', 'admin'],
    purpose: 'Automated 80% warning and 100% breach escalation across L1–L4',
    purposeBn: '৮০% সতর্কবার্তা এবং ১০০% সময়সীমা অতিক্রমে স্বয়ংক্রিয় উর্ধ্বতন প্রেরণ (L1–L4)',
  },
  {
    route: 'Department Officer & Field Worker Flow',
    routeBn: 'বিভাগীয় কর্মকর্তা ও মাঠকর্মী কার্যক্রম',
    stage: 'Operations',
    stageBn: 'মাঠ কার্যক্রম',
    allowedRoles: ['dept_officer', 'field_worker', 'dept_head', 'admin'],
    purpose: 'SLA-sorted queue, worker dispatch, and geolocated field inspection reports',
    purposeBn: 'এসএলএ ঝুঁকিভিত্তিক তালিকা, মাঠকর্মী নিয়োগ এবং জিও-ট্যাগকৃত ফিল্ড রিপোর্ট',
  },
  {
    route: 'Cabinet Analytics & Audit Verification',
    routeBn: 'মন্ত্রিপরিষদ বিশ্লেষণ ও অডিট যাচাই',
    stage: 'Oversight',
    stageBn: 'তদারকি',
    allowedRoles: ['high_authority', 'dept_head', 'admin'],
    purpose: 'District heatmap, ministry performance scorecards, and SHA-256 chain verifier',
    purposeBn: 'জেলাভিত্তিক হিটম্যাপ, কর্মক্ষমতা স্কোরকার্ড এবং হ্যাশ-চেইন যাচাইকারী',
  },
];

export function Stage1Workspace() {
  const {
    user,
    locale,
    setLocale,
    apiFetch,
    unreadCount,
    latestAlert,
    dismissLatestAlert,
    refreshNotifications,
    verifyEkId,
    updateProfile,
    logout,
  } = useAuth();
  const t = TRANSLATIONS[locale];

  type WorkspaceTab =
    | 'dashboard'
    | 'submit'
    | 'triage'
    | 'notifications'
    | 'identity'
    | 'catalog'
    | 'roles';

  const getDefaultTab = (_role?: UserRole): WorkspaceTab => 'dashboard';

  const [activeTab, setActiveTab] = React.useState<WorkspaceTab>(() => getDefaultTab(user?.role));
  const [focusedComplaintId, setFocusedComplaintId] = React.useState<string | null>(null);
  const [catalog, setCatalog] = React.useState<CatalogData | null>(null);
  const [deptFilter, setDeptFilter] = React.useState<string>('ALL');

  // Profile / ekID state
  const [name, setName] = React.useState(user?.name || '');
  const [phone, setPhone] = React.useState(user?.phone || '');
  const [division, setDivision] = React.useState(user?.division || 'Dhaka');
  const [district, setDistrict] = React.useState(user?.district || 'Dhaka');
  const [nidInput, setNidInput] = React.useState(user?.nidMock || '');
  const [saving, setSaving] = React.useState(false);
  const [saveMessage, setSaveMessage] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  // Role guard live check state
  const [directoryResult, setDirectoryResult] = React.useState<{
    status: number;
    users?: DirectoryUser[];
    error?: string;
  } | null>(null);

  React.useEffect(() => {
    if (user) {
      setName(user.name);
      setPhone(user.phone);
      setDivision(user.division);
      setDistrict(user.district);
      setNidInput(user.nidMock || '');
    }
  }, [user]);

  React.useEffect(() => {
    apiFetch('/api/catalog')
      .then((r) => r.json())
      .then((data) => setCatalog(data))
      .catch(() => {});
  }, [apiFetch]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      await updateProfile({ name, phone, division, district });
      setSaveMessage(t.profileUpdatedMsg);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyEkId = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      await verifyEkId({ nidMock: nidInput, name, phone, division, district });
      setSaveMessage(t.ekIdVerifiedMsg);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'ekID verification failed.');
    } finally {
      setSaving(false);
    }
  };

  const testDirectoryGuard = async () => {
    try {
      const res = await apiFetch('/api/users/directory');
      const data = await res.json();
      setDirectoryResult({
        status: res.status,
        users: data.users,
        error: data.error,
      });
    } catch {
      setDirectoryResult({ status: 500, error: 'Network error' });
    }
  };

  if (!user) return null;

  const districts = BANGLADESH_DIVISIONS[division] || ['Dhaka'];
  const filteredCategories =
    catalog?.categories.filter((c) => deptFilter === 'ALL' || c.departmentId === deptFilter) || [];

  const openComplaintInDashboard = React.useCallback((complaintId: string) => {
    setFocusedComplaintId(complaintId);
    setActiveTab('dashboard');
  }, []);

  const allNavItems: Array<{ id: WorkspaceTab; label: string; visible: boolean }> = [
    { id: 'dashboard', label: t.navDashboard, visible: true },
    { id: 'submit', label: t.navSubmit, visible: user.role === 'citizen' || user.role === 'admin' },
    { id: 'triage', label: t.navTriage, visible: user.role === 'triage_officer' || user.role === 'admin' },
    {
      id: 'notifications',
      label: unreadCount > 0 ? `${t.navNotifications} (${unreadCount})` : t.navNotifications,
      visible: true,
    },
    { id: 'identity', label: t.navIdentity, visible: user.role !== 'admin' },
    { id: 'catalog', label: t.navCatalog, visible: user.role !== 'admin' },
    { id: 'roles', label: t.navAccess, visible: user.role !== 'citizen' },
  ];
  const navItems = allNavItems.filter((item) => item.visible).slice(0, 5);

  return (
    <div className="min-h-screen bg-[#f4f9f6] text-[#0c2419] flex flex-col">
      {/* Top Bar Contract: 3 zones */}
      <header className="border-b border-emerald-200/80 bg-white sticky top-0 z-20">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-3.5">
          <span className="font-display text-lg font-bold tracking-tight text-[#006a4e] whitespace-nowrap shrink-0">
            {t.brandName}
          </span>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`whitespace-nowrap shrink-0 cursor-pointer py-1 transition-colors border-b-2 ${
                  activeTab === item.id
                    ? 'border-[#006a4e] text-[#006a4e] font-semibold'
                    : 'border-transparent hover:text-emerald-950'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-4 shrink-0">
            <button
              type="button"
              onClick={() => setLocale(locale === 'en' ? 'bn' : 'en')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-[#006a4e] whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              <Globe className="h-3.5 w-3.5" />
              <span>{locale === 'en' ? 'বাংলা' : 'English'}</span>
            </button>
            <Button type="button" variant="outline" size="sm" onClick={logout}>
              <LogOut className="h-3.5 w-3.5" />
              <span>{t.navLogout}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Mobile Nav Strip */}
      <div className="flex md:hidden border-b border-emerald-200/80 bg-white px-4 py-2 gap-2 overflow-x-auto">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveTab(item.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap shrink-0 ${
              activeTab === item.id ? 'bg-emerald-50 text-[#006a4e] font-semibold' : 'text-slate-600'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8 space-y-8">
        {/* Context Strip */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-emerald-200/80 pb-5">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-semibold text-[#006a4e]">{t.stage1Tag}</span>
              <span aria-hidden="true">·</span>
              <span>{ROLE_LABELS[user.role][locale]}</span>
              {user.departmentId && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-[#006a4e]">
                    {user.departmentId.replace('dept_', '').toUpperCase()}
                  </span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>
                {user.district}, {user.division}
              </span>
            </div>
            <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-emerald-950">
              {activeTab === 'dashboard' &&
                (user.role === 'citizen' ? t.dashboardTitleCitizen : t.dashboardTitleStaff)}
              {activeTab === 'submit' && t.submitTitle}
              {activeTab === 'triage' && t.triageTitle}
              {activeTab === 'notifications' && t.notificationsTitle}
              {activeTab === 'identity' && t.profileTitle}
              {activeTab === 'catalog' && t.catalogTitle}
              {activeTab === 'roles' && t.roleMatrixTitle}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {activeTab === 'dashboard' &&
                (user.role === 'citizen' ? t.dashboardDescCitizen : t.dashboardDescStaff)}
              {activeTab === 'submit' && t.submitDesc}
              {activeTab === 'triage' && t.triageDesc}
              {activeTab === 'notifications' && t.notificationsDesc}
              {activeTab === 'identity' && t.profileDesc}
              {activeTab === 'catalog' && t.catalogDesc}
              {activeTab === 'roles' && t.roleMatrixDesc}
            </p>
          </div>
          <div className="text-right text-xs text-slate-600">
            <div className="font-semibold text-emerald-950">{user.name}</div>
            <div className="font-mono text-slate-500">{user.email}</div>
          </div>
        </div>

        {/* Live Real-Time Notification Alert Strip */}
        {latestAlert && (
          <Surface className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 bg-emerald-50/70">
            <div className="flex items-start gap-2.5 min-w-0 flex-1 text-xs">
              <Bell className="h-4 w-4 text-[#006a4e] shrink-0 mt-0.5" />
              <div className="min-w-0">
                <span className="font-semibold text-[#006a4e]">{t.newAlertPrefix}: </span>
                <span className="text-emerald-950">{latestAlert.message}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  openComplaintInDashboard(latestAlert.complaintId);
                  dismissLatestAlert();
                }}
              >
                <span>{t.openComplaintBtn}</span>
              </Button>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={dismissLatestAlert}
                className="p-1 text-slate-500 hover:text-emerald-950 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </Surface>
        )}

        {/* TAB 1: IDENTITY & ekID */}
        {activeTab === 'identity' && (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-start">
            {/* Left: Profile & Once-Only Auto-Population */}
            <Surface className="lg:col-span-7 p-6">
              <div className="flex items-center justify-between border-b border-emerald-100 pb-4">
                <div className="flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-[#006a4e]" />
                  <h2 className="font-display text-base font-semibold text-emerald-950">
                    {t.onceOnlyCardTitle}
                  </h2>
                </div>
                <span className="text-xs font-medium text-[#006a4e]">{t.onceOnlyBadge}</span>
              </div>

              {saveMessage && (
                <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  {saveMessage}
                </div>
              )}
              {saveError && (
                <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {saveError}
                </div>
              )}

              <form onSubmit={handleSaveProfile} className="mt-5 space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      {t.fullNameLabel}
                    </label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      {t.phoneLabel}
                    </label>
                    <Input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="017XXXXXXXX"
                      className="font-mono tabular-nums"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      {t.divisionLabel}
                    </label>
                    <Select
                      value={division}
                      onChange={(e) => {
                        const div = e.target.value;
                        setDivision(div);
                        const dList = BANGLADESH_DIVISIONS[div] || [];
                        if (dList.length > 0) setDistrict(dList[0]);
                      }}
                    >
                      {Object.keys(BANGLADESH_DIVISIONS).map((div) => (
                        <option key={div} value={div}>
                          {div}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      {t.districtLabel}
                    </label>
                    <Select value={district} onChange={(e) => setDistrict(e.target.value)}>
                      {districts.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-slate-500">
                    {t.roleAssignedLabel}{' '}
                    <strong className="text-slate-800">{ROLE_LABELS[user.role][locale]}</strong>
                  </span>
                  <Button type="submit" disabled={saving}>
                    {saving ? t.savingProfile : t.saveProfile}
                  </Button>
                </div>
              </form>
            </Surface>

            {/* Right: Mock ekID Digital Identity Card */}
            <Surface className="lg:col-span-5 p-6">
              <div className="flex items-center justify-between border-b border-emerald-100 pb-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-[#006a4e]" />
                  <h2 className="font-display text-base font-semibold text-emerald-950">
                    {t.ekIdCardTitle}
                  </h2>
                </div>
                <span
                  className={`text-xs font-semibold ${
                    user.ekIdVerified ? 'text-[#006a4e]' : 'text-amber-700'
                  }`}
                >
                  {user.ekIdVerified ? t.ekIdVerified : t.ekIdUnverified}
                </span>
              </div>

              {user.ekIdVerified ? (
                <div className="mt-5 space-y-4">
                  <div className="rounded-md border border-emerald-200/80 bg-emerald-50/40 p-4 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600">{t.nid10DigitLabel}</span>
                      <span className="font-mono font-semibold text-emerald-950 tabular-nums">
                        {user.nidMock}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600">{t.ekIdTokenLabel}</span>
                      <span className="font-mono font-semibold text-[#006a4e]">{user.ekIdToken}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600">{t.jurisdictionLabel}</span>
                      <span className="text-emerald-950">
                        {user.district}, {user.division}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-600">{t.ekIdVerifiedDesc}</p>
                </div>
              ) : (
                <form onSubmit={handleVerifyEkId} className="mt-5 space-y-4">
                  <p className="text-xs leading-relaxed text-slate-600">{t.ekIdPendingDesc}</p>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      {t.nidLabel}
                    </label>
                    <Input
                      required
                      maxLength={10}
                      pattern="\d{10}"
                      value={nidInput}
                      onChange={(e) => setNidInput(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      placeholder="1995269104"
                      className="font-mono tabular-nums"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={saving}>
                    <ShieldCheck className="h-4 w-4" />
                    <span>{t.verifyEkIdNow}</span>
                  </Button>
                </form>
              )}
            </Surface>
          </div>
        )}

        {/* TAB 2: NATIONAL SCHEMA & SLA CATALOG */}
        {activeTab === 'catalog' && (
          <div className="space-y-8">
            {/* Live Record Counts */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Surface className="p-4">
                <div className="text-xs text-slate-500">{t.departmentsLabel}</div>
                <div className="mt-1 font-mono text-2xl font-semibold text-[#006a4e] tabular-nums">
                  {catalog?.counts?.departments ?? '—'}
                </div>
              </Surface>
              <Surface className="p-4">
                <div className="text-xs text-slate-500">{t.categoriesLabel}</div>
                <div className="mt-1 font-mono text-2xl font-semibold text-[#006a4e] tabular-nums">
                  {catalog?.counts?.categories ?? '—'}
                </div>
              </Surface>
              <Surface className="p-4">
                <div className="text-xs text-slate-500">{t.usersLabel}</div>
                <div className="mt-1 font-mono text-2xl font-semibold text-emerald-950 tabular-nums">
                  {catalog?.counts?.users ?? '—'}
                </div>
              </Surface>
              <Surface className="p-4">
                <div className="text-xs text-slate-500">{t.complaintsLabel}</div>
                <div className="mt-1 font-mono text-2xl font-semibold text-emerald-950 tabular-nums">
                  {catalog?.counts?.complaints ?? '—'}
                </div>
              </Surface>
            </div>

            {/* 6 Departments */}
            <div className="space-y-3">
              <h2 className="font-display text-base font-semibold text-emerald-950">
                {t.sixDeptsHeading}
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {catalog?.departments.map((dept) => (
                  <Surface key={dept.id} className="p-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span className="font-mono font-semibold text-[#006a4e]">{dept.code}</span>
                        <Building2 className="h-3.5 w-3.5 text-emerald-600/70" />
                      </div>
                      <div className="mt-1.5 font-display text-sm font-semibold text-emerald-950">
                        {locale === 'bn' ? dept.nameBn : dept.name}
                      </div>
                      <p className="mt-1 text-xs text-slate-600">
                        {locale === 'bn' ? dept.descriptionBn || dept.description : dept.description}
                      </p>
                    </div>
                  </Surface>
                ))}
              </div>
            </div>

            {/* 20 Categories Table */}
            <Surface className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-emerald-200/80 px-6 py-4">
                <div>
                  <h2 className="font-display text-base font-semibold text-emerald-950">
                    {t.twentyCatsHeading}
                  </h2>
                  <p className="text-xs text-slate-500">{t.twentyCatsSub}</p>
                </div>
                <div className="w-60">
                  <Select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
                    <option value="ALL">{t.allDepartmentsOpt}</option>
                    {catalog?.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code} — {locale === 'bn' ? d.nameBn : d.name.split(' ')[0]}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-emerald-200/80 bg-emerald-50/60 text-emerald-950">
                    <tr>
                      <th className="px-4 py-3 font-medium">{t.colCode}</th>
                      <th className="px-4 py-3 font-medium">{t.colCategory}</th>
                      <th className="px-4 py-3 font-medium">{t.colDept}</th>
                      <th className="px-4 py-3 font-medium">{t.colSlaTier}</th>
                      <th className="px-4 py-3 text-right font-medium">{t.colFirstResp}</th>
                      <th className="px-4 py-3 text-right font-medium">{t.colResolution}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-100">
                    {filteredCategories.map((cat) => (
                      <tr key={cat.id} className="hover:bg-emerald-50/40">
                        <td className="px-4 py-3 font-mono text-[#006a4e] whitespace-nowrap">
                          {cat.code}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-emerald-950">
                            {locale === 'bn' ? cat.nameBn : cat.nameEn}
                          </div>
                          <div className="text-slate-500">
                            {locale === 'bn' ? cat.nameEn : cat.nameBn}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-600 whitespace-nowrap">
                          {cat.departmentId.replace('dept_', '').toUpperCase()}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`font-medium ${
                              cat.slaTier === 'CRITICAL'
                                ? 'text-red-700'
                                : cat.slaTier === 'STANDARD'
                                  ? 'text-amber-700'
                                  : 'text-emerald-900'
                            }`}
                          >
                            {SLA_TIER_LABELS[cat.slaTier][locale]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                          {cat.firstResponseHours}h
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                          {cat.resolutionDays}d
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Surface>
          </div>
        )}

        {/* TAB 3: ROLE MATRIX & GUARD VERIFICATION */}
        {activeTab === 'roles' && (
          <div className="space-y-6">
            <Surface className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-emerald-100 pb-4">
                <div>
                  <h2 className="font-display text-base font-semibold text-emerald-950">
                    {t.rbacGuardHeading}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">{t.rbacGuardSub}</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={testDirectoryGuard}>
                  <Lock className="h-3.5 w-3.5" />
                  <span>{t.testRoleGuardBtn}</span>
                </Button>
              </div>

              {directoryResult && (
                <div className="mt-4">
                  {directoryResult.status === 200 ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-xs font-medium text-[#006a4e]">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>
                          200 OK — Loaded {directoryResult.users?.length || 0} seeded users across 7 roles.
                        </span>
                      </div>
                      <div className="max-h-56 overflow-y-auto rounded border border-emerald-200/80">
                        <table className="w-full text-left text-xs">
                          <thead className="border-b border-emerald-200/80 bg-emerald-50/70 text-emerald-950 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 font-medium">{t.fullNameLabel}</th>
                              <th className="px-3 py-2 font-medium">Role</th>
                              <th className="px-3 py-2 font-medium">{t.colDept}</th>
                              <th className="px-3 py-2 font-medium">{t.districtLabel}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-emerald-100">
                            {directoryResult.users?.map((u) => (
                              <tr key={u.id} className="hover:bg-emerald-50/40">
                                <td className="px-3 py-2 font-medium text-emerald-950">{u.name}</td>
                                <td className="px-3 py-2 font-mono text-slate-700">{u.role}</td>
                                <td className="px-3 py-2 font-mono text-[#006a4e]">
                                  {u.departmentId ? u.departmentId.replace('dept_', '').toUpperCase() : '—'}
                                </td>
                                <td className="px-3 py-2 text-slate-600">{u.district}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>
                        HTTP {directoryResult.status}: {directoryResult.error}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </Surface>

            <Surface className="overflow-hidden">
              <div className="border-b border-emerald-200/80 px-6 py-4">
                <h2 className="font-display text-base font-semibold text-emerald-950">
                  {t.routeMatrixHeading}
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-emerald-200/80 bg-emerald-50/60 text-emerald-950">
                    <tr>
                      <th className="px-4 py-3 font-medium">{t.colModuleRoute}</th>
                      <th className="px-4 py-3 font-medium">{t.colBuildStage}</th>
                      <th className="px-4 py-3 font-medium">
                        {t.colYourAccess} ({ROLE_LABELS[user.role][locale]})
                      </th>
                      <th className="px-4 py-3 font-medium">{t.colAuthorizedRoles}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-100">
                    {ROUTE_GUARD_MATRIX.map((row) => {
                      const granted = row.allowedRoles.includes(user.role);
                      return (
                        <tr key={row.route} className="hover:bg-emerald-50/40">
                          <td className="px-4 py-3">
                            <div className="font-medium text-emerald-950">
                              {locale === 'bn' ? row.routeBn : row.route}
                            </div>
                            <div className="text-slate-500">
                              {locale === 'bn' ? row.purposeBn : row.purpose}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-700 whitespace-nowrap">
                            {locale === 'bn' ? row.stageBn : row.stage}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={`font-medium ${
                                granted ? 'text-[#006a4e]' : 'text-slate-400'
                              }`}
                            >
                              {granted ? t.accessPermitted : t.accessRestricted}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px] text-slate-600">
                            {row.allowedRoles.join(', ')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Surface>
          </div>
        )}
        {/* TAB 0: ROLE-SCOPED USER COMPLAINT DASHBOARD & NOTIFICATIONS */}
        {activeTab === 'dashboard' && (
          <ComplaintDashboardView
            categories={catalog?.categories || []}
            departments={catalog?.departments || []}
            focusedComplaintId={focusedComplaintId}
            onClearFocusedComplaint={() => setFocusedComplaintId(null)}
          />
        )}

        {activeTab === 'submit' && catalog && (
          <ComplaintSubmitView
            departments={catalog.departments}
            categories={catalog.categories}
            onSubmitted={() => {
              refreshNotifications();
            }}
            onViewInDashboard={openComplaintInDashboard}
          />
        )}

        {activeTab === 'triage' && catalog && (
          <TriageQueueView
            departments={catalog.departments}
            categories={catalog.categories}
          />
        )}

        {activeTab === 'notifications' && (
          <NotificationsView onOpenComplaint={openComplaintInDashboard} />
        )}
      </main>
    </div>
  );
}
