# BreatheWise — API and Environment Configuration

## Open-Meteo Air Quality API
- Official documentation: https://open-meteo.com/en/docs/air-quality-api
- Base URL: `https://air-quality-api.open-meteo.com/v1/air-quality`
- Standard public requests generally do not require an API key. Verify current access, usage terms, limits, and attribution requirements before production use.
- Preserve timestamps, timezone, units, and source attribution.
- Label results as provider forecasts, not BreatheWise ML predictions.

## OpenAQ API v3
- Official documentation: https://docs.openaq.org/
- Base URL: `https://api.openaq.org/v3`
- Use it for locations, sensors, and measurements supported by the current API.
- Authentication requirements can vary by endpoint and current policy. Check official docs and obtain a key if required.
- If needed, store it in `OPENAQ_API_KEY` in the backend `.env` or hosting provider's secret manager. Follow the current official authentication instructions; do not guess header names or rely on obsolete API versions.
- OpenAQ should not be assumed to provide a complete database of regulatory violations or environmental compliance incidents.

## Optional PostgreSQL / Supabase
Use only if persistence is required for the chosen implementation phase. Keep database credentials server-side and use least-privilege access. Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code or any `VITE_*` variable. Configure hosted secrets through the deployment platform's secret manager.

## Local setup
1. Copy `.env.example` to `.env`.
2. Fill only the values required for the features being developed.
3. Confirm `.env` is ignored by Git.
4. Start the frontend/backend using commands documented in the repository README.
5. Verify the health endpoint and check logs for configuration errors.
6. Never paste actual secret values into prompts, issue trackers, screenshots, or documentation.

## Variables
| Variable | Required? | Purpose |
|---|---|---|
| `APP_ENV` | Yes for environment config | Local/staging/production |
| `CORS_ORIGINS` | Backend setup | Allowed frontend origins |
| `OPEN_METEO_AIR_QUALITY_BASE_URL` | Default provided | Open-Meteo endpoint |
| `OPENAQ_API_KEY` | Only if chosen endpoints require it | Server-side OpenAQ authentication |
| `OPENAQ_BASE_URL` | Default provided | OpenAQ v3 API |
| `DATABASE_URL` | Optional | PostgreSQL connection |
| `SUPABASE_URL` | Optional | Supabase project URL |
| `SUPABASE_ANON_KEY` | Optional | Public/anonymous key; use correct RLS policies |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional, backend only | Privileged Supabase access |
| `MODEL_PATH` | When ML inference exists | Trusted trained model artifact |
| `ML_MODEL_ENABLED` | Optional | Keep false until a model is trained and evaluated |
| `VITE_API_BASE_URL` | Frontend config | Public backend URL; must not contain a secret |

Validate required configuration at startup and report missing variable names without printing their values.

## Suggested `.gitignore` additions
```gitignore
.env
.env.*
!.env.example
.venv/
__pycache__/
*.py[cod]
.pytest_cache/
.mypy_cache/
.ruff_cache/
node_modules/
dist/
coverage/
*.sqlite
*.sqlite3
*.db
*.log
.cache/
data/raw/
data/processed/
backend/models/*.joblib
backend/models/*.pkl
```
Adjust paths to the actual repository. Track only intentionally selected, licensed, non-sensitive data or model artifacts. Serialized model files can be unsafe if untrusted.

## Production checklist
- Re-check official provider docs for authentication, quotas, attribution, licensing, and retention.
- Keep local, staging, and production secrets separate.
- Configure CORS to exact production frontend origins.
- Add timeouts and handle provider outages/rate limits.
- Use least-privilege database access and parameterized queries.
- If a key is exposed, revoke/rotate it immediately and investigate Git history.
- Never return fabricated readings when a provider fails.
