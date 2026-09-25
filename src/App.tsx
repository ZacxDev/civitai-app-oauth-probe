import { useCallback, useEffect, useState } from 'react';

import {
  classifyTokenKind,
  DECLARED_SCOPES,
  readMe,
  verdict,
  withheldScopes,
  type MeReading,
  type TokenKindReading,
} from './probe';

/**
 * What the app needs from `@civitai/sdk`, narrowed to the calls this probe makes.
 * The App component takes it as a prop so a test can drive it without a host —
 * the boundary this app is about IS the platform, so the fake stands exactly
 * where the platform does and nowhere further in.
 */
export interface Platform {
  tokenKind: string | undefined;
  grantedScopes: readonly string[];
  expiresAt: Date | null;
  signedIn: boolean;
  /** `GET /api/v1/me`, as the viewer. */
  me(): Promise<unknown>;
  requestGrants(scopes: readonly string[]): Promise<boolean>;
}

type MeState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; reading: MeReading }
  | { status: 'error'; message: string };

export function App({ platform }: { platform: Platform }) {
  const kind: TokenKindReading = classifyTokenKind(platform.tokenKind);
  const withheld = withheldScopes(DECLARED_SCOPES, platform.grantedScopes);
  const [me, setMe] = useState<MeState>({ status: 'idle' });
  const [granting, setGranting] = useState(false);

  const load = useCallback(async () => {
    setMe({ status: 'loading' });
    try {
      setMe({ status: 'ok', reading: readMe(await platform.me()) });
    } catch (err) {
      setMe({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [platform]);

  /**
   * 🔴 RE-READ `/me` WHEN THE TOKEN CHANGES, NOT ONLY WHEN THE VIEWER DOES.
   * Measured live 2026-09-25: granting consent rotated the token from `block` to
   * `oauth` in the same session, the kind on screen updated (it is read from the
   * snapshot on every render) — and the `/me` panel kept showing the refusal
   * taken against the OLD token, whose text says "this block holds a
   * block-scoped token". The screen contradicted itself, and the stale half was
   * the one a reader would act on.
   *
   * `signedIn` alone cannot see this: it never changed. The dependency has to be
   * the token's own identity, which is exactly what rotated.
   */
  const tokenIdentity = `${kind}|${[...platform.grantedScopes].sort().join(',')}`;
  useEffect(() => {
    if (platform.signedIn) void load();
    // `tokenIdentity` is the real trigger; `load` closes over `platform`.
  }, [platform.signedIn, tokenIdentity, load]);

  const ask = useCallback(async () => {
    setGranting(true);
    try {
      await platform.requestGrants(withheld);
    } finally {
      setGranting(false);
    }
  }, [platform, withheld]);

  return (
    <main className="probe">
      <h1>OAuth Probe</h1>
      <p className="verdict" data-testid="verdict">
        {verdict(kind, platform.signedIn, withheld.length)}
      </p>

      <section>
        <h2>The token the host sent</h2>
        <dl>
          <dt>Kind</dt>
          <dd data-testid="token-kind">{kind}</dd>
          <dt>Expires</dt>
          <dd data-testid="token-expiry">
            {platform.expiresAt ? platform.expiresAt.toISOString() : 'not sent'}
          </dd>
          <dt>Granted permissions</dt>
          <dd data-testid="granted">
            {platform.grantedScopes.length ? platform.grantedScopes.join(', ') : 'none'}
          </dd>
          <dt>Declared but not granted</dt>
          <dd data-testid="withheld">{withheld.length ? withheld.join(', ') : 'none'}</dd>
        </dl>
        {withheld.length > 0 && platform.signedIn ? (
          <button type="button" onClick={ask} disabled={granting} data-testid="ask">
            {granting ? 'Asking…' : `Ask for ${withheld.join(' and ')}`}
          </button>
        ) : null}
      </section>

      <section>
        <h2>What /api/v1/me returned</h2>
        {me.status === 'idle' ? <p data-testid="me-idle">Not read — no signed-in viewer.</p> : null}
        {me.status === 'loading' ? <p data-testid="me-loading">Reading…</p> : null}
        {me.status === 'error' ? (
          <p data-testid="me-error" role="alert">
            Refused: {me.message}
          </p>
        ) : null}
        {me.status === 'ok' ? (
          <dl>
            <dt>Username</dt>
            <dd data-testid="me-username">{me.reading.username ?? 'not returned'}</dd>
            <dt>Authenticated by</dt>
            <dd data-testid="me-auth">
              {me.reading.tokenAuthenticated ? 'a token' : 'a cookie session'}
            </dd>
            <dt>tokenScope bitmask</dt>
            <dd data-testid="me-scope">
              {me.reading.tokenScope === null ? 'not returned' : me.reading.tokenScope}
            </dd>
            <dt>Carries user:read:self</dt>
            <dd data-testid="me-userread">{me.reading.carriesUserRead ? 'yes' : 'no'}</dd>
            <dt>Carries buzz:read:self</dt>
            <dd data-testid="me-buzzread">{me.reading.carriesBuzzRead ? 'yes' : 'no'}</dd>
            <dt>Profile fields returned</dt>
            <dd data-testid="me-fields">
              {me.reading.profileFieldsPresent.length
                ? me.reading.profileFieldsPresent.join(', ')
                : 'none'}
            </dd>
          </dl>
        ) : null}
        {/*
          🔴 Stated on screen, not only in a docblock: /api/v1/me omits isModerator
          for any non-moderator and omits email for an account that has none, both
          with consent fully granted. So an absent field has two causes and the
          bitmask above is the reading that actually answers the question.
        */}
        <p className="caveat">
          An absent profile field is not proof a permission was withheld — the API
          omits <code>isModerator</code> for non-moderators and <code>email</code> for
          accounts without one. The <code>tokenScope</code> bitmask is the unambiguous reading.
        </p>
      </section>
    </main>
  );
}
