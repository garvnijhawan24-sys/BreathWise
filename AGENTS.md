# BreatheWise — Agent Instructions

These instructions apply to every AI coding agent working in this repository. Follow them alongside `docs/implementation_plan.md`, `docs/architecture.md`, `docs/ml_pipeline.md`, `docs/backend_schema.md`, `docs/database_schema.md`, and `rules.md`.

## Product goal
Build BreatheWise, a web application for monitoring air quality and forecasting conditions in user-selected regions. Users should be able to explore current observations, historical trends, forecasts, potential pollution hotspots, and sourced environmental/compliance reports.

Clearly distinguish:
- Observed measurements from monitoring stations.
- Forecasts supplied by external providers.
- BreatheWise ML predictions.
- Demo/sample data, which must be visibly labelled.
- Unavailable data.

Never fabricate readings, forecasts, monitoring stations, environmental incidents, or regulatory violations. Attribute sourced reports and show their dates.

## Before changing code
1. Read all six specification/rules files listed above.
2. Inspect the repository, dependency manifests, existing code, and `git status`.
3. Preserve existing user work.
4. Identify conflicts or missing requirements and propose a resolution before making major architectural changes.
5. Start with an audit and prioritized plan; do not begin a large implementation before reporting the plan.

## Technology and providers
Follow the documented stack: React, Vite, TypeScript, Tailwind CSS, React Leaflet/Leaflet, Recharts; Python, FastAPI, HTTPX, Pydantic, Pandas/NumPy; scikit-learn for the documented ML model. Use Open-Meteo Air Quality API and OpenAQ API v3 as specified. PostgreSQL/Supabase is optional unless the implementation plan makes it required. Do not replace the stack or add major dependencies without explaining why and updating docs.

Verify current official provider documentation for endpoint paths, authentication, quotas, response fields, attribution, licensing, and terms. Use OpenAQ API keys only as required by the endpoints being used. Do not assume OpenAQ provides a complete environmental-compliance/violation database; use a separate verifiable source or show reports as unavailable.

Keep provider integrations in separate service/client modules. Add request timeouts, error handling, rate-limit handling, response validation, and caching where appropriate. Normalize units, timestamps, pollutants, coordinates, and station identifiers. Preserve provenance. Missing data is not zero. Do not scrape or bypass provider access controls.

## ML integrity
Do not train or evaluate on fabricated or unverified data. Document target, horizon, sampling frequency, features, source, and limitations. Use chronological train/validation/test splits and prevent temporal leakage in lag/rolling features. Compare against a persistence baseline and report actual metrics (such as MAE/RMSE). Do not claim accuracy until evaluation has run. Treat serialized model artifacts as potentially unsafe; load only trusted artifacts. If a trained model or suitable data is unavailable, show a clear unavailable/not-trained state. Label provider forecasts separately from BreatheWise ML predictions.

## Code quality
- Follow the documented architecture and existing conventions.
- Keep modules focused; do not put the entire app in one file.
- Use TypeScript types and Pydantic schemas at system boundaries.
- Keep route handlers thin; separate provider clients, business logic, and data processing.
- Use explicit environment-based configuration.
- Handle exceptions deliberately; do not silently swallow errors or return fake success responses.
- Build accessible, responsive UI with loading, empty, stale-data, and error states.
- Log useful diagnostics without credentials, tokens, or sensitive data.
- Add tests for parsing, validation, core logic, endpoints, and data processing.
- Update README and docs when setup or implementation changes.

## Security
Follow `rules.md`. Never hardcode or expose secrets. Never commit `.env`, tokens, private keys, credentials, or sensitive datasets. `.env.example` must contain placeholders/defaults only. Validate user inputs and bound date ranges, coordinates, pagination, and query sizes. Avoid arbitrary URL-fetching endpoints that could enable SSRF. Restrict production CORS to expected frontend origins. Use parameterized SQL or a safe ORM. Add appropriate rate/resource limits. Never log secrets or disable security controls to make tests pass. Do not collect personal data or add authentication unless the scope requires it.

## Git and file safety
Inspect `git status` before edits. Preserve unrelated changes. Do not delete user files, overwrite unrelated work, force-push, rewrite shared history, or commit/push without explicit approval. Keep caches, local databases, generated datasets, and model artifacts out of Git unless deliberately approved and documented. If a secret is exposed, stop and report it; recommend revocation/rotation and investigate Git history.

## Required workflow
1. Audit repository and requirements.
2. Propose a phased plan, files to change, dependencies, risks, and acceptance checks.
3. Set up frontend/backend and local configuration.
4. Implement and test provider integrations.
5. Implement documented backend endpoints and schemas.
6. Build frontend features and connect them to real endpoints.
7. Implement reproducible ML preprocessing, chronological evaluation, and baseline comparison.
8. Run tests, lint/type checks, and production builds where configured.
9. Document exact setup/run/test commands, known limitations, and deployment steps.

Do not attempt every phase in one unreviewed change. At the end of each phase report changed files, features completed, commands/tests and actual results, blockers, and next steps. Never claim a command, test, or deployment succeeded unless verified.

## Definition of done
A feature is done only when it has been tested. The app should start using documented commands; API failures should be handled; units, timestamps, source provenance, and forecast types should be visible; tests/builds should pass or failures be reported; secrets must not be exposed; and docs must match the implementation.

**Initial instruction:** Audit only. Read the specifications, inspect the repository and Git status, then report findings and a prioritized implementation plan before substantial code changes.
