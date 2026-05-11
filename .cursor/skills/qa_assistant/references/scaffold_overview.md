# Scaffold overview

The TypeScript Playwright scaffold under `.cursor/skills/qa_assistant/scaffold/` is a **vendored copy** (not a submodule) of `Playwright-Scaffold-AI-Assisted-Development`. The qa_assistant skill owns the scaffold from the moment it lands in this repo: edit it, extend it, and document its rules here under `references/scaffold_*.md`. Do not treat it as upstream-tracking — there is no sync flow.

**Why vendored, not submodule:** the scaffold's lifecycle is now bound to this repo (cards 3–7 of epic [`TsZ362XC`](https://trello.com/c/TsZ362XC) reshape it for our booking-flow needs — `BookingInputs`, per-phase runners, `--mode api`, validation/cleanup shells). A submodule would force every change through an upstream PR; vendoring lets the QA work move at its own pace.

## Layout (tracked under `scaffold/`)

| Path | Purpose |
|------|---------|
| `playwright.config.ts` | Config: 4 named projects (`flighthub-staging2`, `flighthub-production`, `justfly-staging2`, `justfly-production`) + a per-brand `setup-*` project; loads `env/.env` via dotenv. |
| `package.json` | Node deps. `name=qa-assistant`. No DB clients (those stay on the `db_access` Python CLIs per epic scope). |
| `tsconfig.json`, `eslint.config.mts`, `.prettierrc`, `.nvmrc` | TS / lint / format / Node-version pins. |
| `fixtures/pom/test-options.ts` | The single import point — `import { test, expect } from 'fixtures/pom/test-options'`. Composes `pageObjectFixture` + `apiRequestFixture` + `helperFixture` via `mergeTests`. |
| `fixtures/api/` | `apiRequest` fixture (Playwright `request` context wrapper) + Zod schema helpers. |
| `fixtures/pom/page-object-fixture.ts` | Per-brand page objects registered as DI fixtures (never `new SomePage(page)` from a test). |
| `fixtures/helper/` | Lifecycle setup/teardown fixtures. |
| `pages/{flighthub,justfly,shared}/` | Page-Object Model classes — get-accessor locators + action methods. Selector strategy lives below. |
| `helpers/{flighthub,justfly,shared,util}/` | Plain utility functions (no Playwright fixture lifecycle). |
| `config/{flighthub,justfly,shared}.ts` + `config/util/` | Resolved env-driven config objects (URLs, credentials, feature flags). |
| `enums/{flighthub,justfly,shared,util}/` | TS enums for endpoint paths, UI messages, roles, storage-state paths. |
| `test-data/factories/` + `test-data/static/` | Faker + Zod data factories (dynamic happy-path) and `as const` static `.ts` files (curated invalid sets, type-mismatch arrays). Never `.json`. |
| `tests/{flighthub,justfly,shared}/{e2e,functional,api}/` | Specs. `tests/shared/` runs under both brand projects; brand-scoped tests under `tests/{brand}/`. Each `auth.setup.ts` populates a brand `storageState` before the chromium project tests run. |

## Env loader (TARGET model)

`playwright.config.ts` reads exactly one file: `env/.env` (gitignored — copy `env/.env.example` to bootstrap). The active `(brand, environment)` pair is selected at run time via the `TARGET` env var of the form `<brand>-<environment>`:

```bash
TARGET=flighthub-staging2  npx playwright test --project=flighthub-staging2
TARGET=flighthub-production npx playwright test --project=flighthub-production
TARGET=justfly-staging2    npx playwright test --project=justfly-staging2
TARGET=justfly-production  npx playwright test --project=justfly-production
```

Default `TARGET` is `flighthub-staging2` (the team has no dev environment, so staging2 is the standing default for local runs).

After dotenv loads `env/.env`, the loader walks every key starting with `<BRAND>_<ENV>_` and re-exports it as `<BRAND>_<KEY>`. So `FLIGHTHUB_STAGING2_APP_URL` becomes `FLIGHTHUB_APP_URL` when `TARGET=flighthub-staging2`. Consumer code reads `process.env.FLIGHTHUB_APP_URL` and is unaware which environment is active. Shared keys (`MYSQL_HOST`, `APP_EMAIL`, `RESPRO_*`) live unprefixed in the file and are read straight through.

`process.env.BRAND` and `process.env.ENVIRONMENT` are also exported so helpers can branch at runtime.

**`VALID_ENVIRONMENTS = ['staging2', 'production']`** — the four envs the epic targets. Adding `staging1` / `staging3` is a future-card change, not a vendoring change.

## How to use it (cards 3–7 onward)

| Card | What it adds |
|------|--------------|
| **3** ([cAaIXc3d](https://trello.com/c/cAaIXc3d)) | `BookingInputs` parameter surface + factories under `test-data/factories/`. |
| **4** ([yyiDWndi](https://trello.com/c/yyiDWndi)) | Per-phase UI runners (`qa-search` / `qa-checkout` / `qa-book` / `qa-cleanup`) implemented as TS scripts that drive the POM via `mergeTests`-composed fixtures. Headless + headed. |
| **5** ([zutcAJq7](https://trello.com/c/zutcAJq7)) | `--mode api` per phase — the same runners hit `apiRequest` instead of POM. Default mode. |
| **6** ([PqpECrIE](https://trello.com/c/PqpECrIE)) | `qa-validate` / `qa-cleanup` / `qa-search-telemetry` / `qa-report` TS shells that exec the existing `db_access` Python CLIs (`mysql_query.py`, `mongo_query.py`, `clickhouse_query.py`) for DB evidence. |
| **7** ([ypIXbRTm](https://trello.com/c/ypIXbRTm)) | Cutover. Delete `legacy_python/`. Finalize `SKILL.md`. |

## Hard rules (carried over verbatim)

- **No DB clients in `package.json`.** DB access lives on the `db_access` Python CLIs (`.cursor/skills/db_access/scripts/{mysql,mongo,clickhouse}_query.py`). The TS shells in card 6 spawn those scripts as subprocesses.
- **AI is the brain. Runners are stateless single-phase tools.** No retry loops, no verdict logic, no auto-chaining inside a runner. JSON on stdout; logs on stderr; the agent classifies pass/fail in chat against `references/validation_checklist.md`.
- **Content-source pinning:** when the user names a content source, `qa-book` must pin to it (the Python runner's `--content-source` flag with auto-flip of "Disable Optimizer/Repricer = Yes"). Cards 4–6 carry this rule into the TS runners verbatim.
- **`--carrier <IATA>` always means marketing/validating carrier**, never operating-only. Confirm `mysql.bookings.validating_carrier` matches before reporting success.
- **One card → one branch → one PR** (per `automation_cards.md`). Card 7 is the only card that deletes Python.

## Skills the upstream scaffold ships (folded into rules)

The vendored `.cursor/skills/qa_assistant/` deliberately omits the upstream scaffold's `.cursor/skills/*` (those documented the *generic* TS-Playwright patterns under their own framework's voice). The patterns themselves still apply — they live here under `references/scaffold_*.md` as the qa_assistant skill takes ownership of the rules. Today's coverage:

- `scaffold_overview.md` (this file) — layout, env loader, vendoring rationale, hard rules.

Cards 3–7 add focused references as they need them: `scaffold_fixtures.md` (composition + DI), `scaffold_page_objects.md` (class shape + get-accessor locators + selector priority), `scaffold_test_standards.md` (spec file structure, tags), `scaffold_data_strategy.md` (factories vs static), and `scaffold_api_testing.md` (`apiRequest` + Zod). Add new files when a card's diff makes a rule load-bearing.
