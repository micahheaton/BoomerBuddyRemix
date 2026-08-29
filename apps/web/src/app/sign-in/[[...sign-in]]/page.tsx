'use client';

import { ClerkFailed, ClerkLoaded, ClerkLoading, SignIn, useAuth, useClerk } from '@clerk/nextjs';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { BrowserSessionResponse, DevPersonaId } from '@boomerbuddy/contracts';
import { PublicFooter, PublicHeader } from '../../../components/public-shell';
import { apiRequest, readableError, setSelectedHouseholdId } from '../../../lib/api';
import {
  clearActiveClerkSession,
  clearCustomerSessionState,
  clearClerkSessionWhenLoaded,
  createSessionRecoveryRetryController,
  isSameOriginMemberRedirectTarget,
  productionSessionRecoveryPath,
  type SessionRecoveryRetryState,
} from '../../../lib/auth-recovery';

const personas: Array<{ id: DevPersonaId; name: string; detail: string }> = [
  {
    id: 'owner-alice',
    name: 'Alice - administrator and protected adult',
    detail:
      'Sunrise household; independent protected enrollment enables Checks and self-orientation.',
  },
  {
    id: 'protected-pat',
    name: 'Pat - protected member',
    detail: 'Sunrise household; can use core protection features.',
  },
  {
    id: 'trusted-terry',
    name: 'Terry - Trusted Circle',
    detail: 'Sunrise household; access is limited by granted permissions.',
  },
  {
    id: 'trusted-jordan',
    name: 'Jordan - unassigned trusted person',
    detail: 'No household until Jordan knowingly accepts a valid local invitation.',
  },
  {
    id: 'owner-bob',
    name: 'Bob - administrator without protected enrollment',
    detail: 'Harbor household; safety administration remains separate from protected workflows.',
  },
  {
    id: 'protected-olivia',
    name: 'Olivia - second protected member',
    detail: 'Harbor household; useful for explicit multi-household scope testing.',
  },
];

function DevelopmentSignIn() {
  const router = useRouter();
  const [personaId, setPersonaId] = useState<DevPersonaId>('owner-alice');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await apiRequest<BrowserSessionResponse>('/v1/dev/sessions/customer', {
        method: 'POST',
        body: JSON.stringify({ personaId }),
      });
      clearCustomerSessionState(window.sessionStorage);
      setSelectedHouseholdId(response.principal.households[0]?.id ?? '');
      router.push('/member');
      router.refresh();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PublicHeader />
      <main id="main-content" className="page-shell narrow">
        <span className="eyebrow">Development access</span>
        <h1 className="page-title">Choose a seeded person</h1>
        <p className="lede">
          These are fictional local personas. No password, email, or production identity is
          involved.
        </p>
        <form className="card form-stack" onSubmit={signIn} style={{ marginTop: '2rem' }}>
          <label htmlFor="persona">Development persona</label>
          <select
            id="persona"
            value={personaId}
            onChange={(event) => setPersonaId(event.target.value as DevPersonaId)}
          >
            {personas.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {persona.name}
              </option>
            ))}
          </select>
          <p className="help">{personas.find((persona) => persona.id === personaId)?.detail}</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button-primary" disabled={busy} type="submit">
            {busy ? 'Signing in…' : 'Enter local member area'}
          </button>
        </form>
        <div className="notice notice-warning" style={{ marginTop: '1rem' }}>
          <strong>Local use only.</strong> Development sessions are deliberately rejected in
          production mode.
        </div>
      </main>
      <PublicFooter />
    </>
  );
}

function ProductionSignedInSignInRecovery() {
  const clerk = useClerk();
  const { sessionId } = useAuth();
  const memberNavigationStarted = useRef(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [state, setState] = useState<SessionRecoveryRetryState>({ busy: false, error: '' });
  const retry = useMemo(
    () =>
      createSessionRecoveryRetryController({
        clearClerkSession: () =>
          clearClerkSessionWhenLoaded({
            clearClerkSession: async () => {
              clearCustomerSessionState(window.sessionStorage);
              await clearActiveClerkSession({
                sessionId,
                signOut: (callback, options) => clerk.signOut(callback, options),
              });
            },
            isLoaded: () => clerk.loaded,
          }),
        confirmNavigation: () =>
          new Promise((resolve) => {
            window.setTimeout(
              () =>
                resolve(window.location.pathname === '/sign-in' && window.location.search === ''),
              1_000,
            );
          }),
        navigate: () => window.location.replace('/sign-in'),
        onStateChange: setState,
      }),
    [clerk, sessionId],
  );

  useEffect(() => {
    const rejectedRedirectUrl = new URL(window.location.href).searchParams.get('redirect_url');
    if (isSameOriginMemberRedirectTarget(rejectedRedirectUrl, window.location.origin)) {
      const update = window.setTimeout(() => setRecoveryRequired(true), 0);
      return () => window.clearTimeout(update);
    }

    if (memberNavigationStarted.current) return undefined;
    memberNavigationStarted.current = true;
    window.location.replace('/member');
    return undefined;
  }, []);

  return (
    <div className="notice" aria-live="polite">
      <strong>
        {state.busy
          ? 'Refreshing member sign-in...'
          : recoveryRequired || state.error
            ? 'Member sign-in needs one refresh'
            : 'Opening your member area...'}
      </strong>
      <p>
        {state.error
          ? 'The previous browser session could not be cleared automatically. No account or household data was changed.'
          : recoveryRequired
            ? 'BoomerBuddy found an old browser session that the server could not verify. Clear only this session to open a clean sign-in page.'
            : 'BoomerBuddy is checking the signed-in session with the member area.'}
      </p>
      {recoveryRequired ? (
        <>
          <button
            className="button-primary"
            type="button"
            disabled={state.busy}
            onClick={() => void retry.retry()}
          >
            {state.busy ? 'Clearing this session...' : 'Clear this session and sign in again'}
          </button>
          {state.error ? (
            <p className="error" role="alert">
              {state.error}
            </p>
          ) : null}
          {state.error ? <a href="mailto:support@boomerbuddy.net">Email support</a> : null}
        </>
      ) : null}
    </div>
  );
}

function ProductionLoadedSignIn() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <p className="help" role="status">
        Loading secure sign-in...
      </p>
    );
  }

  if (isSignedIn) return <ProductionSignedInSignInRecovery />;

  return (
    <SignIn
      path="/sign-in"
      routing="path"
      withSignUp
      forceRedirectUrl="/member"
      fallbackRedirectUrl="/member"
      signUpUrl="/sign-up"
      signUpForceRedirectUrl="/member"
      fallback={
        <p className="help" role="status">
          Loading secure sign-in...
        </p>
      }
    />
  );
}

function ProductionSignIn() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <>
        <PublicHeader />
        <main id="main-content" className="page-shell narrow">
          <span className="eyebrow">Member sign in</span>
          <h1 className="page-title">Member sign in is temporarily unavailable</h1>
          <p className="error" role="alert">
            Contact support for help accessing your account. Do not create another account.
          </p>
        </main>
        <PublicFooter />
      </>
    );
  }

  return (
    <>
      <PublicHeader />
      <main id="main-content" className="page-shell narrow">
        <span className="eyebrow">Member access</span>
        <h1 className="page-title">Sign in to BoomerBuddy</h1>
        <p className="lede">
          Use your existing account. Signing in opens only your own authorized households and does
          not reveal another adult&apos;s Checks, grant billing authority, or accept an invitation.
        </p>
        <div className="card" style={{ marginTop: '2rem', display: 'grid', placeItems: 'center' }}>
          <ClerkLoading>
            <p className="help" role="status">
              Loading secure sign-in...
            </p>
          </ClerkLoading>
          <ClerkFailed>
            <p className="error" role="alert">
              The secure sign-in form could not load. Reload this page or contact support.
            </p>
          </ClerkFailed>
          <ClerkLoaded>
            <ProductionLoadedSignIn />
          </ClerkLoaded>
        </div>
        <p className="help">
          New to BoomerBuddy? <Link href="/sign-up">Create a free account</Link>. Account creation
          does not start a trial or charge you.
        </p>
      </main>
      <PublicFooter />
    </>
  );
}

function UnauthorizedSignInRecovery() {
  return (
    <>
      <PublicHeader />
      <main id="main-content" className="page-shell narrow">
        <span className="eyebrow">Sign-in security</span>
        <h1 className="page-title">This sign-in cannot continue here</h1>
        <p className="lede">BoomerBuddy did not open member access from this page.</p>
        <div className="card" style={{ marginTop: '2rem' }}>
          <h2>If you followed a security email</h2>
          <p>
            The identity provider may send you here after an unfamiliar-device session is revoked.
            Opening this page by itself does not prove that a session was revoked.
          </p>
          <p>
            If you were trying to use BoomerBuddy, sign in again with your existing account. If this
            was unexpected, contact support before continuing.
          </p>
          <div className="button-row">
            <Link className="button button-primary" href="/sign-in">
              Try member sign in again
            </Link>
            <a className="button button-secondary" href="mailto:support@boomerbuddy.net">
              Email support
            </a>
          </div>
        </div>
      </main>
      <PublicFooter />
    </>
  );
}

function SessionRecoveryContent({
  retry,
  retryBusy = false,
  retryError = '',
}: {
  readonly retry?: () => void;
  readonly retryBusy?: boolean;
  readonly retryError?: string;
}) {
  return (
    <>
      <PublicHeader />
      <main id="main-content" className="page-shell narrow">
        <span className="eyebrow">Member session recovery</span>
        <h1 className="page-title">Your previous session could not be verified</h1>
        <p className="lede">
          BoomerBuddy stopped instead of repeatedly returning you to the member area. This page does
          not continue automatically.
        </p>
        <div className="card" style={{ marginTop: '2rem' }}>
          <p>
            Try a fresh member sign in. If you did not expect this message, or a fresh sign in still
            fails, contact support and do not create another account.
          </p>
          <div className="button-row">
            {retry ? (
              <button className="button-primary" type="button" disabled={retryBusy} onClick={retry}>
                {retryBusy ? 'Clearing session...' : 'Clear session and try member sign in'}
              </button>
            ) : (
              <Link className="button button-primary" href="/sign-in">
                Try member sign in
              </Link>
            )}
            <a className="button button-secondary" href="mailto:support@boomerbuddy.net">
              Email support
            </a>
          </div>
          {retryError ? (
            <p className="error" role="alert">
              {retryError}
            </p>
          ) : null}
        </div>
      </main>
      <PublicFooter />
    </>
  );
}

function ProductionSessionRecovery() {
  const clerk = useClerk();
  const { sessionId } = useAuth();
  const [state, setState] = useState<SessionRecoveryRetryState>({ busy: false, error: '' });
  const retry = useMemo(
    () =>
      createSessionRecoveryRetryController({
        clearClerkSession: () =>
          clearClerkSessionWhenLoaded({
            clearClerkSession: async () => {
              clearCustomerSessionState(window.sessionStorage);
              await clearActiveClerkSession({
                sessionId,
                signOut: (callback, options) => clerk.signOut(callback, options),
              });
            },
            isLoaded: () => clerk.loaded,
          }),
        confirmNavigation: () =>
          new Promise((resolve) => {
            window.setTimeout(() => resolve(window.location.pathname === '/sign-in'), 1_000);
          }),
        navigate: () => window.location.replace('/sign-in'),
        onStateChange: setState,
      }),
    [clerk, sessionId],
  );

  return (
    <SessionRecoveryContent
      retry={() => void retry.retry()}
      retryBusy={state.busy}
      retryError={state.error}
    />
  );
}

export default function SignInPage() {
  const pathname = usePathname();
  if (pathname === '/unauthorized-sign-in') return <UnauthorizedSignInRecovery />;
  if (pathname === productionSessionRecoveryPath) {
    return process.env.NODE_ENV === 'production' ? (
      <ProductionSessionRecovery />
    ) : (
      <SessionRecoveryContent />
    );
  }
  return process.env.NODE_ENV === 'production' ? <ProductionSignIn /> : <DevelopmentSignIn />;
}
