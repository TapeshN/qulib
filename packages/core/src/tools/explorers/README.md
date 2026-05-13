# tools/explorers

Adapters that launch a browser and crawl the app under test. Today Playwright is the production explorer; Cypress is a stub kept for the schema-level abstraction.

## Files

| File | What it does |
|---|---|
| `browser.ts` | `launchBrowser()` — central Chromium launch helper used by every explorer + auth tool. |
| `playwright.ts` | `PlaywrightExplorer` — discovers routes, runs axe-core (a11y), samples internal links for HEAD checks, records page snapshots. |
| `cypress.ts` | `CypressExplorer` — stub that throws on use; reserved for future Cypress-driven exploration. |
| `factory.ts` | `createExplorer(type)` — returns the right explorer for a `HarnessConfig.explorer` value. |
| `types.ts` | `AppExplorer` interface — the contract every explorer implements. |

## Where it's called from

`packages/core/src/phases/observe.ts` creates the explorer and runs `.explore(baseUrl, config, artifacts)`.

## Adding a new explorer

1. Create `your-explorer.ts` that implements `AppExplorer` from `./types.js`.
2. Wire it into `factory.ts` behind a new `HarnessConfig.explorer` enum value (additive change to `schemas/config.schema.ts`).
3. Add tests under `__tests__/`.
