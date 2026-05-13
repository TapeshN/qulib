# tools/auth

Everything related to authentication: detect what kind of auth an app uses, explore login paths, validate a saved storage state, apply auth config to a Playwright context, and turn auth failures into report gaps.

## Files

| File | What it does |
|---|---|
| `detect.ts` | `detectAuth(url)` — inspects the login page, returns the auth surface (none / oauth-only / form-login / mixed) plus `authOptions` with selectors. Also exports `validateStorageState`, `evaluateStorageStateValidity`, `preflightStorageStateFile`, and `waitForReturnToOrigin`. |
| `explore.ts` | `exploreAuth(url)` — walks multiple auth paths on a target URL for deeper discovery. |
| `apply.ts` | Applies a `HarnessConfig.auth` block to a Playwright `BrowserContext` (storage state, basic auth, custom cookies). |
| `surface.ts` | `analyzeAuthSurfaceGaps(...)` — investigates the gap surface adjacent to a login wall when authenticated crawling is blocked. |
| `gaps.ts` | `buildAuthBlockGap`, `buildStorageStateInvalidGap` — generate report gaps with stable reason codes and recovery hints. |
| `providers.ts` | `BUILT_IN_OAUTH_PROVIDERS` — known OAuth provider labels + IDs. |
| `custom-providers.ts` | `loadUserProviders` / `addUserProvider` / `removeUserProvider` / `listUserProviders` — user-defined OAuth providers persisted to disk. |

## Tests

- `__tests__/detect.test.ts` — detector, storage-state validation, origin-return helper.
- `__tests__/gaps.test.ts` — gap builders and recovery copy.

## Invariants

- No credentials, cookies, or storage state contents are logged or emitted as telemetry.
- Storage state validation is **honest**: invalid / wrong-origin / expired sessions block the scan with `releaseConfidence: 0` and a stable `StorageStateInvalidReason` code rather than returning a partial score.
- Cross-origin click-to-reveal during detection is rejected to avoid claiming the IdP's form belongs to the app.
