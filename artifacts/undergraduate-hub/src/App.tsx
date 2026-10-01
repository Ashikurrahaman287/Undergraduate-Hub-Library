import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  LayoutDashboard,
  LibraryBig,
  Heart,
  Menu,
  MoreHorizontal,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import {
  getGetBookQueryKey,
  getListBooksQueryKey,
  getListBorrowRequestsQueryKey,
  getListMyBooksQueryKey,
  getListNotificationsQueryKey,
  getListPaymentsQueryKey,
  getListWishlistQueryKey,
  useGetAdminSession,
  useAdminLogin,
  useCreateBook,
  useCreateBorrowRequest,
  useGetAnalytics,
  useGetBook,
  useGetDashboard,
  useListBooks,
  useListBorrowRequests,
  useListMyBooks,
  useListMembers,
  useListNotifications,
  useListPayments,
  useListWishlist,
  useAddWishlist,
  useMarkNotificationRead,
  useRemoveWishlist,
  useRecordPayment,
  useUpdateBook,
  useUpdateBorrowRequestStatus,
} from '@workspace/api-client-react';
import type { Analytics, Book, BorrowRequest, Dashboard, Member, Payment } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import {
  getSupabaseBrowserClient,
  isSupabaseBrowserConfigured,
} from '@/lib/supabase';
import { WishlistPage } from '@/pages/wishlist-page';
import { AdminMembershipPage, MemberMembershipPage, MembershipStagePreview } from '@/pages/membership-workflow';
import { Link, Redirect, Route, Switch, Router as WouterRouter, useLocation, useParams } from 'wouter';

const queryClient = new QueryClient();
const fallbackBooks: Book[] = [];

type MemberSession = {
  authenticated: boolean;
  user: { userId: string; memberId: string; name: string; phone: string | null; email: string | null } | null;
};

const emptyDashboard: Dashboard = {
  memberName: 'Member',
  activeBook: null,
  dueInDays: 0,
  pendingRequests: 0,
  wishlistCount: 0,
  outstandingFees: 0,
  notifications: [],
};
const emptyRequests: BorrowRequest[] = [];
const emptyMembers: Member[] = [];
const emptyPayments: Payment[] = [];
const emptyAnalytics: Analytics = {
  totalBooks: 0,
  availableBooks: 0,
  borrowedBooks: 0,
  activeMembers: 0,
  pendingRequests: 0,
  monthlyBorrowing: [],
};

function useMemberSession() {
  const [state, setState] = useState<MemberSession | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/member/session', { credentials: 'include' });
      setState((await response.json()) as MemberSession);
    } catch {
      setState({ authenticated: false, user: null });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);
  return { state, loading, refresh };
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <RoutedErrorBoundary />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function RoutedErrorBoundary() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Router /></ErrorBoundary>;
}

function FullPageLoading() {
  return <div className="grid min-h-[100dvh] place-items-center bg-background p-6"><LoadingBlock rows={2} /></div>;
}

async function responseError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || fallback;
  } catch {
    return fallback;
  }
}

function GoogleSignInButton({ label }: { label: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  const signIn = async () => {
    setMessage('');
    if (!isSupabaseBrowserConfigured()) {
      setMessage('Google sign-in is not configured for this deployment yet.');
      return;
    }

    setPending(true);
    try {
      const redirectTo = new URL(
        `${import.meta.env.BASE_URL}auth/callback`,
        window.location.origin,
      ).toString();
      const { error } = await getSupabaseBrowserClient().auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error) throw error;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to start Google sign-in.');
      setPending(false);
    }
  };

  return <div className="space-y-2">
    <Button type="button" variant="outline" onClick={() => void signIn()} disabled={pending}>
      <span aria-hidden="true" className="font-extrabold text-blue-600">G</span>
      {pending ? 'Opening Google…' : label}
    </Button>
    {message && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{message}</p>}
  </div>;
}

function GoogleAuthCallbackPage() {
  const [message, setMessage] = useState('Completing Google sign-in…');

  useEffect(() => {
    let active = true;
    let completed = false;

    const finishSignIn = async (accessToken: string) => {
      if (!active || completed) return;
      completed = true;
      try {
        const response = await fetch('/api/auth/member/google', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ accessToken }),
        });
        if (!response.ok) {
          const error = await responseError(response, 'Unable to complete Google sign-in.');
          if (active) setMessage(error);
          return;
        }
        if (active) window.location.replace(`${import.meta.env.BASE_URL}dashboard`);
      } catch {
        if (active) setMessage('Unable to reach the account service. Please try again.');
      }
    };

    try {
      const client = getSupabaseBrowserClient();
      const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) void finishSignIn(session.access_token);
      });
      void client.auth.getSession().then(({ data, error }) => {
        if (error) {
          if (active) setMessage(error.message);
          return;
        }
        if (data.session) void finishSignIn(data.session.access_token);
        else if (active) setMessage('Google did not return an active session. Please try again.');
      }).catch(() => {
        if (active) setMessage('Unable to read the Google sign-in response. Please try again.');
      });

      return () => {
        active = false;
        subscription.unsubscribe();
      };
    } catch {
      setMessage('Google sign-in is not configured for this deployment yet.');
      return () => {
        active = false;
      };
    }
  }, []);

  return <div className="grid min-h-[100dvh] place-items-center bg-background p-6">
    <div className="w-full max-w-md space-y-4 rounded-3xl border border-border bg-card p-8 text-center shadow-xl">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-accent">Undergraduate Hub</p>
      <h1 className="font-display text-2xl font-extrabold">Google sign-in</h1>
      <p role="status" className="text-sm text-muted-foreground">{message}</p>
      {message !== 'Completing Google sign-in…' && <Link href="/login" className="inline-block text-sm font-bold text-accent-foreground underline">Return to sign in</Link>}
    </div>
  </div>;
}

function AdminSetupPage() {
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [step, setStep] = useState<'identifier' | 'otp' | 'password'>('identifier');
  const [message, setMessage] = useState('');
  const requestOtp = async () => {
    const response = await fetch('/api/auth/admin/request-otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'phone', identifier }) });
    if (!response.ok) { setMessage(await responseError(response, 'Unable to send the verification code.')); return; }
    setStep('otp');
    setMessage('A verification code was sent to the configured administrator mobile number.');
  };
  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    const response = await fetch('/api/auth/admin/verify-otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'phone', identifier, otp }) });
    if (!response.ok) { setMessage(await responseError(response, 'The verification code is invalid or expired.')); return; }
    const payload = (await response.json()) as { verificationToken: string };
    setVerificationToken(payload.verificationToken);
    setStep('password');
    setMessage('');
  };
  const setAdminPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) { setMessage('Passwords do not match.'); return; }
    const response = await fetch('/api/auth/admin/set-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'phone', identifier, password, verificationToken }) });
    setMessage(response.ok ? 'Password created. You can now sign in.' : await responseError(response, 'Unable to create the administrator password.'));
    if (response.ok) setStep('identifier');
  };
  return <div className="grid min-h-[100dvh] place-items-center bg-primary p-6"><form onSubmit={step === 'identifier' ? (event) => { event.preventDefault(); void requestOtp(); } : step === 'otp' ? verify : setAdminPassword} className="w-full max-w-md space-y-4 rounded-3xl bg-card p-8 shadow-2xl"><p className="text-xs font-bold uppercase tracking-[0.22em] text-accent">Undergraduate Hub</p><h1 className="font-display text-3xl font-extrabold">Administrator setup</h1><p className="text-sm text-muted-foreground">{step === 'identifier' ? 'Verify one of the configured administrator mobile numbers.' : step === 'otp' ? 'Enter the six-digit code sent to the administrator mobile number.' : 'Choose a password for future administrator logins.'}</p>{step === 'identifier' && <label className="block text-sm font-bold">Administrator mobile number<input type="tel" inputMode="tel" autoComplete="tel" required value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="01XXXXXXXXX or +8801XXXXXXXXX" className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" /></label>}{step === 'otp' && <label className="block text-sm font-bold">Verification code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={otp} onChange={(event) => setOtp(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" /></label>}{step === 'password' && <><label className="block text-sm font-bold">New password<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" /></label><label className="block text-sm font-bold">Confirm password<input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" /></label></>}<Button type="submit">{step === 'identifier' ? 'Send OTP' : step === 'otp' ? 'Verify OTP' : 'Create password'}</Button>{message && <p className="rounded-xl bg-muted p-3 text-sm">{message}</p>}<Link href="/admin/login" className="block text-sm font-bold text-accent-foreground underline">Return to admin login</Link></form></div>;
}

function AdminEmailLoginPage({ onAuthenticated }: { onAuthenticated: () => void }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [rememberSession, setRememberSession] = useState(false);
    const [message, setMessage] = useState('');
    const [pending, setPending] = useState(false);

    const submit = async (event: React.FormEvent) => {
      event.preventDefault();
      setPending(true);
      setMessage('');
      try {
        const response = await fetch('/api/auth/admin/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ channel: 'email', identifier: email, password, rememberSession }),
        });
        if (response.ok) onAuthenticated();
        else setMessage(await responseError(response, 'Invalid administrator credentials.'));
      } catch {
        setMessage('Unable to reach the account service. Please try again.');
      } finally {
        setPending(false);
      }
    };

    return <div className="grid min-h-[100dvh] place-items-center bg-primary p-6">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-3xl bg-card p-8 shadow-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-accent">Undergraduate Hub</p>
        <h1 className="font-display text-3xl font-extrabold">Admin Portal</h1>
        <label className="block text-sm font-bold">Email address
          <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" />
        </label>
        <label className="block text-sm font-bold">Password
          <input type="password" autoComplete="current-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" />
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={rememberSession} onChange={(event) => setRememberSession(event.target.checked)} />
          Remember Session
        </label>
        <Button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</Button>
        <div className="flex flex-wrap justify-between gap-3 text-sm font-bold">
          <Link href="/admin/forgot-password" className="text-accent-foreground underline">Forgot password?</Link>
          <Link href="/admin/setup" className="text-accent-foreground underline">First-time setup</Link>
        </div>
        {message && <p role="status" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{message}</p>}
      </form>
    </div>;
  }

  function AdminEmailSetupPage() {
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [verificationToken, setVerificationToken] = useState('');
    const [step, setStep] = useState<'email' | 'otp' | 'password'>('email');
    const [message, setMessage] = useState('');
    const [pending, setPending] = useState(false);

    const requestOtp = async () => {
      setPending(true);
      setMessage('');
      try {
        const response = await fetch('/api/auth/admin/request-otp', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ channel: 'email', identifier: email }),
        });
        if (!response.ok) {
          setMessage(await responseError(response, 'Unable to send the verification code.'));
          return;
        }
        setStep('otp');
        setMessage('A verification code was sent to the configured administrator email.');
      } catch {
        setMessage('Unable to reach the account service. Please try again.');
      } finally {
        setPending(false);
      }
    };

    const verifyOtp = async (event: React.FormEvent) => {
      event.preventDefault();
      setPending(true);
      try {
        const response = await fetch('/api/auth/admin/verify-otp', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ channel: 'email', identifier: email, otp }),
        });
        if (!response.ok) {
          setMessage(await responseError(response, 'The verification code is invalid or expired.'));
          return;
        }
        const payload = (await response.json()) as { verificationToken: string };
        setVerificationToken(payload.verificationToken);
        setStep('password');
        setMessage('');
      } catch {
        setMessage('Unable to reach the account service. Please try again.');
      } finally {
        setPending(false);
      }
    };

    const createPassword = async (event: React.FormEvent) => {
      event.preventDefault();
      if (password !== confirmPassword) {
        setMessage('Passwords do not match.');
        return;
      }
      setPending(true);
      try {
        const response = await fetch('/api/auth/admin/set-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ channel: 'email', identifier: email, password, verificationToken }),
        });
        if (response.ok) {
          setStep('email');
          setPassword('');
          setConfirmPassword('');
          setVerificationToken('');
          setMessage('Password created. You can now sign in.');
        } else {
          setMessage(await responseError(response, 'Unable to create the administrator password.'));
        }
      } catch {
        setMessage('Unable to reach the account service. Please try again.');
      } finally {
        setPending(false);
      }
    };

    const submit = step === 'otp' ? verifyOtp : step === 'password' ? createPassword : (event: React.FormEvent) => {
      event.preventDefault();
      void requestOtp();
    };

    return <div className="grid min-h-[100dvh] place-items-center bg-primary p-6">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-3xl bg-card p-8 shadow-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-accent">Undergraduate Hub</p>
        <h1 className="font-display text-3xl font-extrabold">Administrator setup</h1>
        <p className="text-sm text-muted-foreground">{step === 'email' ? 'Verify the configured administrator email address.' : step === 'otp' ? 'Enter the six-digit code sent to your email.' : 'Choose a password for administrator sign-in.'}</p>
        {step === 'email' && <label className="block text-sm font-bold">Email address
          <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" />
        </label>}
        {step === 'otp' && <label className="block text-sm font-bold">Verification code
          <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={otp} onChange={(event) => setOtp(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" />
        </label>}
        {step === 'password' && <>
          <label className="block text-sm font-bold">New password
            <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" />
          </label>
          <label className="block text-sm font-bold">Confirm password
            <input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" />
          </label>
        </>}
        <Button type="submit" disabled={pending}>{pending ? 'Please wait…' : step === 'email' ? 'Send verification code' : step === 'otp' ? 'Verify code' : 'Create password'}</Button>
        {message && <p role="status" className="rounded-xl bg-muted p-3 text-sm">{message}</p>}
        <Link href="/admin/login" className="block text-sm font-bold text-accent-foreground underline">Return to admin login</Link>
      </form>
    </div>;
  }

  function AdminForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState('');
    const [pending, setPending] = useState(false);

    const submit = async (event: React.FormEvent) => {
      event.preventDefault();
      setPending(true);
      setMessage('');
      try {
        const response = await fetch('/api/auth/admin/forgot-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        setMessage(response.ok
          ? 'If an administrator account exists, recovery instructions have been sent.'
          : await responseError(response, 'Unable to start password recovery.'));
      } catch {
        setMessage('Unable to reach the account service. Please try again.');
      } finally {
        setPending(false);
      }
    };

    return <div className="grid min-h-[100dvh] place-items-center bg-primary p-6">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-3xl bg-card p-8 shadow-2xl">
        <h1 className="font-display text-3xl font-extrabold">Admin password recovery</h1>
        <label className="block text-sm font-bold">Email address
          <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" />
        </label>
        <Button type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send recovery link'}</Button>
        {message && <p role="status" className="rounded-xl bg-muted p-3 text-sm">{message}</p>}
        <Link href="/admin/login" className="block text-sm font-bold text-accent-foreground underline">Return to admin login</Link>
      </form>
    </div>;
  }

  function AdminResetPasswordPage() {
    const [accessToken, setAccessToken] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [message, setMessage] = useState('');
    const [pending, setPending] = useState(false);

    useEffect(() => {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const token = params.get('access_token');
      if (token && params.get('type') === 'recovery') {
        setAccessToken(token);
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      } else {
        setMessage('The recovery link is invalid or has expired.');
      }
    }, []);

    const submit = async (event: React.FormEvent) => {
      event.preventDefault();
      if (password !== confirmPassword) {
        setMessage('Passwords do not match.');
        return;
      }
      setPending(true);
      try {
        const response = await fetch('/api/auth/admin/reset-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accessToken, password }),
        });
        setAccessToken('');
        setMessage(response.ok
          ? 'Password updated. You can now sign in.'
          : await responseError(response, 'The recovery link is invalid or has expired.'));
      } catch {
        setMessage('Unable to reach the account service. Please try again.');
      } finally {
        setPending(false);
      }
    };

    return <div className="grid min-h-[100dvh] place-items-center bg-primary p-6">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-3xl bg-card p-8 shadow-2xl">
        <h1 className="font-display text-3xl font-extrabold">Set a new admin password</h1>
        <label className="block text-sm font-bold">New password
          <input type="password" autoComplete="new-password" minLength={12} required disabled={!accessToken} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" />
        </label>
        <label className="block text-sm font-bold">Confirm password
          <input type="password" autoComplete="new-password" minLength={12} required disabled={!accessToken} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" />
        </label>
        <Button type="submit" disabled={pending || !accessToken}>{pending ? 'Updating…' : 'Update password'}</Button>
        {message && <p role="status" className="rounded-xl bg-muted p-3 text-sm">{message}</p>}
        <Link href="/admin/login" className="block text-sm font-bold text-accent-foreground underline">Return to admin login</Link>
      </form>
    </div>;
  }

  function MemberCredentialLoginPage({ onAuthenticated }: { onAuthenticated?: () => void }) {
    const [channel, setChannel] = useState<AuthChannel>('phone');
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [message, setMessage] = useState('');
    const [pending, setPending] = useState(false);

    const submit = async (event: React.FormEvent) => {
      event.preventDefault();
      setPending(true);
      try {
        const response = await fetch('/api/auth/member/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ channel, identifier, password }),
        });
        if (response.ok) onAuthenticated?.();
        else setMessage(await responseError(response, 'Invalid email or mobile number or password.'));
      } catch {
        setMessage('Unable to reach the account service. Please try again.');
      } finally {
        setPending(false);
      }
    };

    return <div className="grid min-h-[100dvh] place-items-center bg-background p-6">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-3xl border border-border bg-card p-8 shadow-xl">
        <h1 className="font-display text-3xl font-extrabold">Member sign in</h1>
        <p className="text-sm text-muted-foreground">Sign in with Google or your email or mobile number and password.</p>
        <GoogleSignInButton label="Continue with Google" />
        <ChannelSelector channel={channel} onChange={(nextChannel) => { setChannel(nextChannel); setIdentifier(''); }} />
        <label className="block text-sm font-bold">{channel === 'email' ? 'Email address' : 'Mobile number'}
          <input type={channel === 'email' ? 'email' : 'tel'} inputMode={channel === 'phone' ? 'tel' : undefined} autoComplete={channel === 'email' ? 'email' : 'tel'} required value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder={channel === 'phone' ? '01XXXXXXXXX or +8801XXXXXXXXX' : 'you@example.com'} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" />
        </label>
        <label className="block text-sm font-bold">Password
          <input type="password" autoComplete="current-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" />
        </label>
        <Button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</Button>
        <div className="flex flex-wrap justify-between gap-3 text-sm font-bold">
          <Link href="/create-account" className="text-accent-foreground underline">Create account</Link>
          <Link href="/forgot-password" className="text-accent-foreground underline">Forgot password?</Link>
        </div>
        {message && <p role="status" className="rounded-xl bg-muted p-3 text-sm">{message}</p>}
        <Link href="/" className="block text-sm font-bold text-accent-foreground underline">Continue browsing books</Link>
      </form>
    </div>;
  }


type AuthChannel = 'phone' | 'email';

function ChannelSelector({ channel, onChange }: { channel: AuthChannel; onChange: (channel: AuthChannel) => void }) {
  return <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1" role="tablist" aria-label="Verification method">
    {(['phone', 'email'] as const).map((option) => <button key={option} type="button" role="tab" aria-selected={channel === option} onClick={() => onChange(option)} className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${channel === option ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
      {option === 'phone' ? 'Phone number' : 'Email address'}
    </button>)}
  </div>;
}

function LegacyMemberPasswordFlowPage({ mode }: { mode: 'signup' | 'reset' }) {
  const [channel, setChannel] = useState<AuthChannel>('phone');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [step, setStep] = useState<'identifier' | 'otp' | 'password'>('identifier');
  const [message, setMessage] = useState('');
  const purpose = mode === 'signup' ? 'member_signup' : 'member_reset';
  const requestOtp = async () => {
    const response = await fetch('/api/auth/member/request-otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: identifier, purpose }) });
    if (!response.ok) { setMessage(await responseError(response, 'Unable to send the verification code.')); return; }
    setStep('otp');
    setMessage('A verification code was sent to your mobile number.');
  };
  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    const response = await fetch('/api/auth/member/verify-otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: identifier, otp, purpose }) });
    if (!response.ok) { setMessage(await responseError(response, 'The verification code is invalid or expired.')); return; }
    const payload = (await response.json()) as { verificationToken: string };
    setVerificationToken(payload.verificationToken);
    setStep('password');
    setMessage('');
  };
  const setPasswordForMember = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) { setMessage('Passwords do not match.'); return; }
    const response = await fetch('/api/auth/member/set-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: identifier, password, verificationToken, purpose }) });
    setMessage(response.ok ? mode === 'signup' ? 'Account created. You can now sign in.' : 'Password updated. You can now sign in.' : await responseError(response, 'Unable to save the password.'));
    if (response.ok) setStep('identifier');
  };
  const title = mode === 'signup' ? 'Create member account' : 'Forgot password';
  return <div className="grid min-h-[100dvh] place-items-center bg-background p-6"><form onSubmit={step === 'identifier' ? (event) => { event.preventDefault(); void requestOtp(); } : step === 'otp' ? verify : setPasswordForMember} className="w-full max-w-md space-y-4 rounded-3xl border border-border bg-card p-8 shadow-xl"><p className="text-xs font-bold uppercase tracking-[0.22em] text-accent">Undergraduate Hub</p><h1 className="font-display text-3xl font-extrabold">{title}</h1><p className="text-sm text-muted-foreground">{step === 'identifier' ? 'Choose phone or email to receive a one-time verification code.' : step === 'otp' ? `Enter the six-digit code sent to your ${channel === 'phone' ? 'mobile number' : 'email address'}.` : 'Choose a password for future logins.'}</p>{step === 'identifier' && <><ChannelSelector channel={channel} onChange={setChannel} /><label className="block text-sm font-bold">{channel === 'phone' ? 'Mobile number' : 'Email address'}<input type={channel === 'phone' ? 'tel' : 'email'} inputMode={channel === 'phone' ? 'tel' : undefined} autoComplete={channel === 'phone' ? 'tel' : 'email'} required value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder={channel === 'phone' ? '01XXXXXXXXX or +8801XXXXXXXXX' : 'you@example.com'} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" /></label></>}{step === 'otp' && <label className="block text-sm font-bold">Verification code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={otp} onChange={(event) => setOtp(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" /></label>}{step === 'password' && <><label className="block text-sm font-bold">New password<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" /></label><label className="block text-sm font-bold">Confirm password<input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" /></label></>}<Button type="submit">{step === 'identifier' ? 'Send OTP' : step === 'otp' ? 'Verify OTP' : mode === 'signup' ? 'Create account' : 'Save new password'}</Button>{message && <p className="rounded-xl bg-muted p-3 text-sm">{message}</p>}<Link href="/login" className="block text-sm font-bold text-accent-foreground underline">Return to member login</Link></form></div>;
}

function MemberPasswordFlowPage({ mode }: { mode: 'signup' | 'reset' }) {
  const [channel, setChannel] = useState<AuthChannel>('phone');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [step, setStep] = useState<'identifier' | 'otp' | 'password'>('identifier');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const purpose = mode === 'signup' ? 'member_signup' : 'member_reset';

  const requestOtp = async () => {
    setPending(true);
    setMessage('');
    try {
      const response = await fetch('/api/auth/member/request-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(channel === 'email'
          ? { channel, email: identifier, purpose }
          : { channel, phone: identifier, purpose }),
      });
      if (!response.ok) {
        setMessage(await responseError(response, 'Unable to send the verification code.'));
        return;
      }
      setStep('otp');
      setMessage(`A verification code was sent to your ${channel === 'email' ? 'email address' : 'mobile number'}.`);
    } catch {
      setMessage('Unable to reach the account service. Please try again.');
    } finally {
      setPending(false);
    }
  };

  const verifyOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setMessage('');
    try {
      const response = await fetch('/api/auth/member/verify-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(channel === 'email'
          ? { channel, email: identifier, otp, purpose }
          : { channel, phone: identifier, otp, purpose }),
      });
      if (!response.ok) {
        setMessage(await responseError(response, 'The verification code is invalid or expired.'));
        return;
      }
      const payload = (await response.json()) as { verificationToken: string };
      setVerificationToken(payload.verificationToken);
      setStep('password');
    } catch {
      setMessage('Unable to reach the account service. Please try again.');
    } finally {
      setPending(false);
    }
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setMessage('Passwords do not match.');
      return;
    }
    setPending(true);
    setMessage('');
    try {
      const response = await fetch('/api/auth/member/set-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(channel === 'email'
          ? { channel, email: identifier, password, verificationToken, purpose }
          : { channel, phone: identifier, password, verificationToken, purpose }),
      });
      setMessage(response.ok
        ? mode === 'signup' ? 'Account created. You can now sign in.' : 'Password updated. You can now sign in.'
        : await responseError(response, 'Unable to save the password.'));
      if (response.ok) {
        setStep('identifier');
        setOtp('');
        setPassword('');
        setConfirmPassword('');
        setVerificationToken('');
      }
    } catch {
      setMessage('Unable to reach the account service. Please try again.');
    } finally {
      setPending(false);
    }
  };

  const title = mode === 'signup' ? 'Create member account' : 'Forgot password';
  const submit = step === 'otp' ? verifyOtp : step === 'password' ? savePassword : (event: React.FormEvent) => {
    event.preventDefault();
    void requestOtp();
  };

  return <div className="grid min-h-[100dvh] place-items-center bg-background p-6">
    <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-3xl border border-border bg-card p-8 shadow-xl">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-accent">Undergraduate Hub</p>
      <h1 className="font-display text-3xl font-extrabold">{title}</h1>
      {mode === 'signup' && step === 'identifier' && <>
        <p className="text-sm text-muted-foreground">Create an account with Google or verify your phone or email.</p>
        <GoogleSignInButton label="Sign up with Google" />
        <div className="flex items-center gap-3 text-xs font-semibold text-muted-foreground"><span className="h-px flex-1 bg-border" /><span>OR VERIFY WITH {channel === 'email' ? 'EMAIL' : 'PHONE'}</span><span className="h-px flex-1 bg-border" /></div>
      </>}
      {mode === 'reset' && step === 'identifier' && <p className="text-sm text-muted-foreground">Enter the phone or email linked to your account to receive a reset code.</p>}
      {step === 'otp' && <p className="text-sm text-muted-foreground">Enter the six-digit code sent to your {channel === 'email' ? 'email address' : 'mobile number'}.</p>}
      {step === 'password' && <p className="text-sm text-muted-foreground">Choose a password for future {channel} sign-ins.</p>}
      {step === 'identifier' && <>
        <ChannelSelector channel={channel} onChange={(nextChannel) => { setChannel(nextChannel); setIdentifier(''); }} />
        <label className="block text-sm font-bold">{channel === 'email' ? 'Email address' : 'Mobile number'}
        <input type={channel === 'email' ? 'email' : 'tel'} inputMode={channel === 'phone' ? 'tel' : undefined} autoComplete={channel === 'email' ? 'email' : 'tel'} required value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder={channel === 'phone' ? '01XXXXXXXXX or +8801XXXXXXXXX' : 'you@example.com'} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" />
        </label>
      </>}
      {step === 'otp' && <label className="block text-sm font-bold">Verification code
        <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={otp} onChange={(event) => setOtp(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" />
      </label>}
      {step === 'password' && <>
        <label className="block text-sm font-bold">New password
          <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" />
        </label>
        <label className="block text-sm font-bold">Confirm password
          <input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3" />
        </label>
      </>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Please wait…' : step === 'identifier' ? mode === 'signup' ? 'Send verification code' : 'Send reset code' : step === 'otp' ? 'Verify OTP' : mode === 'signup' ? 'Create account' : 'Save new password'}
      </Button>
      {message && <p role="status" className="rounded-xl bg-muted p-3 text-sm">{message}</p>}
      <Link href="/login" className="block text-sm font-bold text-accent-foreground underline">Return to member login</Link>
    </form>
  </div>;
}

function Router() {
  const [location, setLocation] = useLocation();
  const adminSession = useGetAdminSession();
  const memberSession = useMemberSession();
  const isAdminRoute = location === '/admin' || location.startsWith('/admin/');
  const isMemberRoute = ['/dashboard', '/wishlist', '/my-books', '/requests', '/account', '/membership'].some((path) => location === path || location.startsWith(`${path}/`));
  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    if (isSupabaseBrowserConfigured()) {
      await getSupabaseBrowserClient().auth.signOut({ scope: 'local' });
    }
    await Promise.all([adminSession.refetch(), memberSession.refresh()]);
    queryClient.clear();
    setLocation('/');
  };

  if (location === '/auth/callback') return <GoogleAuthCallbackPage />;
  if (location === '/admin/login') return <AdminEmailLoginPage onAuthenticated={() => { void adminSession.refetch(); setLocation('/admin'); }} />;
  if (location === '/admin/setup') return <AdminEmailSetupPage />;
  if (location === '/admin/forgot-password') return <AdminForgotPasswordPage />;
  if (location === '/admin/reset-password') return <AdminResetPasswordPage />;
  if (location === '/create-account') return <MemberPasswordFlowPage mode="signup" />;
  if (location === '/forgot-password') return <MemberPasswordFlowPage mode="reset" />;
  if (isAdminRoute) {
    if (adminSession.isLoading) return <FullPageLoading />;
    if (!adminSession.data?.authenticated) return <Redirect to="/admin/login" />;
    return <Shell adminMode adminUser={adminSession.data.user} onLogout={logout}><Switch>
        <Route path="/" component={HomePage} />
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/admin/books" component={InventoryPage} />
        <Route path="/admin/requests" component={AdminRequestsPage} />
        <Route path="/admin/members" component={MembersPage} />
        <Route path="/admin/payments" component={PaymentsPage} />
        <Route path="/admin/membership" component={AdminMembershipPage} />
        <Route path="/admin/analytics" component={AnalyticsPage} />
        <Route component={NotFound} />
      </Switch></Shell>;
  }

  if (isMemberRoute && !memberSession.loading && !memberSession.state?.authenticated) {
    return <MemberCredentialLoginPage onAuthenticated={() => { void memberSession.refresh(); setLocation(location); }} />;
  }

  return <Shell adminUser={adminSession.data?.user ?? null} memberUser={memberSession.state?.user ?? null} onLogout={logout}><Switch>
    <Route path="/" component={HomePage} />
    <Route path="/dashboard" component={MemberDashboard} />
    <Route path="/books" component={BooksPage} />
    <Route path="/books/:id" component={BookDetailPage} />
    <Route path="/wishlist" component={WishlistPage} />
    <Route path="/my-books" component={MyBooksPage} />
    <Route path="/requests" component={RequestsPage} />
    <Route path="/account" component={AccountPage} />
     <Route path="/membership" component={MemberMembershipPage} />
    <Route path="/login"><MemberCredentialLoginPage onAuthenticated={() => { void memberSession.refresh(); setLocation('/dashboard'); }} /></Route>
    <Route component={NotFound} />
  </Switch></Shell>;
}

function Shell({ children, adminMode = false, adminUser, memberUser, onLogout }: { children: ReactNode; adminMode?: boolean; adminUser?: { email: string; name: string; role: string } | null; memberUser?: { userId: string; memberId: string; name: string; phone: string | null; email: string | null } | null; onLogout: () => void }) {
  const [mobileNav, setMobileNav] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const today = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
  const memberNav = [{ href: '/', label: 'Home', bn: 'হোম', icon: LayoutDashboard }, { href: '/books', label: 'Find a book', bn: 'বই খুঁজুন', icon: BookOpen }, { href: '/membership', label: 'Membership', bn: 'সদস্যতা', icon: ShieldCheck }, { href: '/my-books', label: 'My books', bn: 'আমার বই', icon: LibraryBig }, { href: '/wishlist', label: 'Wishlist', bn: 'পছন্দের বই', icon: Heart }, { href: '/requests', label: 'My requests', bn: 'আমার অনুরোধ', icon: Clock3 }, { href: '/account', label: 'Account', bn: 'অ্যাকাউন্ট', icon: UserRound }];
  const staffNav = [{ href: '/admin', label: 'Staff overview', icon: LayoutDashboard }, { href: '/admin/books', label: 'Inventory', icon: Boxes }, { href: '/admin/requests', label: 'Requests', icon: PackageCheck }, { href: '/admin/membership', label: 'Membership ops', icon: ShieldCheck }, { href: '/admin/members', label: 'Members', icon: Users }, { href: '/admin/payments', label: 'Payments', icon: WalletCards }, { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 }];
  const nav = adminMode ? staffNav : memberNav;
  const [location] = useLocation();
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[276px] flex-col bg-sidebar px-5 py-6 text-sidebar-foreground transition-transform duration-300 lg:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-start justify-between">
          <Link href="/" className="flex items-center gap-3" data-testid="link-brand">
            <span className="grid size-10 place-items-center rounded-xl bg-sidebar-primary text-primary-foreground shadow-sm"><LibraryBig size={21} /></span>
            <span><span className="block font-display text-lg font-extrabold tracking-tight">Undergraduate</span><span className="block text-[11px] uppercase tracking-[0.25em] text-sidebar-foreground/60">HUB · ঢাকা</span></span>
          </Link>
          <button className="text-sidebar-foreground/60 lg:hidden" onClick={() => setMobileNav(false)} data-testid="button-close-navigation"><X size={18} /></button>
        </div>
         <p className="mb-3 mt-9 px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-sidebar-foreground/40">{adminMode ? 'Operations desk' : 'আপনার লাইব্রেরি'}</p>
        <nav className="space-y-1">
          {nav.map((item) => { const Icon = item.icon; const active = location === item.href || (item.href !== '/' && location.startsWith(item.href)); const banglaLabel = 'bn' in item ? (item as { bn?: string }).bn : undefined; return <Link key={item.href} href={item.href} onClick={() => setMobileNav(false)} className={`group flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition-all ${active ? 'bg-sidebar-accent text-sidebar-primary shadow-inner' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`} data-testid={`link-nav-${item.label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={18} strokeWidth={active ? 2.4 : 1.8} /><span className="flex-1">{item.label}{banglaLabel && <span className="ml-2 text-[10px] opacity-50">{banglaLabel}</span>}</span>{item.label === 'Requests' && <span className="rounded-full bg-sidebar-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">18</span>}</Link>; })}
        </nav>
        <div className="mt-auto rounded-2xl border border-sidebar-border bg-sidebar-accent/45 p-4">
          <div className="mb-3 flex items-center gap-2 text-sidebar-primary"><ShieldCheck size={17} /><span className="text-xs font-bold">বিশ্বস্ত সদস্য সেবা</span></div>
          <p className="text-[11px] leading-relaxed text-sidebar-foreground/55">বই নিন, সময়মতো ফেরত দিন। প্রতিটি ধাপের খবর আমরা জানাব।</p>
          <button onClick={() => alert('লাইব্রেরি: রোড ৬, ধানমন্ডি, ঢাকা · প্রতিদিন ৯টা–৬টা')} className="mt-3 text-xs font-semibold text-sidebar-primary hover:underline" data-testid="button-library-hours">Library hours <ArrowRight className="ml-1 inline" size={12} /></button>
        </div>
      </aside>
      {mobileNav && <button className="fixed inset-0 z-30 bg-foreground/30 lg:hidden" onClick={() => setMobileNav(false)} aria-label="Close navigation" data-testid="button-navigation-backdrop" />}
      <div className="lg:pl-[276px]">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur-md sm:px-8">
          <div className="flex items-center gap-3"><button onClick={() => setMobileNav(true)} className="rounded-lg p-2 hover:bg-muted lg:hidden" data-testid="button-open-navigation"><Menu size={20} /></button><div className="hidden text-sm text-muted-foreground sm:block">{adminMode ? 'Staff desk / ' : ''}<span className="font-semibold text-foreground">{adminMode ? 'Today at the library' : today}</span></div></div>
           <div className="flex items-center gap-2 sm:gap-4">{!adminMode && memberUser && <NotificationBell />}<div className="hidden h-7 w-px bg-border sm:block" /><div className="relative"><button className="flex items-center gap-2 rounded-xl py-1.5 pl-1.5 pr-2 transition-colors hover:bg-muted" onClick={() => setAccountOpen((value) => !value)} data-testid="button-account-menu"><span className="grid size-8 place-items-center rounded-lg bg-secondary text-xs font-extrabold text-primary">{adminMode ? 'A' : memberUser ? memberUser.name.slice(0, 2).toUpperCase() : '?'}</span><span className="hidden text-left sm:block"><span className="block text-xs font-bold">{adminMode ? adminUser?.name : memberUser?.name ?? 'Guest'}</span><span className="block text-[10px] text-muted-foreground">{adminMode ? 'Admin Portal' : memberUser ? 'Member' : 'Not signed in'}</span></span><ChevronDown size={14} className="text-muted-foreground" /></button>{accountOpen && <div className="absolute right-0 top-12 z-50 min-w-48 rounded-2xl border border-border bg-card p-2 shadow-xl">{adminUser && !adminMode && <Link href="/admin" onClick={() => setAccountOpen(false)} className="block rounded-xl px-3 py-2 text-sm font-bold hover:bg-muted">Admin Panel</Link>}{!memberUser && !adminMode && <Link href="/login" onClick={() => setAccountOpen(false)} className="block rounded-xl px-3 py-2 text-sm font-bold hover:bg-muted">Member sign in</Link>} {(adminMode || memberUser) && <button onClick={onLogout} className="w-full rounded-xl px-3 py-2 text-left text-sm font-bold text-rose-700 hover:bg-rose-50">Sign out</button>}</div>}</div></div>
        </header>
        <main className="mx-auto max-w-[1440px] px-5 py-7 pb-24 sm:px-8 lg:px-10 lg:pb-7">{children}</main>
      </div>
       {!adminMode && <nav aria-label="Member navigation" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-card/95 px-1 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_22px_hsl(187_35%_16%/.07)] backdrop-blur lg:hidden">{[{ href: '/', label: 'Home', icon: LayoutDashboard }, { href: '/books', label: 'Search', icon: Search }, { href: '/my-books', label: 'My books', icon: LibraryBig }, { href: '/wishlist', label: 'Wishlist', icon: Heart }, { href: '/account', label: 'Profile', icon: UserRound }].map((item) => { const Icon = item.icon; const active = location === item.href || (item.href !== '/' && location.startsWith(item.href)); return <Link key={item.href} href={item.href} className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-bold transition-colors ${active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`} aria-current={active ? 'page' : undefined}><Icon size={18} /><span>{item.label}</span></Link>; })}</nav>}
    </div>
  );
}

function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mb-2 text-[11px] font-bold uppercase tracking-[0.22em] text-accent">{eyebrow}</p><h1 className="font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{title}</h1>{description && <p className="mt-2 max-w-xl text-sm text-muted-foreground">{description}</p>}</div>{action}</div>;
}
function StatusPill({ status }: { status?: string }) {
  const value = status || 'pending'; const cls = value === 'available' || value === 'approved' || value === 'verified' || value === 'active' || value === 'paid' ? 'bg-emerald-50 text-emerald-700' : value === 'rented' || value === 'borrowed' || value === 'pending' || value === 'awaiting' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700';
  const label: Record<string, string> = { available: 'Available', rented: 'Borrowed', borrowed: 'Borrowed', approved: 'Approved', pending: 'Pending', rejected: 'Declined', verified: 'Verified', active: 'Active', paused: 'Paused', paid: 'Paid', awaiting: 'Awaiting' };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${cls}`} data-testid={`status-${value}`}>{label[value] || value}</span>;
}
function Metric({ label, value, detail, icon: Icon, tone = 'default' }: { label: string; value: string | number; detail: string; icon: typeof BookOpen; tone?: 'default' | 'gold' | 'coral' }) {
  return <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-[0_7px_20px_hsl(187_35%_16%/0.04)] transition-transform duration-300 hover:-translate-y-0.5"><div className="mb-5 flex items-start justify-between"><span className="text-xs font-semibold text-muted-foreground">{label}</span><span className={`grid size-9 place-items-center rounded-xl ${tone === 'gold' ? 'bg-accent/20 text-accent-foreground' : tone === 'coral' ? 'bg-accent/15 text-accent' : 'bg-secondary text-primary'}`}><Icon size={17} /></span></div><div className="font-display text-3xl font-extrabold tracking-tight" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</div><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}
function LoadingBlock({ rows = 4 }: { rows?: number }) { return <div className="space-y-3" aria-label="Loading"><div className="h-5 w-40 animate-pulse rounded bg-muted" />{Array.from({ length: rows }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/70" />)}</div>; }
function ErrorNotice({ onRetry }: { onRetry?: () => void }) { return <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" data-testid="status-error"><span className="flex items-center gap-2"><AlertCircle size={16} /> তথ্য আনা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।</span>{onRetry && <button onClick={onRetry} className="font-bold underline" data-testid="button-retry">Retry</button>}</div>; }
function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) { return <div className="rounded-2xl border border-dashed border-border bg-card/60 px-6 py-14 text-center"><span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-secondary text-primary"><BookOpen size={22} /></span><h3 className="font-display text-lg font-bold">{title}</h3><p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{body}</p>{action && <div className="mt-5">{action}</div>}</div>; }
function Button({ children, onClick, variant = 'primary', type = 'button', disabled, testId }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'outline' | 'ghost'; type?: 'button' | 'submit'; disabled?: boolean; testId?: string }) { return <button type={type} disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${variant === 'primary' ? 'bg-primary text-primary-foreground shadow-sm hover:-translate-y-0.5 hover:bg-primary/90' : variant === 'outline' ? 'border border-border bg-card text-foreground hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} data-testid={testId}>{children}</button>; }

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const query = useListNotifications();
  const notifications = query.data ?? [];
  const unread = notifications.filter((item) => !item.isRead).length;
  const markRead = useMarkNotificationRead();
  const client = useQueryClient();
  const mark = (id: string) => markRead.mutate({ id }, { onSuccess: () => client.invalidateQueries({ queryKey: getListNotificationsQueryKey() }) });
  return <div className="relative"><button className="relative rounded-xl p-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => setOpen((value) => !value)} data-testid="button-notifications"><Bell size={18} />{unread > 0 && <span className="absolute right-1.5 top-1.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold text-accent-foreground">{unread}</span>}</button>{open && <div className="absolute right-0 top-12 z-50 w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-border bg-card p-3 shadow-xl"><div className="flex items-center justify-between px-2 pb-2"><h3 className="font-display font-bold">Notifications</h3><span className="text-[10px] text-muted-foreground">Internal updates</span></div>{notifications.length === 0 ? <p className="px-2 py-5 text-sm text-muted-foreground">এখনও কোনো নোটিফিকেশন নেই।</p> : <div className="max-h-80 space-y-1 overflow-auto">{notifications.map((item) => <button key={item.id} onClick={() => mark(item.id)} className={`w-full rounded-xl p-3 text-left transition-colors hover:bg-muted ${item.isRead ? 'opacity-60' : 'bg-secondary/50'}`}><div className="flex gap-2"><Bell size={15} className="mt-0.5 shrink-0 text-accent-foreground" /><span><strong className="block text-xs">{item.title}</strong><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{item.message}</span></span></div></button>)}</div>}</div>}</div>;
}

function HomePage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [language, setLanguage] = useState('all');
  const [status, setStatus] = useState('available');
  const [page, setPage] = useState(1);
  const params = useMemo(() => ({ search: search || undefined, category: category === 'all' ? undefined : category, language: language === 'all' ? undefined : language, status: status === 'all' ? undefined : status, page, pageSize: 24 }), [search, category, language, status, page]);
  const query = useListBooks(params);
  const featuredQuery = useListBooks({ page: 1, pageSize: 4, sort: 'popular' });
  const recentQuery = useListBooks({ page: 1, pageSize: 4, sort: 'recent' });
  const books = query.data ?? [];
  const categories = [...new Set(books.map((book) => book.category))];
  return <><section className="relative overflow-hidden rounded-3xl bg-primary px-6 py-8 text-primary-foreground shadow-[0_16px_36px_hsl(187_35%_16%/.14)] sm:px-10 sm:py-12"><div className="absolute -right-20 -top-24 size-72 rounded-full bg-accent/20 blur-3xl" /><div className="relative max-w-3xl"><p className="text-xs font-bold uppercase tracking-[0.22em] text-accent">Undergraduate Hub · Dhaka</p><h1 className="mt-3 max-w-2xl font-display text-3xl font-extrabold tracking-tight sm:text-5xl">আপনার পরের ভালো বইটি খুঁজে নিন।</h1><p className="mt-4 max-w-xl text-sm leading-relaxed text-primary-foreground/70 sm:text-base">১২শ’র বেশি বই থেকে বিষয়, ভাষা, অথবা লেখকের নামে খুঁজুন। পছন্দের বই wishlist-এ রাখুন, তারপর pickup slot বেছে নিন।</p><label className="relative mt-7 block max-w-2xl"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-primary-foreground/50" size={19} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="বই, লেখক বা বিষয় খুঁজুন..." className="h-14 w-full rounded-2xl border border-primary-foreground/10 bg-primary-foreground/10 pl-12 pr-4 text-sm text-primary-foreground outline-none placeholder:text-primary-foreground/50 focus:ring-2 focus:ring-accent" data-testid="input-home-search" /></label></div></section><section className="mt-6 rounded-2xl border border-border bg-card p-4"><div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"><div className="flex flex-wrap gap-2">{['all', ...categories].map((item) => <button key={item} onClick={() => { setCategory(item); setPage(1); }} className={`rounded-full px-3 py-2 text-xs font-bold transition-colors ${category === item ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`} data-testid={`filter-category-${item}`}>{item === 'all' ? 'All categories' : item}</button>)}</div><div className="flex flex-wrap gap-2"><select value={language} onChange={(event) => { setLanguage(event.target.value); setPage(1); }} className="h-10 rounded-xl border border-border bg-background px-3 text-xs font-bold" data-testid="select-home-language"><option value="all">All languages</option><option value="English">English</option><option value="Bangla">Bangla</option></select><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="h-10 rounded-xl border border-border bg-background px-3 text-xs font-bold" data-testid="select-home-availability"><option value="available">Available only</option><option value="all">All books</option><option value="rented">Rented</option><option value="lost">Lost</option></select></div></div></section>{!search && category === 'all' && language === 'all' && <div className="mt-8 space-y-8"><BookSection title="Featured books" eyebrow="Curated for you" books={featuredQuery.data ?? fallbackBooks.slice(0, 4)} /><BookSection title="Recently added" eyebrow="Fresh on the shelf" books={recentQuery.data ?? fallbackBooks.slice(0, 4).reverse()} /></div>}<section className="mt-8"><div className="mb-4 flex items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">Open shelf</p><h2 className="mt-1 font-display text-2xl font-extrabold">{search || category !== 'all' || language !== 'all' ? 'Search results' : 'Popular books'}</h2></div><span className="text-xs text-muted-foreground">Page {page} · up to 24 books</span></div>{query.isLoading ? <LoadingBlock rows={6} /> : query.isError ? <ErrorNotice onRetry={() => query.refetch()} /> : books.length === 0 ? <EmptyState title="এই খোঁজে কোনো বই নেই" body="অন্য শব্দ, ভাষা, অথবা category দিয়ে আবার চেষ্টা করুন।" /> : <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{books.map((book, index) => <BookCard key={book.id} book={book} accent={index} />)}</div><div className="mt-6 flex items-center justify-between"><Button variant="outline" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} testId="button-home-previous"><ChevronLeft size={16} /> Previous</Button><Button variant="outline" onClick={() => setPage((value) => value + 1)} disabled={books.length < 24 || query.isFetching} testId="button-home-next">Next <ChevronRight size={16} /></Button></div></>}</section></>;
}

function BookSection({ title, eyebrow, books }: { title: string; eyebrow: string; books: Book[] }) {
  return <section><div className="mb-4 flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">{eyebrow}</p><h2 className="mt-1 font-display text-2xl font-extrabold">{title}</h2></div><Link href="/books" className="text-xs font-bold text-accent-foreground hover:underline">View all <ArrowRight className="ml-1 inline" size={13} /></Link></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{books.map((book, index) => <BookCard key={book.id} book={book} accent={index} />)}</div></section>;
}

function MemberDashboard() {
  const query = useGetDashboard(); const dashboard = query.data || emptyDashboard;
  const requestsQuery = useListBorrowRequests(); const requests: BorrowRequest[] = requestsQuery.data || emptyRequests;
  return <><PageIntro eyebrow="সুপ্রভাত, Nafisa" title={`আজ কী পড়বেন, ${dashboard.memberName}?`} description="আপনার বই, সংগ্রহের সময়, এবং লাইব্রেরির খবর—সব এক জায়গায়।" action={<Link href="/books" className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-accent-foreground shadow-sm transition-transform hover:-translate-y-0.5" data-testid="link-browse-books"><Search size={16} /> বই খুঁজুন</Link>} />{query.isError && <ErrorNotice onRetry={() => query.refetch()} />}<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Active book" value={dashboard.activeBook ? '01' : '00'} detail={dashboard.activeBook ? `${dashboard.dueInDays} দিন বাকি` : 'No books with you'} icon={BookOpen} /><Metric label="Pending requests" value={dashboard.pendingRequests} detail="আবেদনের আপডেট দেখুন" icon={Clock3} tone="gold" /><Metric label="Wishlist" value={dashboard.wishlistCount} detail="পরে পড়ার জন্য রাখা" icon={Sparkles} tone="coral" /><Metric label="Outstanding fees" value={`৳${dashboard.outstandingFees}`} detail={dashboard.outstandingFees ? 'Payment needed' : 'সব পরিশোধিত'} icon={WalletCards} /></div><div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_0.65fr]"><section className="overflow-hidden rounded-2xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-display text-lg font-bold">Your active reading</h2><p className="mt-0.5 text-xs text-muted-foreground">যে বইটি এখন আপনার কাছে</p></div><Link href="/requests" className="text-xs font-bold text-accent-foreground hover:underline" data-testid="link-view-requests">সব অনুরোধ <ArrowRight className="ml-1 inline" size={13} /></Link></div>{dashboard.activeBook ? <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center"><div className="relative flex h-44 w-32 shrink-0 items-end overflow-hidden rounded-xl bg-primary p-4 shadow-lg"><div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,hsl(40_84%_62%/.3),transparent_50%)]" /><span className="relative text-sm font-bold leading-tight text-primary-foreground">{dashboard.activeBook.title}</span></div><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-accent">Currently reading</p><h3 className="mt-2 font-display text-2xl font-extrabold">{dashboard.activeBook.title}</h3><p className="mt-1 text-sm text-muted-foreground">{dashboard.activeBook.author}</p><div className="mt-5 flex flex-wrap gap-2"><span className="rounded-lg bg-secondary px-3 py-2 text-xs font-bold">ফেরত: {dashboard.activeBook.dueDate}</span><span className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{dashboard.activeBook.daysLeft} days left</span></div></div></div> : <EmptyState title="আপনার কাছে কোনো বই নেই" body="ক্যাটালগ থেকে একটি বই খুঁজে সংগ্রহের অনুরোধ পাঠান।" action={<Link href="/books" className="text-sm font-bold text-accent-foreground underline">ক্যাটালগ দেখুন</Link>} />}</section><section className="rounded-2xl border border-border bg-primary p-5 text-primary-foreground"><div className="flex items-center justify-between"><h2 className="font-display text-lg font-bold">Library note</h2><Bell size={17} className="text-accent" /></div><p className="mt-6 font-serif text-2xl font-semibold leading-snug">“ভালো বইয়ের সঙ্গে সময় কাটানো মানে নিজের সঙ্গে দেখা করা।”</p><div className="mt-8 border-t border-primary-foreground/15 pt-4 text-xs text-primary-foreground/60">ধানমন্ডি হাব · আপনার পড়ার জায়গা</div></section></div><section className="mt-6 rounded-2xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 className="font-display text-lg font-bold">Recent requests <span className="ml-2 text-xs font-normal text-muted-foreground">সাম্প্রতিক অনুরোধ</span></h2><Link href="/requests" className="text-xs font-bold text-accent-foreground" data-testid="link-all-requests">View all</Link></div><div className="divide-y divide-border">{requests.slice(0, 3).map((request) => <div key={request.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`row-request-${request.id}`}><div><p className="text-sm font-bold">{request.bookTitle}</p><p className="mt-1 text-xs text-muted-foreground">Pickup {request.pickupDate} · {request.pickupSlot}</p></div><StatusPill status={request.status} /></div>)}</div></section></>;
}

function BooksPage() {
  const [search, setSearch] = useState(''); const [category, setCategory] = useState('all'); const [language, setLanguage] = useState('all'); const [status, setStatus] = useState('available');
  const params = useMemo(() => ({ search: search || undefined, category: category === 'all' ? undefined : category, language: language === 'all' ? undefined : language, status: status === 'all' ? undefined : status }), [search, category, language, status]);
  const query = useListBooks(params); const books = query.data ?? []; const categories = [...new Set(books.map((book) => book.category))];
  return <><PageIntro eyebrow="The open shelf" title="Find your next useful book." description="বিষয়, ভাষা অথবা লেখকের নামে খুঁজুন। বই পছন্দ হলে সংগ্রহের সময় বেছে অনুরোধ পাঠান।" /><div className="mb-6 rounded-2xl border border-border bg-card p-3 shadow-sm"><div className="flex flex-col gap-3 lg:flex-row"><label className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="বই, লেখক, ISBN বা বিষয় খুঁজুন..." className="h-11 w-full rounded-xl border-0 bg-muted/70 pl-10 pr-4 text-sm outline-none ring-accent transition focus:ring-2" data-testid="input-book-search" /></label><div className="flex flex-wrap gap-2"><select value={category} onChange={(e) => setCategory(e.target.value)} className="h-11 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent" data-testid="select-book-category"><option value="all">All categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={language} onChange={(e) => setLanguage(e.target.value)} className="h-11 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent" data-testid="select-book-language"><option value="all">All languages</option><option value="English">English</option><option value="Bangla">Bangla</option></select><select value={status} onChange={(e) => setStatus(e.target.value)} className="h-11 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent" data-testid="select-book-status"><option value="available">Available now</option><option value="all">All stock</option><option value="rented">Borrowed</option><option value="lost">Lost</option></select></div></div></div>{query.isLoading ? <LoadingBlock rows={5} /> : query.isError ? <ErrorNotice onRetry={() => query.refetch()} /> : books.length === 0 ? <EmptyState title="এই খোঁজে কোনো বই নেই" body="অন্য শব্দ বা বিষয় দিয়ে আবার চেষ্টা করুন।" action={<Button variant="outline" onClick={() => { setSearch(''); setCategory('all'); setLanguage('all'); setStatus('available'); }} testId="button-clear-filters"><RefreshCw size={15} /> Filters clear করুন</Button>} /> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{books.map((book, i) => <BookCard key={book.id} book={book} accent={i % 4} />)}</div>}</>;
}

function MyBooksPage() {
  const query = useListMyBooks();
  const books = query.data ?? [];
  return <><PageIntro eyebrow="Your reading shelf" title="My books" description="আপনার বর্তমান বই, due date, countdown, এবং dynamic late fee এক জায়গায়।" action={<Link href="/books" className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-accent-foreground"><Search size={16} /> Find another book</Link>} />{query.isLoading ? <LoadingBlock rows={2} /> : query.isError ? <ErrorNotice onRetry={() => query.refetch()} /> : books.length === 0 ? <EmptyState title="আপনার কাছে এখন কোনো বই নেই" body="ক্যাটালগ থেকে একটি বই বেছে borrow request পাঠান।" action={<Link href="/books" className="font-bold text-accent-foreground underline">Browse books</Link>} /> : <div className="space-y-4">{books.map((book) => <article key={book.transactionId} className="grid gap-5 rounded-2xl border border-border bg-card p-5 sm:grid-cols-[120px_1fr_auto] sm:items-center" data-testid={`card-my-book-${book.bookId}`}><div className="relative flex h-40 items-end overflow-hidden rounded-xl bg-primary p-3">{book.coverUrl && <img src={book.coverUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover opacity-90" />}<span className="relative font-serif text-sm font-bold leading-tight text-primary-foreground drop-shadow">{book.title}</span></div><div><div className="flex flex-wrap items-center gap-2"><StatusPill status={book.status} />{book.daysRemaining < 0 ? <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700">🔴 {Math.abs(book.daysRemaining)} days overdue</span> : <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">⏳ {book.daysRemaining} days remaining</span>}</div><h2 className="mt-3 font-display text-2xl font-extrabold">{book.title}</h2><p className="mt-1 text-sm text-muted-foreground">{book.author}</p><div className="mt-4 grid gap-3 text-xs sm:grid-cols-3"><div><p className="text-muted-foreground">Borrow date</p><p className="mt-1 font-bold">{book.borrowDate ? new Date(book.borrowDate).toLocaleDateString('en-GB') : '—'}</p></div><div><p className="text-muted-foreground">Due date</p><p className="mt-1 font-bold">{book.dueDate ? new Date(book.dueDate).toLocaleDateString('en-GB') : '—'}</p></div><div><p className="text-muted-foreground">Return status</p><p className="mt-1 font-bold">{book.status === 'returned' ? 'Returned' : 'With you'}</p></div></div></div><div className={`rounded-xl p-4 sm:min-w-32 ${book.lateFee > 0 ? 'bg-rose-50 text-rose-800' : 'bg-secondary text-primary'}`}><p className="text-[10px] font-bold uppercase tracking-widest">Current late fee</p><p className="mt-1 font-display text-2xl font-extrabold">৳{book.lateFee}</p><p className="mt-1 text-[11px] opacity-70">৳9 / late day</p></div></article>)}</div>}</>;
}

function BookCard({ book, accent }: { book: Book; accent: number }) {
  const colors = ['bg-primary', 'bg-[#8a634c]', 'bg-[#3b6870]', 'bg-[#8b5f48]'];
  const wishlist = useListWishlist();
  const add = useAddWishlist();
  const remove = useRemoveWishlist();
  const client = useQueryClient();
  const isWishlisted = wishlist.data?.some((item) => item.id === book.id) ?? false;
  const toggleWishlist = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (isWishlisted) remove.mutate({ bookId: book.id }, { onSuccess: () => client.invalidateQueries({ queryKey: getListWishlistQueryKey() }) });
    else add.mutate({ data: { bookId: book.id } }, { onSuccess: () => client.invalidateQueries({ queryKey: getListWishlistQueryKey() }) });
  };
  return <article className="group overflow-hidden rounded-2xl border border-border bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_14px_28px_hsl(187_35%_16%/0.1)]" data-testid={`card-book-${book.id}`}><Link href={`/books/${book.id}`} className="block"><div className={`relative mx-4 mt-4 flex h-52 items-end overflow-hidden rounded-xl p-5 ${colors[accent % colors.length]}`}>{book.coverUrl ? <img src={book.coverUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover opacity-90" /> : <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_15%,hsl(40_84%_62%/.35),transparent_38%)] opacity-80 transition-transform duration-500 group-hover:scale-110" />}<span className="relative max-w-[88%] font-serif text-xl font-bold leading-tight text-primary-foreground drop-shadow-md">{book.title}</span><span className="absolute right-3 top-3 rounded-md border border-primary-foreground/15 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-primary-foreground/70">{book.language}</span></div><div className="p-4"><div className="mb-2 flex items-center justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-[0.15em] text-accent-foreground">{book.category}</span><StatusPill status={book.status} /></div><h3 className="line-clamp-2 min-h-10 font-display text-base font-bold">{book.title}</h3><p className="mt-1 truncate text-xs text-muted-foreground">{book.author}</p></div></Link><div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground"><span>{book.depositRequired ? `Deposit ৳${book.depositAmount}` : 'No deposit'}</span><div className="flex items-center gap-1"><button onClick={toggleWishlist} className={`rounded-lg p-2 transition-colors hover:bg-muted ${isWishlisted ? 'text-accent-foreground' : 'text-muted-foreground'}`} aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'} data-testid={`button-wishlist-${book.id}`}>{isWishlisted ? '♥' : '♡'}</button><Link href={`/books/${book.id}`} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label="View details" data-testid={`link-book-details-${book.id}`}><ArrowRight size={15} /></Link></div></div></article>;
}

function BookDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const query = useGetBook(id, { query: { enabled: !!id, queryKey: getGetBookQueryKey(id) } });
  const book = query.data;
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState(() => {
    const pickupDate = new Date();
    pickupDate.setMinutes(pickupDate.getMinutes() - pickupDate.getTimezoneOffset());
    return pickupDate.toISOString().slice(0, 10);
  });
  const [slot, setSlot] = useState('12:00–1:00 PM');
  const [note, setNote] = useState('');
  const mutation = useCreateBorrowRequest();
  const { toast } = useToast();
  const client = useQueryClient();
  if (query.isLoading) return <LoadingBlock rows={4} />;
  if (query.isError) return <ErrorNotice onRetry={() => query.refetch()} />;
  if (!book) return <EmptyState title="Book not found" body="This book is not available in the catalogue." action={<Link href="/books" className="font-bold text-accent-foreground underline">Back to catalogue</Link>} />;
  const submit = () => mutation.mutate({ data: { bookId: book.id, pickupDate: date, pickupSlot: slot, note: note || null } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListBorrowRequestsQueryKey() }); client.invalidateQueries({ queryKey: getListMyBooksQueryKey() }); setShowForm(false); toast({ title: 'আপনার বই নেওয়ার অনুরোধটি পাঠানো হয়েছে', description: 'Admin অনুমোদন করলে আপনাকে জানানো হবে।' }); }, onError: (error) => toast({ title: 'অনুরোধ পাঠানো যায়নি', description: error instanceof Error ? error.message : 'Subscription, active book, deposit, বা availability check করুন।', variant: 'destructive' }) });
  return <><Link href="/books" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-foreground" data-testid="link-back-books">← Back to catalogue</Link>{query.isError && <ErrorNotice onRetry={() => query.refetch()} />}<div className="grid gap-7 lg:grid-cols-[300px_1fr]"><div className="relative flex min-h-[390px] items-end overflow-hidden rounded-3xl bg-primary p-8 shadow-[0_18px_35px_hsl(187_35%_16%_/.16)]">{book.coverUrl ? <img src={book.coverUrl} alt={book.title} loading="eager" decoding="async" className="absolute inset-0 size-full object-cover opacity-90" /> : <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_12%,hsl(40_84%_62%/.42),transparent_35%)]" />}<span className="relative font-serif text-3xl font-bold leading-tight text-primary-foreground drop-shadow-md">{book.title}</span><span className="absolute right-5 top-5 rounded-lg border border-primary-foreground/20 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-primary-foreground/70">{book.language}</span></div><div className="rounded-2xl border border-border bg-card p-6 sm:p-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">{book.category}</p><h1 className="mt-2 max-w-2xl font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{book.title}</h1><p className="mt-2 text-base text-muted-foreground">{book.author}</p></div><div className="flex items-center gap-2"><StatusPill status={book.status} /><BookWishlistButton bookId={book.id} /></div></div><div className="my-7 grid gap-4 border-y border-border py-5 sm:grid-cols-3"><div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Library code</p><p className="mt-1 font-mono text-sm font-bold">{book.qrCode}</p></div><div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">ISBN</p><p className="mt-1 text-sm font-bold">{book.isbn || 'Not listed'}</p></div><div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Deposit</p><p className="mt-1 text-sm font-bold">{book.depositRequired ? `৳${book.depositAmount}` : 'Not required'}</p></div></div><h2 className="font-display text-lg font-bold">Collection details</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{book.conditionNote || 'এই বইটি পরিষ্কার এবং ব্যবহারযোগ্য অবস্থায় আছে। সংগ্রহের সময় স্টাফের সঙ্গে বইয়ের অবস্থা দেখে নিন।'}</p>{book.status === 'rented' && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">Currently rented. Expected return date will appear when the active transaction is updated.</p>}{!showForm ? <Button onClick={() => setShowForm(true)} disabled={book.status !== 'available'} testId="button-request-book" >{book.status === 'available' ? <><CalendarDays size={16} /> বই ধার নিন</> : 'Currently rented'}</Button> : <div className="mt-6 rounded-2xl bg-muted/65 p-4"><h3 className="font-display font-bold">Choose your collection time</h3><p className="mt-1 text-xs text-muted-foreground">স্টাফ বইটি আলাদা করে রাখবেন—আপনি কখন আসবেন জানালে সুবিধা হবে।</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" data-testid="input-pickup-date" /></label><label className="text-xs font-bold">Time slot<select value={slot} onChange={(e) => setSlot(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" data-testid="select-pickup-slot"><option>12:00–1:00 PM</option><option>3:00–4:00 PM</option><option>4:00–5:00 PM</option></select></label></div><label className="mt-3 block text-xs font-bold">Note (optional)<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="কোনো কথা জানাতে চান?" className="mt-1 w-full rounded-lg border border-border bg-background p-3 text-sm" data-testid="input-request-note" /></label><div className="mt-4 flex gap-2"><Button onClick={submit} disabled={mutation.isPending} testId="button-submit-request">{mutation.isPending ? 'Sending…' : <><Check size={16} /> Send request</>}</Button><Button variant="ghost" onClick={() => setShowForm(false)} testId="button-cancel-request">Cancel</Button></div></div>}</div></div></>;
}

function BookWishlistButton({ bookId }: { bookId: string }) {
  const wishlist = useListWishlist();
  const add = useAddWishlist();
  const remove = useRemoveWishlist();
  const client = useQueryClient();
  const isWishlisted = wishlist.data?.some((item) => item.id === bookId) ?? false;
  const toggle = () => isWishlisted ? remove.mutate({ bookId }, { onSuccess: () => client.invalidateQueries({ queryKey: getListWishlistQueryKey() }) }) : add.mutate({ data: { bookId } }, { onSuccess: () => client.invalidateQueries({ queryKey: getListWishlistQueryKey() }) });
  return <button onClick={toggle} className={`rounded-xl border px-3 py-2 text-sm font-bold ${isWishlisted ? 'border-accent bg-accent/15 text-accent-foreground' : 'border-border hover:bg-muted'}`} data-testid={`button-detail-wishlist-${bookId}`}>{isWishlisted ? '♥ Saved' : '♡ Wishlist'}</button>;
}

function RequestsPage() {
  const query = useListBorrowRequests(); const requests: BorrowRequest[] = query.data || emptyRequests;
  return <><PageIntro eyebrow="Keep your place" title="My requests" description="আপনার প্রতিটি অনুরোধ কোথায় আছে, পরের ধাপ কী—এখানে পরিষ্কারভাবে দেখুন।" action={<Link href="/books" className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold hover:bg-muted" data-testid="link-request-another"><Plus size={16} /> Another book</Link>} />{query.isLoading ? <LoadingBlock rows={3} /> : query.isError ? <ErrorNotice onRetry={() => query.refetch()} /> : requests.length === 0 ? <EmptyState title="এখনও কোনো অনুরোধ নেই" body="আপনার পছন্দের বই খুঁজে collection request পাঠান।" action={<Link href="/books" className="font-bold text-accent-foreground underline">বই দেখুন</Link>} /> : <div className="space-y-4">{requests.map((request, index) => <RequestTimeline key={request.id} request={request} index={index} />)}</div>}</>;
}
function RequestTimeline({ request, index }: { request: BorrowRequest; index: number }) {
  const steps = ['pending', 'approved', 'collected']; const current = request.status === 'rejected' ? 0 : Math.max(0, steps.indexOf(request.status)); return <article className="rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid={`card-request-${request.id}`}><div className="flex flex-col justify-between gap-3 sm:flex-row"><div><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Request {String(index + 1).padStart(2, '0')}</span><h2 className="mt-1 font-display text-lg font-bold">{request.bookTitle}</h2><p className="mt-1 text-xs text-muted-foreground">Sent {request.createdAt} · Pickup {request.approvedPickupDate ?? request.pickupDate}, {request.approvedPickupTime ?? request.pickupSlot}</p></div><StatusPill status={request.status} /></div><div className="mt-6 grid grid-cols-3 gap-2">{steps.map((step, stepIndex) => <div key={step} className="relative"><div className={`h-1 rounded-full ${stepIndex <= current ? 'bg-accent' : 'bg-muted'}`} /><p className={`mt-2 text-[11px] font-bold capitalize ${stepIndex <= current ? 'text-foreground' : 'text-muted-foreground'}`}>{step === 'pending' ? 'Received' : step}</p></div>)}</div>{request.status === 'approved' && <div className="mt-5 flex items-start gap-3 rounded-xl bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-800"><Check size={16} className="mt-0.5 shrink-0" /><span><strong>আপনার বই নেওয়ার অনুরোধটি অনুমোদিত হয়েছে।</strong> {request.dueDate ? `ফেরত দেওয়ার তারিখ ${request.dueDate}।` : 'সংগ্রহের সময় স্টাফের সঙ্গে দেখা করুন।'}</span></div>}{request.lateFee > 0 && <div className="mt-3 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-800">Overdue: current late fee ৳{request.lateFee} (৳9 × late days).</div>}</article>;
}

function AccountPage() {
  const [saved, setSaved] = useState(false);
  return <><PageIntro eyebrow="Your membership" title="Account & membership" description="আপনার সদস্যতা, জামানত, এবং প্রোফাইল তথ্য এক নজরে।" /><div className="grid gap-6 lg:grid-cols-[1fr_0.75fr]"><div className="space-y-6"><section className="rounded-2xl border border-border bg-card p-6"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-accent">Current plan</p><h2 className="mt-1 font-display text-2xl font-extrabold">Standard member</h2><p className="mt-1 text-sm text-muted-foreground">For undergraduate readers in Dhaka</p></div><span className="rounded-xl bg-secondary px-3 py-2 text-xs font-bold text-primary">Active</span></div><div className="mt-6 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-muted/70 p-4"><p className="text-xs text-muted-foreground">Borrowing limit</p><p className="mt-1 font-display text-xl font-bold">2 books</p></div><div className="rounded-xl bg-muted/70 p-4"><p className="text-xs text-muted-foreground">Renewals</p><p className="mt-1 font-display text-xl font-bold">1 / book</p></div><div className="rounded-xl bg-muted/70 p-4"><p className="text-xs text-muted-foreground">Member since</p><p className="mt-1 font-display text-xl font-bold">Sep ‘24</p></div></div></section><section className="rounded-2xl border border-border bg-card p-6"><div className="mb-5 flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-secondary text-primary"><UserRound size={17} /></span><div><h2 className="font-display text-lg font-bold">Profile details</h2><p className="text-xs text-muted-foreground">আপনার সঙ্গে যোগাযোগের তথ্য</p></div></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold">Full name<input defaultValue="Nafisa Rahman" className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent" data-testid="input-profile-name" /></label><label className="text-xs font-bold">Email address<input defaultValue="nafisa@bracu.ac.bd" className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent" data-testid="input-profile-email" /></label><label className="text-xs font-bold">Phone<input defaultValue="01712 345 678" className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent" data-testid="input-profile-phone" /></label><label className="text-xs font-bold">University<input defaultValue="BRAC University" className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent" data-testid="input-profile-university" /></label></div><Button onClick={() => setSaved(true)} testId="button-save-profile">{saved ? <><Check size={16} /> Saved</> : 'Save changes'}</Button></section></div><div className="space-y-6"><section className="rounded-2xl border border-border bg-card p-6"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-accent">Library deposit</p><h2 className="mt-1 font-display text-2xl font-extrabold">৳500</h2></div><StatusPill status="paid" /></div><p className="mt-5 text-sm leading-relaxed text-muted-foreground">আপনার জমা নিরাপদে রাখা আছে। সদস্যতা বন্ধ করলে বই ফেরতের পর এটি ফেরতযোগ্য।</p><div className="mt-5 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full w-full rounded-full bg-accent" /></div></section><section className="rounded-2xl border border-border bg-primary p-6 text-primary-foreground"><Settings2 className="text-accent" size={20} /><h2 className="mt-5 font-display text-xl font-bold">Need a hand?</h2><p className="mt-2 text-sm leading-relaxed text-primary-foreground/65">বই হারানো, ফি, বা সদস্যতা নিয়ে কথা বলতে আমাদের ডেস্কে আসুন।</p><button onClick={() => alert('Desk support: 01712 345 678')} className="mt-5 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-accent-foreground" data-testid="button-contact-support">Contact library desk</button></section></div></div></>;
}

function AdminDashboard() {
  const query = useGetAnalytics(); const analytics = query.data || emptyAnalytics; const requestsQuery = useListBorrowRequests(); const requests: BorrowRequest[] = requestsQuery.data || emptyRequests;
  return <><PageIntro eyebrow="Operations desk" title="Good morning, team." description="আজকের লাইব্রেরি কাজগুলো এক জায়গায়। অনুমোদন, স্টক, ও পেমেন্টে নজর রাখুন।" action={<Button variant="outline" onClick={() => window.print()} testId="button-print-summary"><Download size={16} /> Export summary</Button>} />{query.isError && <ErrorNotice onRetry={() => query.refetch()} />}<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Total books" value={analytics.totalBooks.toLocaleString()} detail={`${analytics.availableBooks} currently available`} icon={LibraryBig} /><Metric label="Active members" value={analytics.activeMembers} detail="Across Dhaka hubs" icon={Users} tone="gold" /><Metric label="Pending requests" value={analytics.pendingRequests} detail="Need staff review" icon={PackageCheck} tone="coral" /><Metric label="Borrowed today" value={analytics.borrowedBooks} detail="Active loans" icon={BookOpen} /></div><div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_0.7fr]"><section className="rounded-2xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-display text-lg font-bold">Queue needing attention</h2><p className="text-xs text-muted-foreground">আজ আগে যেগুলো দেখুন</p></div><Link href="/admin/requests" className="text-xs font-bold text-accent-foreground" data-testid="link-admin-requests">Open queue <ArrowRight className="ml-1 inline" size={13} /></Link></div>{requests.slice(0, 4).map((request) => <div key={request.id} className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 last:border-0" data-testid={`row-admin-request-${request.id}`}><div className="min-w-0"><p className="truncate text-sm font-bold">{request.bookTitle}</p><p className="mt-1 text-xs text-muted-foreground">{request.memberName} · Pickup {request.pickupDate}</p></div><div className="flex items-center gap-3"><StatusPill status={request.status} /><Link href="/admin/requests" className="rounded-lg p-2 text-muted-foreground hover:bg-muted" data-testid={`link-review-${request.id}`}><ArrowRight size={15} /></Link></div></div>)}</section><section className="rounded-2xl border border-border bg-card p-5"><div className="flex items-center justify-between"><h2 className="font-display text-lg font-bold">Shelf health</h2><Link href="/admin/analytics" className="text-xs font-bold text-accent-foreground">Details</Link></div><div className="mt-6 space-y-5"><HealthRow label="Available to lend" value={analytics.availableBooks} total={analytics.totalBooks} color="bg-accent" /><HealthRow label="Currently borrowed" value={analytics.borrowedBooks} total={analytics.totalBooks} color="bg-primary" /><HealthRow label="Members active" value={analytics.activeMembers} total={800} color="bg-[#8a634c]" /></div><div className="mt-7 rounded-xl bg-secondary/70 p-4"><p className="text-xs font-bold">Small reminder</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">বই গ্রহণের সময় condition note আপডেট করতে ভুলবেন না।</p></div></section></div></>;
}
function HealthRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) { const pct = Math.min(100, Math.round((value / total) * 100)); return <div><div className="mb-2 flex justify-between text-xs"><span className="font-semibold">{label}</span><span className="text-muted-foreground">{value.toLocaleString()} · {pct}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} /></div></div>; }

function InventoryPage() {
  const query = useListBooks(); const books = query.data ?? []; const create = useCreateBook(); const update = useUpdateBook(); const client = useQueryClient(); const [addOpen, setAddOpen] = useState(false); const [editing, setEditing] = useState<string | null>(null); const [title, setTitle] = useState(''); const [author, setAuthor] = useState(''); const [category, setCategory] = useState('Economics'); const [language, setLanguage] = useState('English'); const [depositAmount, setDepositAmount] = useState('300'); const { toast } = useToast();
  const reset = () => { setTitle(''); setAuthor(''); setCategory('Economics'); setLanguage('English'); setDepositAmount('300'); setEditing(null); setAddOpen(false); };
  const submit = () => { if (!title || !author) return; if (editing) update.mutate({ id: editing, data: { title, author, category, language, depositAmount: Number(depositAmount), depositRequired: Number(depositAmount) > 0 } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListBooksQueryKey() }); reset(); toast({ title: 'বই আপডেট হয়েছে' }); } }); else create.mutate({ data: { title, author, category, language, depositAmount: Number(depositAmount), depositRequired: Number(depositAmount) > 0, coverUrl: null, isbn: null, price: 0, conditionNote: 'Good condition' } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListBooksQueryKey() }); reset(); toast({ title: 'নতুন বই যোগ হয়েছে' }); } }); };
  const startEdit = (book: Book) => { setEditing(book.id); setTitle(book.title); setAuthor(book.author); setCategory(book.category); setLanguage(book.language); setDepositAmount(String(book.depositAmount)); setAddOpen(true); };
  return <><PageIntro eyebrow="Inventory" title="Every book accounted for." description="স্টক, condition, এবং জামানতের তথ্য এক জায়গায় রাখুন।" action={<Button onClick={() => { reset(); setAddOpen(true); }} testId="button-add-book"><Plus size={16} /> Add book</Button>} />{query.isLoading ? <LoadingBlock rows={5} /> : query.isError ? <ErrorNotice onRetry={() => query.refetch()} /> : <div className="overflow-hidden rounded-2xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border p-4"><div className="relative w-full max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} /><input placeholder="Search inventory..." className="h-10 w-full rounded-xl bg-muted/70 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-accent" data-testid="input-inventory-search" /></div><Button variant="outline" onClick={() => alert('Filters: status, category, language')} testId="button-inventory-filter"><SlidersHorizontal size={15} /> Filter</Button></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-muted/55 text-[10px] uppercase tracking-widest text-muted-foreground"><tr><th className="px-5 py-3 font-bold">Book</th><th className="px-5 py-3 font-bold">Category</th><th className="px-5 py-3 font-bold">Deposit</th><th className="px-5 py-3 font-bold">Status</th><th className="px-5 py-3 text-right font-bold">Action</th></tr></thead><tbody className="divide-y divide-border">{books.map((book) => <tr key={book.id} className="transition-colors hover:bg-muted/30" data-testid={`row-inventory-${book.id}`}><td className="px-5 py-4"><p className="font-bold">{book.title}</p><p className="mt-1 text-xs text-muted-foreground">{book.author} · {book.qrCode}</p></td><td className="px-5 py-4 text-muted-foreground">{book.category}</td><td className="px-5 py-4">{book.depositRequired ? `৳${book.depositAmount}` : 'None'}</td><td className="px-5 py-4"><StatusPill status={book.status} /></td><td className="px-5 py-4 text-right"><button onClick={() => startEdit(book)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground" data-testid={`button-edit-book-${book.id}`}><Pencil size={15} /></button><button onClick={() => update.mutate({ id: book.id, data: { status: book.status === 'available' ? 'archived' : 'available' } }, { onSuccess: () => client.invalidateQueries({ queryKey: getListBooksQueryKey() }) })} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" data-testid={`button-toggle-book-${book.id}`}><MoreHorizontal size={15} /></button></td></tr>)}</tbody></table></div></div>}{addOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4" onClick={(e) => e.target === e.currentTarget && reset()}><div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl"><div className="flex items-center justify-between"><div><h2 className="font-display text-xl font-bold">{editing ? 'Edit book' : 'Add a book'}</h2><p className="mt-1 text-xs text-muted-foreground">Inventory details in English or Bangla.</p></div><button onClick={reset} className="rounded-lg p-2 hover:bg-muted" data-testid="button-close-book-form"><X size={18} /></button></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold sm:col-span-2">Title<input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" data-testid="input-book-title" /></label><label className="text-xs font-bold sm:col-span-2">Author<input value={author} onChange={(e) => setAuthor(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" data-testid="input-book-author" /></label><label className="text-xs font-bold">Category<input value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" data-testid="input-book-category" /></label><label className="text-xs font-bold">Language<select value={language} onChange={(e) => setLanguage(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" data-testid="select-book-language-form"><option>English</option><option>Bangla</option></select></label><label className="text-xs font-bold">Deposit amount<input type="number" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" data-testid="input-book-deposit" /></label></div><div className="mt-6 flex justify-end gap-2"><Button variant="ghost" onClick={reset} testId="button-cancel-book">Cancel</Button><Button onClick={submit} disabled={create.isPending || update.isPending} testId="button-save-book">{create.isPending || update.isPending ? 'Saving…' : 'Save book'}</Button></div></div></div>}</>;
}

function AdminRequestsPage() {
  const query = useListBorrowRequests(); const requests: BorrowRequest[] = query.data || emptyRequests; const update = useUpdateBorrowRequestStatus(); const client = useQueryClient(); const { toast } = useToast(); const [rescheduling, setRescheduling] = useState<string | null>(null); const [date, setDate] = useState(''); const [slot, setSlot] = useState('3:00–4:00 PM');
  const changeStatus = (id: string, status: string, extra: { note?: string | null; pickupDate?: string | null; pickupSlot?: string | null } = {}) => update.mutate({ id, data: { status, dueDate: null, note: extra.note ?? null, pickupDate: extra.pickupDate ?? null, pickupSlot: extra.pickupSlot ?? null } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListBorrowRequestsQueryKey() }); client.invalidateQueries({ queryKey: getListNotificationsQueryKey() }); toast({ title: status === 'approved' ? 'Request approved' : status === 'rescheduled' ? 'Pickup rescheduled' : `Request ${status}` }); setRescheduling(null); } , onError: (error) => toast({ title: 'Request update failed', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' }) });
  const reject = (id: string) => { const reason = window.prompt('Rejection reason (required)'); if (reason?.trim()) changeStatus(id, 'rejected', { note: reason.trim() }); };
  return <><PageIntro eyebrow="Request queue" title="Keep every promise." description="অনুরোধের member, deposit, subscription, pickup time, এবং সিদ্ধান্ত এক জায়গায় দেখুন।" action={<Button variant="outline" onClick={() => query.refetch()} testId="button-refresh-requests"><RefreshCw size={15} /> Refresh</Button>} />{query.isLoading ? <LoadingBlock rows={4} /> : query.isError ? <ErrorNotice onRetry={() => query.refetch()} /> : <div className="space-y-3">{requests.length === 0 ? <EmptyState title="Queue is clear" body="এখন কোনো pending request নেই।" /> : requests.map((request) => <div key={request.id} className="rounded-2xl border border-border bg-card p-5" data-testid={`card-admin-request-${request.id}`}><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="flex items-start gap-4"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><BookOpen size={17} /></span><div><h2 className="font-display font-bold">{request.bookTitle}</h2><p className="mt-1 text-xs text-muted-foreground">{request.memberName} · {request.memberPhone ?? 'Phone not listed'} · {request.university ?? 'University not listed'}</p><div className="mt-3 flex flex-wrap gap-2 text-[11px]"><span className="rounded-full bg-muted px-2.5 py-1 font-bold">Pickup {request.pickupDate} · {request.pickupSlot}</span><span className="rounded-full bg-muted px-2.5 py-1 font-bold">Deposit: {request.depositStatus ?? 'unknown'}</span><span className="rounded-full bg-muted px-2.5 py-1 font-bold">Subscription: {request.subscriptionStatus ?? 'unknown'}</span></div><p className="mt-2 text-xs text-muted-foreground">Request ID <span className="font-mono">{request.id}</span></p></div></div><div className="flex flex-wrap items-center gap-2 lg:justify-end"><StatusPill status={request.status} />{request.status === 'pending' && <><Button onClick={() => changeStatus(request.id, 'approved')} disabled={update.isPending} testId={`button-approve-${request.id}`}><Check size={15} /> Approve</Button><Button variant="outline" onClick={() => reject(request.id)} disabled={update.isPending} testId={`button-reject-${request.id}`}><X size={15} /> Reject</Button><Button variant="ghost" onClick={() => { setRescheduling(request.id); setDate(request.pickupDate); setSlot(request.pickupSlot); }} disabled={update.isPending} testId={`button-reschedule-${request.id}`}><CalendarDays size={15} /> Reschedule</Button></>}</div></div>{rescheduling === request.id && <div className="mt-4 rounded-xl bg-muted/60 p-4"><p className="text-xs font-bold">Choose a new pickup time</p><div className="mt-3 flex flex-wrap gap-3"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm" data-testid={`input-reschedule-date-${request.id}`} /><select value={slot} onChange={(event) => setSlot(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm" data-testid={`select-reschedule-slot-${request.id}`}><option>12:00–1:00 PM</option><option>3:00–4:00 PM</option><option>4:00–5:00 PM</option></select><Button onClick={() => changeStatus(request.id, 'rescheduled', { pickupDate: date, pickupSlot: slot })} disabled={update.isPending || !date} testId={`button-save-reschedule-${request.id}`}>Save new time</Button><Button variant="ghost" onClick={() => setRescheduling(null)}>Cancel</Button></div></div>}</div>)}</div>}</>;
}

function MembersPage() {
  const query = useListMembers(); const members: Member[] = query.data || emptyMembers; const [filter, setFilter] = useState('');
  const shown = members.filter((member) => member.name.toLowerCase().includes(filter.toLowerCase()) || (member.email ?? '').toLowerCase().includes(filter.toLowerCase()));
  return <><PageIntro eyebrow="Member directory" title="People who keep reading." description="সদস্যের সদস্যতা, জামানত, এবং বকেয়া দ্রুত দেখুন।" action={<Button variant="outline" onClick={() => alert('Invite link copied')} testId="button-invite-member"><Plus size={16} /> Invite member</Button>} />{query.isLoading ? <LoadingBlock rows={4} /> : query.isError ? <ErrorNotice onRetry={() => query.refetch()} /> : <div className="overflow-hidden rounded-2xl border border-border bg-card"><div className="border-b border-border p-4"><div className="relative max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} /><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search members..." className="h-10 w-full rounded-xl bg-muted/70 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-accent" data-testid="input-member-search" /></div></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-muted/55 text-[10px] uppercase tracking-widest text-muted-foreground"><tr><th className="px-5 py-3">Member</th><th className="px-5 py-3">Plan</th><th className="px-5 py-3">Deposit</th><th className="px-5 py-3">Fees</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-border">{shown.map((member) => <tr key={member.id} className="hover:bg-muted/30" data-testid={`row-member-${member.id}`}><td className="px-5 py-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-secondary text-xs font-bold text-primary">{member.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span><p className="font-bold">{member.name}</p><p className="mt-1 text-xs text-muted-foreground">{member.email}</p></span></div></td><td className="px-5 py-4 text-muted-foreground">{member.plan}</td><td className="px-5 py-4"><StatusPill status={member.depositStatus} /></td><td className="px-5 py-4 font-semibold">{member.outstandingFees ? `৳${member.outstandingFees}` : '—'}</td><td className="px-5 py-4"><StatusPill status={member.status} /></td><td className="px-5 py-4 text-right"><button onClick={() => alert(`Member profile: ${member.name}`)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" data-testid={`button-member-details-${member.id}`}><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table></div></div>}</>;
}

function PaymentsPage() {
  const query = useListPayments(); const payments: Payment[] = query.data || emptyPayments; const membersQuery = useListMembers(); const members: Member[] = membersQuery.data || emptyMembers; const record = useRecordPayment(); const client = useQueryClient(); const { toast } = useToast(); const [open, setOpen] = useState(false); const [memberId, setMemberId] = useState(members[0]?.id || ''); const [amount, setAmount] = useState('500'); const [method, setMethod] = useState('bKash'); const [type, setType] = useState('deposit'); const [reference, setReference] = useState('');
  const submit = () => record.mutate({ data: { memberId, amount: Number(amount), method, type, reference: reference || null } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListPaymentsQueryKey() }); setOpen(false); toast({ title: 'Payment recorded', description: 'পেমেন্টটি সদস্যের হিসাবে যোগ হয়েছে।' }); }, onError: () => toast({ title: 'Payment save failed', variant: 'destructive' }) });
  return <><PageIntro eyebrow="Offline payments" title="Make every taka traceable." description="Cash, bKash, বা Nagad—অফলাইন পেমেন্টের রেফারেন্সসহ রেকর্ড রাখুন।" action={<Button onClick={() => setOpen(true)} testId="button-record-payment"><Plus size={16} /> Record payment</Button>} />{query.isLoading ? <LoadingBlock rows={4} /> : query.isError ? <ErrorNotice onRetry={() => query.refetch()} /> : <div className="overflow-hidden rounded-2xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border p-4"><div><p className="text-xs font-semibold text-muted-foreground">This month</p><p className="font-display text-xl font-extrabold">৳{payments.reduce((sum, payment) => sum + payment.amount, 0).toLocaleString()}</p></div><span className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{payments.length} verified entries</span></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-muted/55 text-[10px] uppercase tracking-widest text-muted-foreground"><tr><th className="px-5 py-3">Member</th><th className="px-5 py-3">Amount</th><th className="px-5 py-3">Method</th><th className="px-5 py-3">Reference</th><th className="px-5 py-3">Date</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-border">{payments.map((payment) => <tr key={payment.id} className="hover:bg-muted/30" data-testid={`row-payment-${payment.id}`}><td className="px-5 py-4 font-bold">{payment.memberName}</td><td className="px-5 py-4 font-display font-bold">৳{payment.amount}</td><td className="px-5 py-4">{payment.method}<span className="ml-2 text-xs text-muted-foreground">· {payment.type}</span></td><td className="px-5 py-4 font-mono text-xs text-muted-foreground">{payment.reference || '—'}</td><td className="px-5 py-4 text-muted-foreground">{payment.paidAt}</td><td className="px-5 py-4"><StatusPill status={payment.status} /></td></tr>)}</tbody></table></div></div>}{open && <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4"><div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="font-display text-xl font-bold">Record payment</h2><button onClick={() => setOpen(false)} data-testid="button-close-payment"><X size={18} /></button></div><div className="mt-5 space-y-4"><label className="block text-xs font-bold">Member<select value={memberId} onChange={(e) => setMemberId(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" data-testid="select-payment-member">{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label className="block text-xs font-bold">Amount<input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" data-testid="input-payment-amount" /></label><div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold">Method<select value={method} onChange={(e) => setMethod(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" data-testid="select-payment-method"><option>Cash</option><option>bKash</option><option>Nagad</option></select></label><label className="text-xs font-bold">Type<select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" data-testid="select-payment-type"><option value="deposit">Deposit</option><option value="fee">Fee</option><option value="membership">Membership</option></select></label></div><label className="block text-xs font-bold">Reference<input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. BK7A2M9 or CASH-1082" className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" data-testid="input-payment-reference" /></label></div><div className="mt-6 flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)} testId="button-cancel-payment">Cancel</Button><Button onClick={submit} disabled={record.isPending} testId="button-submit-payment">{record.isPending ? 'Saving…' : 'Save payment'}</Button></div></div></div>}</>;
}

function AnalyticsPage() {
  const query = useGetAnalytics(); const analytics = query.data || emptyAnalytics; const max = Math.max(...analytics.monthlyBorrowing.map((item) => item.count), 1);
  return <><PageIntro eyebrow="Library intelligence" title="See what the shelf is saying." description="মাসের ধার নেওয়ার প্রবণতা এবং লাইব্রেরির capacity বুঝে পরের সিদ্ধান্ত নিন।" action={<Button variant="outline" onClick={() => window.print()} testId="button-export-analytics"><Download size={16} /> Export report</Button>} />{query.isError && <ErrorNotice onRetry={() => query.refetch()} />}<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Total books" value={analytics.totalBooks.toLocaleString()} detail="Across all categories" icon={LibraryBig} /><Metric label="Available books" value={analytics.availableBooks.toLocaleString()} detail={`${Math.round(analytics.availableBooks / analytics.totalBooks * 100)}% of collection`} icon={BookOpen} tone="gold" /><Metric label="Borrowed books" value={analytics.borrowedBooks} detail="Active checkouts" icon={Clock3} tone="coral" /><Metric label="Active members" value={analytics.activeMembers} detail="Current memberships" icon={Users} /></div><section className="mt-6 rounded-2xl border border-border bg-card p-5 sm:p-7"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-widest text-accent">Borrowing pulse</p><h2 className="mt-1 font-display text-xl font-extrabold">Monthly borrowing</h2></div><p className="text-xs text-muted-foreground">Last six months</p></div><div className="mt-8 flex h-64 items-end gap-3 border-b border-l border-border px-3 pb-0 pt-5 sm:gap-6">{analytics.monthlyBorrowing.map((item, i) => <div key={item.month} className="group flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-xs font-bold opacity-0 transition-opacity group-hover:opacity-100">{item.count}</span><div className={`w-full max-w-14 rounded-t-lg transition-all duration-500 group-hover:bg-accent ${i === analytics.monthlyBorrowing.length - 1 ? 'bg-primary' : 'bg-secondary'}`} style={{ height: `${Math.max(9, item.count / max * 82)}%` }} /><span className="mb-[-24px] text-[10px] font-bold text-muted-foreground">{item.month}</span></div>)}</div></section><div className="mt-6 grid gap-6 md:grid-cols-2"><section className="rounded-2xl border border-border bg-card p-6"><h2 className="font-display text-lg font-bold">Collection mix</h2><div className="mt-6 space-y-4"><HealthRow label="Available" value={analytics.availableBooks} total={analytics.totalBooks} color="bg-accent" /><HealthRow label="Borrowed" value={analytics.borrowedBooks} total={analytics.totalBooks} color="bg-primary" /><HealthRow label="In review / repair" value={analytics.totalBooks - analytics.availableBooks - analytics.borrowedBooks} total={analytics.totalBooks} color="bg-[#8a634c]" /></div></section><section className="rounded-2xl border border-border bg-card p-6"><h2 className="font-display text-lg font-bold">Staff signal</h2><div className="mt-5 flex items-start gap-3 rounded-xl bg-amber-50 p-4 text-amber-800"><AlertCircle size={18} className="mt-0.5" /><p className="text-sm leading-relaxed"><strong>{analytics.pendingRequests} requests</strong> অপেক্ষা করছে। দুপুরের আগে queue review করলে collection promise ঠিক থাকবে।</p></div><Link href="/admin/requests" className="mt-5 inline-flex text-sm font-bold text-accent-foreground" data-testid="link-analytics-queue">Review request queue <ArrowRight className="ml-1" size={15} /></Link></section></div></>;
}

function NotFound() { return <div className="mx-auto max-w-xl py-24 text-center"><span className="font-mono text-sm text-accent">404 / NOT ON THE SHELF</span><h1 className="mt-3 font-display text-4xl font-extrabold">এই পাতা খুঁজে পাওয়া যায়নি।</h1><p className="mt-3 text-sm text-muted-foreground">আপনি যে ঠিকানায় এসেছেন সেটি হয়তো বদলে গেছে।</p><Link href="/" className="mt-6 inline-flex rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground" data-testid="link-not-found-home">Return home</Link></div>; }

export default App;