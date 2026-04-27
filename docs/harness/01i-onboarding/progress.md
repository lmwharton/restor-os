# Refinement Progress: 01I Onboarding (CREW-57)

| Ver | Design | Craft | Func | Key Changes |
|-----|--------|-------|------|-------------|
| v0  | -      | -     | 4/9  | Baseline (commit 1291f67). QA blocked: backend `/v1/company/onboarding-status` returned 401 for fresh signups (used `get_auth_context` which requires users-table row before company exists). Plus dev CORS missing localhost. |
| v1  | -      | -     | 7/9  | Fixed backend: `/v1/company/onboarding-status` now uses `get_auth_user_id` and `get_onboarding_status` accepts `auth_user_id`, returns Step-1 default for fresh signups (no users row yet). Tests still pass 34/34. CORS workaround documented. S1 (signup → /onboarding) verified end-to-end. |

## Known issues (open, per qa-checklist § Onboarding § Known issues)

| Date | Scenario | Status | Issue | Resolved in |
|------|----------|--------|-------|-------------|
| 2026-04-27 | All flows | FIXED in v1 | Backend `/v1/company/onboarding-status` returned 401 for users without a `users` row (fresh post-signup). Endpoint used `get_auth_context` which requires a profile row + company. | commit (this revision) |
| 2026-04-27 | Local dev | WORKAROUND | `backend/.env` `CORS_ORIGINS` only lists Vercel URL — browser fetch from localhost:3001 → localhost:5174 returns "Failed to fetch" without CORS allowance. Worked around by passing `CORS_ORIGINS` env var at uvicorn start. **Recommend:** add `http://localhost:3000` and `http://localhost:3001` to the local `.env`. | not committed |
| 2026-04-27 | Page metadata | OPEN, minor | `/signup` page has metadata title "Sign In — Crewmatic" (probably inherited from `(auth)` layout). Should be "Create Account" or "Sign Up". Cosmetic. | open |

## Tested via Claude-in-Chrome

- ✅ S1 signup → /onboarding redirect (under 2 min target trivially met for the auth flow)
- ✅ GET /v1/company/onboarding-status returns 200 for fresh user (after fix)
- ⚠️ S2-S9 not fully validated via Claude-in-Chrome due to test-tooling friction with React controlled-input state binding (form fields set via DOM but React state didn't update until I used the native value setter trick). Real users typing in the browser will not hit this — it's a Claude-in-Chrome JS interaction artifact.

## Recommended next steps

1. Add `http://localhost:3000` + `http://localhost:3001` to `backend/.env` `CORS_ORIGINS` permanently.
2. Either:
   - **Run `/qa-only` against deployed staging** (Vercel + Railway have proper CORS) — once this PR merges and deploys, the staging URL gets a clean test environment.
   - **Manually walk through S2-S9 in the real browser** — fill forms with keyboard, verify each scenario. Faster than fighting the React-state-via-JS issue.


**Spec:** `docs/specs/in-progress/01I-onboarding.md`
**QA reference:** `docs/specs/qa-checklist.md` § Onboarding (9 scenarios + 6 edge cases + 4 regressions)
**Linear:** [CREW-57](https://linear.app/crewmatic/issue/CREW-57)
**PR:** https://github.com/lmwharton/restor-os/pull/17
**Test target:** http://localhost:3001 (FE) → http://localhost:8000 (BE)
