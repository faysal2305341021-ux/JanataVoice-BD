import * as React from 'react';
import { ShieldCheck, KeyRound, LogIn, Globe } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { TRANSLATIONS } from '../lib/i18n.ts';
import { BANGLADESH_DIVISIONS, ROLE_LABELS, type UserRole } from '../types/domain.ts';
import { Button, Input, Select, Surface } from './ui/primitives.tsx';

interface DemoAccount {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  departmentId: string | null;
  division: string;
  district: string;
}

export function AuthPortal() {
  const { locale, setLocale, loginWithCredentials, registerWithEkId, loginWithGoogle } = useAuth();
  const t = TRANSLATIONS[locale];

  const [mode, setMode] = React.useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = React.useState('citizen@janatavoice.gov.bd');
  const [password, setPassword] = React.useState('Demo@2026');

  // Signup / ekID fields
  const [name, setName] = React.useState('');
  const [regEmail, setRegEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [regPassword, setRegPassword] = React.useState('');
  const [nidMock, setNidMock] = React.useState('');
  const [division, setDivision] = React.useState('Dhaka');
  const [district, setDistrict] = React.useState('Dhaka');

  const [demoAccounts, setDemoAccounts] = React.useState<DemoAccount[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch('/api/auth/demo-accounts')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.accounts)) setDemoAccounts(data.accounts);
      })
      .catch(() => {});
  }, []);

  const districts = BANGLADESH_DIVISIONS[division] || ['Dhaka'];

  const handleDivisionChange = (nextDiv: string) => {
    setDivision(nextDiv);
    const list = BANGLADESH_DIVISIONS[nextDiv] || [];
    if (list.length > 0) setDistrict(list[0]);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await loginWithCredentials(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickDemoLogin = async (demoEmail: string) => {
    setError(null);
    setSubmitting(true);
    try {
      await loginWithCredentials(demoEmail, 'Demo@2026');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo sign in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await registerWithEkId({
        name,
        email: regEmail,
        phone,
        password: regPassword,
        nidMock,
        division,
        district,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Clean Top Bar */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-4">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            {t.brandName}
          </span>
          <div className="flex items-center gap-3 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLocale(locale === 'en' ? 'bn' : 'en')}
            >
              <Globe className="h-3.5 w-3.5" />
              <span>{locale === 'en' ? 'বাংলা' : 'English'}</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 items-start">
          {/* Left Column: National Governance Overview + Seeded Role Directory */}
          <div className="lg:col-span-7 space-y-8">
            <div className="space-y-4">
              <p className="text-xs font-medium text-emerald-700">
                {t.gatewayKicker}
              </p>
              <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl max-w-2xl [text-wrap:balance]">
                {t.heroTitle}
              </h1>
              <p className="max-w-2xl text-base leading-relaxed text-slate-600">
                {t.heroSubtitle}
              </p>
            </div>

            {/* Key Architectural Guarantees */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 border-t border-b border-slate-200 py-5">
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">{t.stat1Val}</div>
                <div className="mt-1 text-xs text-slate-600">{t.stat1Desc}</div>
              </div>
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">{t.stat2Val}</div>
                <div className="mt-1 text-xs text-slate-600">{t.stat2Desc}</div>
              </div>
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">{t.stat3Val}</div>
                <div className="mt-1 text-xs text-slate-600">{t.stat3Desc}</div>
              </div>
            </div>

            {/* Compact 1-Click Demo Switcher */}
            <Surface className="p-5">
              <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3">
                <h2 className="font-display text-sm font-semibold text-slate-900">
                  {t.demoAccountsHeading}
                </h2>
                <span className="font-mono text-[11px] text-slate-500">
                  {t.demoAccountsSub}
                </span>
              </div>

              <div className="mt-3.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {demoAccounts.length === 0 ? (
                  <div className="py-4 text-xs text-slate-500">{t.loadingAccounts}</div>
                ) : (
                  demoAccounts.map((acc) => (
                    <button
                      key={acc.id}
                      type="button"
                      disabled={submitting}
                      onClick={() => handleQuickDemoLogin(acc.email)}
                      className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3.5 py-2.5 text-left transition-colors hover:border-emerald-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">
                          {ROLE_LABELS[acc.role][locale]}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500 truncate">
                          <span className="truncate">{acc.name}</span>
                          {acc.departmentId && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono">{acc.departmentId.replace('dept_', '').toUpperCase()}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <LogIn className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
                    </button>
                  ))
                )}
              </div>
            </Surface>
          </div>

          {/* Right Column: Unified Login & ekID Citizen Registration */}
          <div className="lg:col-span-5">
            <Surface className="p-6">
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  {t.signInTitle}
                </h2>
              </div>

              {/* Segmented Tabs */}
              <div className="mt-4 grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode('signin');
                    setError(null);
                  }}
                  className={`rounded px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    mode === 'signin'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t.signInTab}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setError(null);
                  }}
                  className={`rounded px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    mode === 'signup'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t.signUpTab}
                </button>
              </div>

              {error && (
                <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </div>
              )}

              {mode === 'signin' ? (
                <form onSubmit={handleSignIn} className="mt-5 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      {t.emailLabel}
                    </label>
                    <Input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="citizen@janatavoice.gov.bd"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      {t.passwordLabel}
                    </label>
                    <Input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                  </div>

                  <Button type="submit" className="w-full" disabled={submitting}>
                    <KeyRound className="h-4 w-4" />
                    <span>{submitting ? t.signingInBtn : t.signInBtn}</span>
                  </Button>

                  <div className="relative py-2">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-slate-200" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="bg-white px-2 text-slate-400">or</span>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={submitting}
                    onClick={handleGoogle}
                  >
                    <span>{t.googleSignInBtn}</span>
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleRegister} className="mt-5 space-y-3.5">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">
                      {t.fullNameLabel}
                    </label>
                    <Input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Tanvirul Islam"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">
                        {t.emailLabel}
                      </label>
                      <Input
                        type="email"
                        required
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="name@example.com"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">
                        {t.phoneLabel}
                      </label>
                      <Input
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="017XXXXXXXX"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">
                      {t.nidLabel}
                    </label>
                    <Input
                      required
                      maxLength={10}
                      pattern="\d{10}"
                      value={nidMock}
                      onChange={(e) => setNidMock(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      placeholder="10-digit NID (e.g. 1996451029)"
                      className="font-mono tabular-nums"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      {t.nidHint}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">
                        {t.divisionLabel}
                      </label>
                      <Select value={division} onChange={(e) => handleDivisionChange(e.target.value)}>
                        {Object.keys(BANGLADESH_DIVISIONS).map((div) => (
                          <option key={div} value={div}>
                            {div}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">
                        {t.districtLabel}
                      </label>
                      <Select value={district} onChange={(e) => setDistrict(e.target.value)}>
                        {districts.map((dist) => (
                          <option key={dist} value={dist}>
                            {dist}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">
                      {t.passwordLabel}
                    </label>
                    <Input
                      type="password"
                      required
                      minLength={6}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="Minimum 6 characters"
                    />
                  </div>

                  <Button type="submit" className="w-full" disabled={submitting}>
                    <ShieldCheck className="h-4 w-4" />
                    <span>{submitting ? t.verifyingEkIdBtn : t.registerEkIdBtn}</span>
                  </Button>
                </form>
              )}
            </Surface>
          </div>
        </div>
      </main>
    </div>
  );
}
