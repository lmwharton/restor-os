# 02 — AI Photo Analysis (umbrella)

> Engineering umbrella for the AI Photo Analysis project. Defines the orchestrator. Sub-specs (02A, 02B, future 02C/D) plug into this pipeline.

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/5 phases) |
| **State** | 📋 Planned |
| **Blocker** | Property Data Model (CREW-11/12/13) — needs job + property context |
| **Branch** | TBD |
| **Issue** | CREW-23 |
| **Linear Tech Plan** | [02 AI Photo Analysis (umbrella)](https://linear.app/crewmatic/document/tech-plan-02-ai-photo-analysis-umbrella-771c96e282ef) |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-27 |
| Started | — |
| Completed | — |
| Sessions | 0 |

## Done When
- [ ] `POST /v1/analysis` accepts `{ photo_ids: [], job_id }` and returns analysis ID
- [ ] Context aggregator builds full bundle: job (cat/class/source/carrier), property (year_built/address), capture (room/transcript/nearby photos), contractor (pricing/regional rates)
- [ ] Celery + Redis pipeline runs each pass with shared context
- [ ] SSE streams pass results back to UI as they complete
- [ ] Unified `analysis` row stores all pass outputs (line items, hazmat, future materials/dimensions)
- [ ] Cost + reasoning logged per pass for telemetry
- [ ] All sub-specs (02A line items, 02B hazmat) consume this pipeline

## What this owns

- Context aggregator (full job/property/capture/contractor bundle)
- Multi-pass Claude orchestration (Celery, Redis, SSE)
- Unified `analysis` output schema
- Photo selection UX (which photo(s) to analyze)
- Cost / telemetry / observability

## What this does NOT own

- Photo or voice capture (see 03A/B/C)
- Pass-specific reasoning (each pass owns its prompt — see 02A, 02B)
- UI rendering of any output type (each pass owns its lens — Line Items tab, Hazards tab)

## Sub-specs

- **02A Line Items Pass** — Xactimate line items with citations
- **02B Hazmat Pass** — asbestos + lead findings
- *Future:* 02C Materials, 02D Dimensions

## Phases

1. Context aggregator + `analysis` schema
2. Celery + Redis worker scaffolding
3. Pass interface (each pass implements `run(context) -> partial output`)
4. SSE streaming back to UI
5. Wire up 02A and 02B as the first two passes

## Linked

- Brett's PRDs: Estimator Tool UX + Estimating Engine Internals
- Issues: CREW-22, 23, 24
