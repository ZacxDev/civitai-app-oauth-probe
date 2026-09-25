import { getTransport, initialize } from '@civitai/sdk';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App, type Platform } from './App';
import './styles.css';

/**
 * The one adapter from `@civitai/sdk` onto {@link Platform}.
 *
 * 🔴 `token.kind` is read from the TRANSPORT SNAPSHOT rather than captured once:
 * the host rotates the token, and an opt-in block on a host whose flag flips on
 * gets an `oauth` token only on the next refresh. A captured value would report
 * the handshake's first answer forever, which is the reading this app is least
 * allowed to get wrong.
 */
async function boot() {
  const transport = getTransport();
  const app = await initialize({ transport });
  const snapshot = () => transport.snapshot.get();

  const platform: Platform = {
    get tokenKind() {
      return snapshot().token.kind;
    },
    get grantedScopes() {
      return snapshot().token.scopes ?? [];
    },
    get expiresAt() {
      const at = snapshot().token.expiresAt;
      return at instanceof Date ? at : null;
    },
    get signedIn() {
      return app.viewer !== null;
    },
    me: () => app.site.get('/me'),
    requestGrants: (scopes) => app.requestGrants(scopes as never),
  };

  const root = createRoot(document.getElementById('root')!);
  const render = () =>
    root.render(
      <StrictMode>
        <App platform={platform} />
      </StrictMode>
    );

  render();
  // The host re-sends on every token refresh and theme change; re-render so the
  // kind on screen is the kind held now.
  app.onChange(render);
}

void boot().catch((err: unknown) => {
  const root = document.getElementById('root');
  if (root) {
    root.textContent = `OAuth Probe could not start: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
});
