'use client';

import { SignIn } from '@clerk/nextjs';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { BrowserSessionResponse, DevPersonaId } from '@boomerbuddy/contracts';
import { PublicFooter, PublicHeader } from '../../components/public-shell';
import { apiRequest, readableError, setSelectedHouseholdId } from '../../lib/api';

const personas: Array<{ id: DevPersonaId; name: string; detail: string }> = [
  {
    id: 'owner-alice',
    name: 'Alice — administrator and protected adult',
    detail:
      'Sunrise household; independent protected enrollment enables Checks and self-orientation.',
  },
  {
    id: 'protected-pat',
    name: 'Pat — protected member',
    detail: 'Sunrise household; can use core protection features.',
  },
  {
    id: 'trusted-terry',
    name: 'Terry — Trusted Circle',
    detail: 'Sunrise household; access is limited by granted permissions.',
  },
  {
    id: 'trusted-jordan',
    name: 'Jordan — unassigned trusted person',
    detail: 'No household until Jordan knowingly accepts a valid local invitation.',
  },
  {
    id: 'owner-bob',
    name: 'Bob — administrator without protected enrollment',
    detail: 'Harbor household; safety administration remains separate from protected workflows.',
  },
  {
    id: 'protected-olivia',
    name: 'Olivia — second protected member',
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

function ProductionSignIn() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <>
        <PublicHeader />
        <main id="main-content" className="page-shell narrow">
          <span className="eyebrow">Member sign in</span>
          <h1 className="page-title">Sign-in is not configured</h1>
          <p className="error" role="alert">
            Member access is closed. Ask the BoomerBuddy founder to complete the identity setup
            before trying again.
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
        <span className="eyebrow">Private Founding Household beta</span>
        <h1 className="page-title">Sign in to BoomerBuddy</h1>
        <p className="lede">
          Use the identity the founder invited. Signing in does not grant household access; an
          exact, unexpired invitation and your consent are still required.
        </p>
        <div className="card" style={{ marginTop: '2rem', display: 'grid', placeItems: 'center' }}>
          <SignIn
            path="/sign-in"
            routing="path"
            withSignUp={false}
            forceRedirectUrl="/member"
            fallbackRedirectUrl="/member"
          />
        </div>
      </main>
      <PublicFooter />
    </>
  );
}

export default function SignInPage() {
  return process.env.NODE_ENV === 'production' ? <ProductionSignIn /> : <DevelopmentSignIn />;
}
