import { describe, expect, it } from 'vitest';

import {
  classifyTokenKind,
  DECLARED_SCOPES,
  hasBit,
  readMe,
  TOKEN_SCOPE_BITS,
  verdict,
  withheldScopes,
} from './probe';

describe('classifyTokenKind', () => {
  it('reads the two kinds the host can send', () => {
    expect(classifyTokenKind('oauth')).toBe('oauth');
    expect(classifyTokenKind('block')).toBe('block');
  });

  /**
   * 🔴 The case the app exists to distinguish. An absent `kind` is a host that
   * predates the field; folding it into `block` would report "the opt-in failed"
   * for a host that never had an opinion.
   */
  it('keeps an absent or unrecognised kind as its own reading, never as block', () => {
    expect(classifyTokenKind(undefined)).toBe('unknown');
    expect(classifyTokenKind(null)).toBe('unknown');
    expect(classifyTokenKind('')).toBe('unknown');
    expect(classifyTokenKind('OAUTH')).toBe('unknown');
  });
});

describe('withheldScopes', () => {
  it('names the declared scopes the viewer has not granted', () => {
    expect(withheldScopes(['user:read:self', 'buzz:read:self'], ['user:read:self'])).toEqual([
      'buzz:read:self',
    ]);
  });

  it('is empty once every declared scope is granted', () => {
    expect(withheldScopes(['user:read:self'], ['user:read:self', 'models:read:self'])).toEqual([]);
  });

  it('reports every declared scope when nothing is granted', () => {
    expect(withheldScopes(DECLARED_SCOPES, [])).toEqual([
      'user:read:self',
      'buzz:read:self',
    ]);
  });
});

describe('hasBit', () => {
  /**
   * Fixture bits are pairwise distinct AND distinct from the constants the
   * assertions name, so a mutant that hardcodes either bit cannot survive.
   */
  it('reads one bit out of a mask without answering for its neighbours', () => {
    const both = TOKEN_SCOPE_BITS.UserRead | TOKEN_SCOPE_BITS.BuzzRead;
    expect(hasBit(both, TOKEN_SCOPE_BITS.UserRead)).toBe(true);
    expect(hasBit(both, TOKEN_SCOPE_BITS.BuzzRead)).toBe(true);
    expect(hasBit(TOKEN_SCOPE_BITS.UserRead, TOKEN_SCOPE_BITS.BuzzRead)).toBe(false);
    expect(hasBit(TOKEN_SCOPE_BITS.BuzzRead, TOKEN_SCOPE_BITS.UserRead)).toBe(false);
    // A neighbouring bit this app declares nothing for must not read as either.
    expect(hasBit(1 << 2, TOKEN_SCOPE_BITS.UserRead)).toBe(false);
  });

  it('treats a missing or non-numeric mask as carrying nothing', () => {
    expect(hasBit(undefined, TOKEN_SCOPE_BITS.UserRead)).toBe(false);
    expect(hasBit(null, TOKEN_SCOPE_BITS.UserRead)).toBe(false);
    expect(hasBit(Number.NaN, TOKEN_SCOPE_BITS.UserRead)).toBe(false);
  });
});

describe('readMe', () => {
  /** The shape `src/pages/api/v1/me.ts` sends a token-authenticated OAuth caller. */
  const grantedBody = {
    id: 8753561,
    username: 'someone',
    tier: 'free',
    status: 'active',
    isMember: false,
    subscriptions: [],
    email: 'someone@example.com',
    emailVerified: true,
    tokenScope: TOKEN_SCOPE_BITS.UserRead | TOKEN_SCOPE_BITS.BuzzRead,
    buzzLimit: null,
    subject: { type: 'oauth', id: 'client_1' },
  };

  it('reads the granted case off the bitmask, not off the field list', () => {
    const r = readMe(grantedBody);
    expect(r.tokenScope).toBe(65537);
    expect(r.tokenAuthenticated).toBe(true);
    expect(r.carriesUserRead).toBe(true);
    expect(r.carriesBuzzRead).toBe(true);
    expect(r.username).toBe('someone');
  });

  /**
   * 🔴 The ambiguity this app must not paper over: a MODERATOR-less account with
   * full consent is missing `isModerator` for a reason that has nothing to do
   * with consent. The reading stays a field list; the verdict comes off the mask.
   */
  it('separates an absent profile field from a withheld scope', () => {
    const r = readMe(grantedBody);
    expect(r.profileFieldsPresent).toEqual(['email', 'emailVerified']);
    expect(r.profileFieldsAbsent).toEqual(['isModerator']);
    // Absent field, yet the scope IS carried — so absence cannot mean withheld.
    expect(r.carriesUserRead).toBe(true);
  });

  it('reads an ungranted token as carrying neither scope', () => {
    const r = readMe({
      id: 1,
      username: 'x',
      tokenScope: 0,
      subject: { type: 'oauth', id: 'client_1' },
    });
    expect(r).toMatchObject({
      carriesUserRead: false,
      carriesBuzzRead: false,
      tokenAuthenticated: true,
      tokenScope: 0,
    });
    expect(r.profileFieldsPresent).toEqual([]);
  });

  it('reads a cookie session — no tokenScope, no subject — as not token-authenticated', () => {
    const r = readMe({ id: 1, username: 'x', tier: 'free', email: 'x@example.com' });
    expect(r.tokenScope).toBeNull();
    expect(r.tokenAuthenticated).toBe(false);
    expect(r.carriesUserRead).toBe(false);
  });

  it('survives a body that is not an object at all', () => {
    expect(readMe(null)).toMatchObject({ tokenScope: null, username: null });
    expect(readMe(undefined).profileFieldsAbsent).toEqual([
      'email',
      'emailVerified',
      'isModerator',
    ]);
  });
});

describe('verdict', () => {
  it('states a block token under an oauth manifest as a FAILED opt-in', () => {
    expect(verdict('block', true)).toContain('did not take effect');
  });

  it('states an oauth token as the opt-in honoured', () => {
    expect(verdict('oauth', true)).toContain('honoured');
  });

  it('does not blame the opt-in for an unknown kind', () => {
    const v = verdict('unknown', true);
    expect(v).toContain('no token kind');
    expect(v).not.toContain('did not take effect');
  });

  it('says signed-out before it says anything about the token', () => {
    expect(verdict('unknown', false)).toContain('Signed out');
    expect(verdict('oauth', false)).toContain('Signed out');
  });
});
