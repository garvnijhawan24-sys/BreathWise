# BreatheWise --- Security, Best Practices & Git Security Rules

**Applies to:** frontend, backend, data providers, ML pipeline, optional
database, GitHub, and deployment.

This is a practical project checklist, not a formal security
certification.

## 1. Non-Negotiable Rules

1.  Never commit API keys, tokens, passwords, database URLs, private
    keys, real `.env` files, or other secrets.
2.  Never expose provider secrets in frontend code or `VITE_` variables.
3.  Validate all client inputs server-side.
4.  Set timeouts for all external HTTP calls.
5.  Validate upstream response shape, values, units, and timestamps.
6.  Distinguish physical station observations from external model
    forecasts and local ML predictions.
7.  Missing data is not zero.
8.  Never invent model metrics or predictions.
9.  Use chronological time-series validation.
10. Do not assert pollution causation or a compliance violation without
    evidence.
11. Check source/API terms, attribution, rate limits, and redistribution
    rules.
12. Do not disable TLS certificate verification.
13. Do not expose stack traces or secret-bearing configuration to public
    clients.
14. Use least privilege for tokens, database roles, and deployment
    access.
15. Review the staged diff and repository history before public release.

## 2. Environment Variables and Secrets

### Local development

-   Keep real values in ignored `.env` files.
-   Commit `.env.example` with safe placeholders only.
-   Use separate development and production credentials where possible.
-   Rotate a key immediately if it is exposed.
-   Do not include secrets in screenshots, demos, README files, issue
    reports, or logs.

### Public vs private frontend variables

Allowed in frontend only if intentionally public: -
`VITE_API_BASE_URL` - Non-secret public feature flags.

Backend-only secrets: - `OPENAQ_API_KEY` - Search-provider keys -
Database URLs/passwords - Private tokens and signing keys.

**Vite exposes variables prefixed with `VITE_` in browser-accessible
assets. Never put secrets in them.**

### `.gitignore` baseline

``` gitignore
# Secrets
.env
.env.*
!.env.example
*.pem
*.key
secrets/
credentials/

# Python
__pycache__/
*.py[cod]
.venv/
venv/
.pytest_cache/
.mypy_cache/
.ruff_cache/
.coverage
htmlcov/

# Node
node_modules/
dist/
.vite/

# Local/private data and artifacts
data/private/
data/raw/
*.sqlite3
*.db
*.joblib
*.pkl
*.pickle

# Logs and editor/OS files
*.log
.DS_Store
Thumbs.db
.vscode/
.idea/
```

Review this ignore list before relying on it. An intentionally required
model artifact may need a documented, controlled deployment strategy.
`.gitignore` does not untrack a file that is already tracked.

## 3. Git and GitHub Security

### Before committing

``` bash
git status --short
git diff
git diff --cached
```

-   Prefer explicit staging and inspect the staged diff.
-   Avoid blindly running `git add .` without reviewing the working
    tree.
-   Keep commits small and descriptive.
-   Never commit unrelated private files or credentials.
-   Keep `main` deployable.
-   Run tests before pushing.
-   Use short-lived branches if useful; coordinate before rewriting
    shared history.

### Example initial workflow

``` bash
git init
git add README.md .gitignore frontend backend docs rules.md
git diff --cached
git commit -m "chore: initialize BreatheWise project"
git status
git log --oneline
```

Adapt paths to files that actually exist. Do not stage `.env` files.

### GitHub settings

Where available: - Enable secret scanning and push protection. - Enable
dependency alerts. - Use two-factor authentication. - Use narrowly
scoped tokens and revoke unused credentials. - Protect `main` if
collaborators are involved. - Avoid storing long-lived deployment tokens
in source code.

### If a secret is committed

1.  Revoke/rotate the secret immediately.
2.  Check provider usage logs.
3.  Remove it from current source.
4.  Clean Git history where appropriate using a suitable history-rewrite
    tool.
5.  Coordinate before force-pushing rewritten history.
6.  Assume old copies, forks, and clones may still contain the secret.

Deleting a secret in a later commit does not remove it from history.

## 4. API and Backend Security

### Input validation

Validate: - Latitude in `[-90, 90]`. - Longitude in `[-180, 180]`. -
`start <= end`. - Allowed pollutant identifiers. - Supported forecast
horizons. - Positive, bounded radius. - Bounded pagination/result
counts. - Provider-supported date windows.

Do not accept arbitrary Python expressions, SQL fragments, file paths,
or executable code from query parameters.

### HTTP requests and SSRF prevention

-   Use fixed trusted provider base URLs.
-   Do not let users submit arbitrary URLs for backend fetching.
-   Use connect/read timeouts and response-size limits.
-   Check status codes and content types.
-   Validate nested JSON before accessing it.
-   Bound retries and use backoff for retryable errors.
-   Do not retry indefinitely.
-   Never disable TLS verification.
-   Respect provider quotas and terms.

### Error handling

-   Return stable error codes and safe messages.
-   Log useful technical context server-side without secrets.
-   Do not return stack traces, filesystem paths, environment variables,
    or credentials.
-   Distinguish valid no-data results from provider failures.
-   Use suitable `502`/`503`/`504` responses for upstream
    failures/timeouts.

### CORS

-   Allow the known local origin during development.
-   In production allow the exact deployed frontend origin(s).
-   Do not combine wildcard origins with credentials.
-   CORS is not authentication and does not prevent direct API calls.

### Rate limits and resource controls

-   Consider per-IP rate limits on public endpoints.
-   Cache repeated coordinate/time queries briefly.
-   Bound date windows and result counts.
-   Monitor provider quotas.
-   Return clear errors when limits are reached.
-   Enforce limits on the backend, not only in the UI.

## 5. Data Integrity, Privacy, and Provenance

-   Preserve source/provider IDs, units, timestamps, and retrieval
    times.
-   Normalize timezones deliberately.
-   Do not convert missing values to zero.
-   Deduplicate with a documented rule.
-   Document interpolation, aggregation, and unit conversion.
-   Do not collect names, emails, or user accounts unless necessary.
-   Do not store location history by default.
-   Avoid logging precise coordinates with user identifiers unless
    necessary.
-   Check data licences and redistribution rules.
-   Attribute providers in UI and README.
-   Link reports to original sources.
-   Label official findings, news reports, and other material
    separately.
-   Never infer a compliance violation from proximity alone.
-   Do not claim a facility caused a spike without reliable evidence.

## 6. ML Security and Quality

### Training/data

-   Validate schema, units, timestamps, duplicates, and missingness.
-   Align hourly data before row-based lag features.
-   Use only past values in features.
-   Split chronologically.
-   Keep test data out of tuning and feature selection.
-   Compare with persistence baseline.
-   Track station, time range, feature list, model version, row counts,
    and metrics.
-   Do not claim generalization from one station to all locations.

### Artifacts

-   Load only artifacts from a trusted training workflow.
-   Treat pickle/joblib as executable content.
-   Never accept arbitrary model uploads or model URLs.
-   Store artifacts outside public static directories.
-   Record dependency versions.
-   Fail safely if artifacts are missing, corrupt, or incompatible.
-   Do not retrain on every API request.

### Forecast communication

-   Label external forecasts separately from local ML.
-   Include horizon and generation time.
-   Show MAE/RMSE only when computed on a real held-out set.
-   Do not call a range a confidence interval unless it is statistically
    justified.
-   If uncertainty is not calibrated, say so.
-   If no model is trained, show unavailable status rather than fake
    predictions.

## 7. Frontend Security and Quality

-   Do not embed secrets in source or frontend variables.
-   Render provider-supplied text as text, not raw HTML.
-   Avoid `dangerouslySetInnerHTML`; if unavoidable, sanitize with a
    reputable library.
-   Validate report links and use safe link attributes when opening a
    new tab.
-   Implement loading, no-data, stale-data, and error states.
-   Display units and timestamps.
-   Use correct local AQI breakpoints only if implementing AQI
    calculations.
-   Keep map tile attribution visible.
-   Test keyboard navigation, contrast, and mobile layout.
-   Do not rely on frontend checks to protect backend resources.

## 8. Database Security (If Used)

-   Use parameterized queries or a trusted ORM.
-   Use a least-privilege application database role.
-   Keep credentials in backend secrets.
-   Require TLS for remote DB connections.
-   Use migrations.
-   Validate all inputs before queries.
-   Index time-range queries and foreign keys where useful.
-   Back up important data and test restoration if needed.
-   Set retention policies for raw readings/cache.
-   Avoid unnecessary personal data.
-   If using Supabase client-side access, enable and test row-level
    security.
-   Never expose the Supabase service-role key in the frontend.

## 9. Dependency and Deployment Security

-   Use a Python virtual environment.
-   Record dependencies in `requirements.txt` and `package.json`.
-   Review upgrades and security advisories.
-   Avoid installing from unknown package URLs or repositories.
-   Configure production secrets in host settings.
-   Limit deployment access.
-   Verify production CORS and API base URL.
-   Disable verbose debug behaviour in production.
-   Ensure model artifacts/dependencies are present.
-   Test the actual public frontend and backend.

### Deployment checklist

-   [ ] Frontend loads.
-   [ ] Backend `/api/health` works.
-   [ ] Frontend reaches backend.
-   [ ] CORS permits exact frontend origin.
-   [ ] OpenAQ key is backend-only.
-   [ ] No secrets in browser bundle or Git history.
-   [ ] External requests time out safely.
-   [ ] Missing/untrained model is handled.
-   [ ] Source attribution is visible.
-   [ ] Logs do not expose credentials.

## 10. Testing and Review Gate

### API

-   [ ] Health endpoint returns 200.
-   [ ] Invalid coordinates return 422.
-   [ ] Provider timeout handled.
-   [ ] Malformed upstream payload handled.
-   [ ] Missing pollutant remains unavailable/null.
-   [ ] Valid no-data request returns clear empty response.

### Analytics and ML

-   [ ] Known-sample trend results are correct.
-   [ ] Empty series do not create fake statistics.
-   [ ] Percentage change handles zero/absent baseline.
-   [ ] Features use only past data.
-   [ ] Chronological split is used.
-   [ ] Baseline metrics are compared.
-   [ ] Missing model fails safely.

### UI

-   [ ] Map selection updates location.
-   [ ] Date filters refresh data.
-   [ ] Observation and forecast styles differ.
-   [ ] No-station state works.
-   [ ] Report links work.
-   [ ] Mobile layout is usable.

### Repository

-   [ ] `.env` is ignored.
-   [ ] `.env.example` has placeholders only.
-   [ ] No private data/secrets are tracked.
-   [ ] No unnecessary binary files.
-   [ ] README has setup and deployment steps.
-   [ ] Staged diff reviewed.
-   [ ] History checked for accidental secret commits.

## 11. Incident Response

If a credential/private file is exposed: 1. Revoke/rotate the credential
immediately. 2. Check usage logs and account activity. 3. Remove the
secret from current code. 4. Clean Git history if needed. 5. Coordinate
before rewriting shared history. 6. Redeploy with the new secret. 7. Add
a prevention check to avoid recurrence.

A repository privacy change or deletion commit does not make an exposed
secret safe again.

## 12. Final Rule

Ship a small, reliable, transparent, and secure system. Correct
provenance, honest ML evaluation, safe credential handling, graceful
failures, and reproducible documentation matter more than unfinished
features.
