/**
 * The probe's readings, as pure functions over what the host and the API hand back.
 *
 * Everything here is deliberately free of React and of `@civitai/sdk`, so the
 * assertions in `probe.test.ts` pin the CLASSIFICATION rather than a render.
 */

/** Bit values read from `@civitai/auth/token-scope`; only the two this app declares. */
export const TOKEN_SCOPE_BITS = {
  /** `user:read:self` — the mandatory baseline every OAuth app token carries. */
  UserRead: 1 << 0,
  /** `buzz:read:self` */
  BuzzRead: 1 << 16,
} as const;

/** What `block.manifest.json` declares. Kept beside the manifest, not derived from it. */
export const DECLARED_SCOPES = ['user:read:self', 'buzz:read:self'] as const;

/**
 * 🔴 The manifest declares `auth: "oauth"`, so the INTERESTING reading is `oauth`.
 * `unknown` is a third state and not a synonym for `block`: `kind` is optional on
 * the wire and a host predating it sends none, so an absent value says nothing
 * about which token this is. Collapsing it into `block` would report a stale host
 * as a failed opt-in.
 */
export type TokenKindReading = 'block' | 'oauth' | 'unknown';

export function classifyTokenKind(kind: string | undefined | null): TokenKindReading {
  if (kind === 'block' || kind === 'oauth') return kind;
  return 'unknown';
}

/** Declared scopes the viewer has not granted — the consent-gated remainder. */
export function withheldScopes(
  declared: readonly string[],
  granted: readonly string[]
): string[] {
  const held = new Set(granted);
  return declared.filter((scope) => !held.has(scope));
}

export function hasBit(mask: number | undefined | null, bit: number): boolean {
  if (typeof mask !== 'number' || !Number.isFinite(mask)) return false;
  return (mask & bit) === bit;
}

/**
 * How `/api/v1/me` answered.
 *
 * 🔴 `profileFieldsPresent` is NOT a consent reading and must never be rendered as
 * one. `me.ts` omits `isModerator` for any non-moderator and omits `email` for an
 * account that has none — both with consent fully granted — so an absence has two
 * causes and cannot distinguish them. `carriesUserRead` is the unambiguous one:
 * it reads the `tokenScope` bitmask the route echoes back, which is exactly the
 * value its own gate branches on.
 */
export interface MeReading {
  /** `null` when the route returned no `tokenScope`, i.e. this was not token auth. */
  tokenScope: number | null;
  /** Token auth echoes a `subject`; a cookie session does not. */
  tokenAuthenticated: boolean;
  carriesUserRead: boolean;
  carriesBuzzRead: boolean;
  /** Which of the three consent-gated profile fields came back. */
  profileFieldsPresent: string[];
  profileFieldsAbsent: string[];
  username: string | null;
}

const PROFILE_FIELDS = ['email', 'emailVerified', 'isModerator'] as const;

export function readMe(body: unknown): MeReading {
  const me = (body ?? {}) as Record<string, unknown>;
  const rawScope = me.tokenScope;
  const tokenScope = typeof rawScope === 'number' ? rawScope : null;
  const present: string[] = [];
  const absent: string[] = [];
  for (const field of PROFILE_FIELDS) {
    (field in me ? present : absent).push(field);
  }
  return {
    tokenScope,
    tokenAuthenticated: me.subject !== undefined && me.subject !== null,
    carriesUserRead: hasBit(tokenScope, TOKEN_SCOPE_BITS.UserRead),
    carriesBuzzRead: hasBit(tokenScope, TOKEN_SCOPE_BITS.BuzzRead),
    profileFieldsPresent: present,
    profileFieldsAbsent: absent,
    username: typeof me.username === 'string' ? me.username : null,
  };
}

/**
 * The one-line verdict.
 *
 * 🔴 A BLOCK TOKEN HAS TWO CAUSES AND THEY ARE NOT THE SAME NEWS. Measured live
 * 2026-09-25: the first run of this app reported "the opt-in did not take
 * effect" while the platform was in fact behaving exactly as designed — an
 * ungranted viewer makes the hub answer `consent_required`, and the host falls
 * back to a block JWT carrying the consent signal (civitai#5129) and renders its
 * "missing permissions" notice (civitai#5128). Consent then flipped the very same
 * session to `oauth`.
 *
 * So `withheldCount` is load-bearing and must not be dropped: a block token with
 * something still withheld is WAITING, and only a block token with nothing
 * withheld is a failed opt-in. Reporting the first as the second accuses the
 * platform of a defect it does not have — which, for an app whose entire purpose
 * is to be believed about this, is the worst thing it can do.
 */
export function verdict(
  kind: TokenKindReading,
  signedIn: boolean,
  withheldCount: number
): string {
  if (!signedIn) {
    return 'Signed out. The host mints an OAuth token only for a signed-in viewer, so there is nothing to probe yet.';
  }
  switch (kind) {
    case 'oauth':
      return 'The host honoured auth: "oauth" — this app holds an OAuth access token, which the public API accepts.';
    case 'block':
      return withheldCount > 0
        ? 'Waiting on your consent. The host fell back to an app token because this app has permissions you have not granted yet — that is the designed path, not a failure. Grant them and the token becomes an OAuth one.'
        : 'Every declared permission is granted and the host still sent an app token. The opt-in did not take effect.';
    case 'unknown':
      return 'The host sent no token kind. It predates the field, so which token this is cannot be read from the handshake.';
  }
}
