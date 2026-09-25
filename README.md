# OAuth Probe

A diagnostic Civitai App. It is the **first app to declare `auth: "oauth"`**, and it
exists to make the OAuth token path observable in production rather than inferred
from source.

`APP_BLOCK_OAUTH_TOKENS_ENABLED="true"` has been live in all three
`civitai-dp-prod` manifests since `ca2b3ee43`, while **0 of 7** fleet apps declare
`auth`. Every defect found in that path so far — `civitai#5127`, `#5128`, `#5129`,
`#5130` — was found by *reading* it. This app runs it.

## What it puts on screen

| Reading | Source |
|---|---|
| Token kind (`block` / `oauth` / `unknown`) | the host handshake's `token.kind` |
| Token expiry and granted permissions | the same handshake |
| Declared-but-not-granted permissions | the manifest's `scopes` minus the above |
| `tokenScope` bitmask, and whether it carries each declared scope | `GET /api/v1/me` |
| Which profile fields the API returned | the same response |

A button asks for the withheld permissions — and asks for **exactly** those, never
for the whole declared set.

## Why it is shaped this way

**`unknown` is a third reading, not a synonym for `block`.** `kind` is optional on
the wire and a host predating the field sends none, so folding an absent value into
`block` would report a stale host as a failed opt-in. `src/probe.ts`
(`classifyTokenKind`) keeps the three apart and `probe.test.ts` pins it.

🔴 **An absent profile field is not a withheld permission, and the app says so on
screen.** `src/pages/api/v1/me.ts` omits `isModerator` for every non-moderator and
omits `email` for an account that has none — both with consent fully granted. An
absence therefore has two causes and distinguishes neither. The unambiguous reading
is the `tokenScope` bitmask the route echoes back, which is the exact value its own
gate branches on, so that is what the verdict is taken from.

**The token kind is read live, never captured.** The host rotates the token, and an
opt-in app on a host whose flag flips on gets an `oauth` token only on the next
refresh. `src/main.tsx` reads `transport.snapshot.get()` on every render and
re-renders from `app.onChange`.

## Scopes

| Scope | Consent | Why |
|---|---|---|
| `user:read:self` | gated | The one capability an OAuth token actually unlocks today: `hasFlag(…TokenScope.UserRead)` is checked in exactly one non-test file, `src/pages/api/v1/me.ts`. It is also **mandatory** — `manifestCanMintOauthToken` (civitai `#5129`) refuses to enter the OAuth branch for an `auth: "oauth"` manifest that omits it, because the minted token unavoidably carries the matching bit. |
| `buzz:read:self` | gated | Declared, not called. A second gated scope is what makes a *partial* grant possible on screen; with one declared scope the app can only ever show all-or-nothing. |

Deliberately absent:

- **`apps:storage:*`** — `BlockManifestValidator` refuses it alongside `auth: "oauth"`
  (civitai `#5130`). This is why no existing fleet app could be the first opt-in:
  every one of the other six declares at least two storage scopes.
- **`ai:write:budgeted`** — spend caps are not reconciled across the two token paths.
  A direct-to-orchestrator call escapes the per-app cap, the per-viewer daily cap,
  the mandatory `whatIf` and the `app-block:<appId>` attribution tag. Until that is
  settled, the first opt-in must not be able to spend.

## Develop

```bash
pnpm install
pnpm test          # 24 tests
pnpm run typecheck
pnpm run build
```

🔴 **`civitai app validate` cannot check the thing this app is about.** Measured
against CLI `0.1.105`: it reports `✓ is valid` for `auth: "nonsense"`, for an
unknown top-level key, and — the one that matters — for `auth: "oauth"` alongside
`apps:storage:read`, which the server refuses. A local green is therefore no
evidence the submit will be accepted; the submit is the test.

## Not what it is

It stores nothing, writes nothing to the viewer's account, generates nothing and
spends no Buzz. It has no function beyond the table above.
