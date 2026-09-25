import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App, type Platform } from './App';
import { TOKEN_SCOPE_BITS } from './probe';

/**
 * The fake stands exactly where the platform does — at `token.kind`, `/api/v1/me`
 * and `requestGrants` — and no further in. That is deliberate: this app's whole
 * subject IS the platform boundary, so a fake placed inside it would answer a
 * conversation nobody is having.
 */
function platformFor(overrides: Partial<Platform> = {}): Platform {
  return {
    tokenKind: 'oauth',
    grantedScopes: ['user:read:self', 'buzz:read:self'],
    expiresAt: new Date('2026-09-25T18:00:00.000Z'),
    signedIn: true,
    me: vi.fn(async () => ({
      id: 8753561,
      username: 'zachlowdenzx',
      tier: 'free',
      status: 'active',
      email: 'someone@example.com',
      emailVerified: true,
      tokenScope: TOKEN_SCOPE_BITS.UserRead | TOKEN_SCOPE_BITS.BuzzRead,
      subject: { type: 'oauth', id: 'client_1' },
    })),
    requestGrants: vi.fn(async () => true),
    ...overrides,
  };
}

describe('App', () => {
  it('reports an OAuth token as the opt-in honoured, and reads /me', async () => {
    render(<App platform={platformFor()} />);

    expect(screen.getByTestId('token-kind')).toHaveTextContent('oauth');
    expect(screen.getByTestId('verdict')).toHaveTextContent('honoured');
    await waitFor(() => expect(screen.getByTestId('me-username')).toHaveTextContent('zachlowdenzx'));
    expect(screen.getByTestId('me-scope')).toHaveTextContent('65537');
    expect(screen.getByTestId('me-userread')).toHaveTextContent('yes');
    expect(screen.getByTestId('me-buzzread')).toHaveTextContent('yes');
    expect(screen.getByTestId('me-fields')).toHaveTextContent('email, emailVerified');
    expect(screen.getByTestId('withheld')).toHaveTextContent('none');
  });

  /** 🔴 The failure this app was built to make visible rather than infer. */
  it('reports an app token under an oauth manifest as a failed opt-in', async () => {
    render(<App platform={platformFor({ tokenKind: 'block' })} />);

    expect(screen.getByTestId('token-kind')).toHaveTextContent('block');
    expect(screen.getByTestId('verdict')).toHaveTextContent('did not take effect');
    await screen.findByTestId('me-username');
  });

  it('does not blame the opt-in when the host sent no kind at all', async () => {
    render(<App platform={platformFor({ tokenKind: undefined })} />);

    expect(screen.getByTestId('token-kind')).toHaveTextContent('unknown');
    expect(screen.getByTestId('verdict')).toHaveTextContent('no token kind');
    expect(screen.getByTestId('verdict')).not.toHaveTextContent('did not take effect');
    await screen.findByTestId('me-username');
  });

  it('asks for exactly the withheld scopes, not for everything declared', async () => {
    const platform = platformFor({ grantedScopes: ['user:read:self'] });
    render(<App platform={platform} />);

    expect(screen.getByTestId('withheld')).toHaveTextContent('buzz:read:self');
    await userEvent.click(screen.getByTestId('ask'));

    expect(platform.requestGrants).toHaveBeenCalledTimes(1);
    expect(platform.requestGrants).toHaveBeenCalledWith(['buzz:read:self']);
  });

  it('offers no ask button once every declared scope is granted', async () => {
    render(<App platform={platformFor()} />);
    expect(screen.queryByTestId('ask')).toBeNull();
    await screen.findByTestId('me-username');
  });

  /**
   * Paired control: the signed-out arm asserts /me is NOT called, and the
   * signed-in arm above asserts it IS — so a component wired to nothing cannot
   * pass both.
   */
  it('reads nothing for a signed-out viewer, and says so', () => {
    const platform = platformFor({ signedIn: false });
    render(<App platform={platform} />);

    expect(screen.getByTestId('verdict')).toHaveTextContent('Signed out');
    expect(screen.getByTestId('me-idle')).toBeTruthy();
    expect(platform.me).not.toHaveBeenCalled();
    expect(screen.queryByTestId('ask')).toBeNull();
  });

  it('surfaces a refusal from /me rather than rendering an empty profile', async () => {
    const platform = platformFor({
      me: vi.fn(async () => {
        throw new Error('missing required scope: user:read:self');
      }),
    });
    render(<App platform={platform} />);

    await waitFor(() =>
      expect(screen.getByTestId('me-error')).toHaveTextContent('missing required scope')
    );
    expect(screen.queryByTestId('me-username')).toBeNull();
  });

  /**
   * An absent profile field is NOT a withheld permission — `/api/v1/me` omits
   * `isModerator` for every non-moderator. The screen must keep saying the token
   * carries the scope.
   */
  it('keeps an absent profile field from reading as a withheld permission', async () => {
    const platform = platformFor({
      me: vi.fn(async () => ({
        id: 1,
        username: 'plain-user',
        tokenScope: TOKEN_SCOPE_BITS.UserRead,
        subject: { type: 'oauth', id: 'client_1' },
      })),
    });
    render(<App platform={platform} />);

    await waitFor(() => expect(screen.getByTestId('me-fields')).toHaveTextContent('none'));
    expect(screen.getByTestId('me-userread')).toHaveTextContent('yes');
  });
});
