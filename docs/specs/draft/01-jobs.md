# Jobs — Create, Photos, PDF, Full Job Lifecycle

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/5 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 00 (bootstrap) must be complete |
| **Branch** | TBD |
| **Issue** | TBD |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-03-24 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Done When
- [ ] User can create a job with address + loss type (2 required fields, rest optional)
- [ ] User can view job list with status badges (Needs Scope / Scoped / Submitted)
- [ ] User can view job detail with all fields editable
- [ ] User can upload photos (up to 100 per job, JPEG/PNG, 10MB max each)
- [ ] User can organize photos: tag by room, set photo type (damage/equipment/protection/before/after)
- [ ] User can select specific photos for AI analysis
- [ ] User can delete a photo (tap-and-hold on mobile)
- [ ] User can export job as branded PDF (company header, line items table, photo grid)
- [ ] User can share job via a link (read-only view)
- [ ] User can delete a job
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Brett needs to manage jobs — from the initial phone call to submitting documentation to the adjuster. Today he uses paper + iPhone + scattered photos across Google Drive and Notes. There's no single place to track a job and its documentation.

**Solution:** A complete job management system where the contractor creates a job (minimal fields), uploads photos (organized by room and type), and exports everything as a branded PDF. This is the container that the AI Pipeline (Spec 02) plugs into.

**Scope:**
- IN: Job CRUD, photo upload/organize/tag/delete, PDF export, share link, job list with filters, job detail with editable fields, mobile-responsive
- OUT: AI Photo Scope (Spec 02), moisture readings, equipment tracking, scheduling, team assignment, voice scoping

## Phases & Checklist

### Phase 1: Job CRUD Backend — ❌
- [ ] Create `api/jobs/schemas.py` — Pydantic models for job create/update/response
- [ ] Create `api/jobs/service.py` — job business logic (create, list, get, update, delete)
- [ ] Create `api/jobs/router.py` — route handlers
- [ ] `POST /v1/jobs` — create job (required: address_line1, loss_type; optional: everything else)
- [ ] `GET /v1/jobs` — list jobs for company (filter by status, search by address/customer, paginate)
- [ ] `GET /v1/jobs/:id` — get job detail (with photo count, line item count)
- [ ] `PATCH /v1/jobs/:id` — update job fields
- [ ] `DELETE /v1/jobs/:id` — soft delete or hard delete job
- [ ] Auto-generate job_number format: `JOB-YYYYMMDD-XXX`
- [ ] Filter company_id from auth context on all queries
- [ ] pytest: create job with minimal fields (address + loss type)
- [ ] pytest: create job with all fields populated
- [ ] pytest: list jobs returns only current company's jobs
- [ ] pytest: update job fields
- [ ] pytest: delete job

### Phase 2: Photo Backend — ❌
- [ ] Create `api/photos/schemas.py` — Pydantic models
- [ ] Create `api/photos/service.py` — photo business logic
- [ ] Create `api/photos/router.py` — route handlers
- [ ] `POST /v1/jobs/:id/photos/upload-url` — generate presigned upload URL for Supabase Storage
- [ ] `POST /v1/jobs/:id/photos/confirm` — confirm upload, create photo record, resize to 1920px max
- [ ] `GET /v1/jobs/:id/photos` — list photos for job (with signed URLs for access)
- [ ] `PATCH /v1/jobs/:id/photos/:pid` — update photo metadata (room_name, photo_type, caption, selected_for_ai)
- [ ] `DELETE /v1/jobs/:id/photos/:pid` — delete photo (remove from storage + DB)
- [ ] `POST /v1/jobs/:id/photos/bulk-select` — mark multiple photos as selected_for_ai
- [ ] Photo resize on upload: max 1920px longest edge (reduces AI token cost ~4x)
- [ ] Enforce limits: max 100 photos per job, max 10MB per upload, JPEG/PNG only
- [ ] Generate signed URLs with 15-minute expiry for photo access
- [ ] pytest: upload flow (get presigned URL → confirm → photo record created)
- [ ] pytest: list photos returns signed URLs
- [ ] pytest: update photo metadata (room, type, caption)
- [ ] pytest: delete photo removes from storage and DB
- [ ] pytest: reject upload over 10MB / wrong format
- [ ] pytest: reject upload when job has 100 photos

### Phase 3: Job List + Detail Frontend — ❌
- [ ] Job list page (`/jobs`): cards with status badge, address, date, photo count, line item count
- [ ] Status badges: "Needs Scope" (gray), "Scoped" (green), "Submitted" (blue)
- [ ] Search bar: filter jobs by address or customer name
- [ ] "+ New Job" button → create job modal/page
- [ ] Create job form: address (autocomplete via Google Places or simple input), loss type (water/fire/mold — 3 large tap targets, default water)
- [ ] Optional fields (expandable): customer name, phone, email, insurance carrier, claim number, adjuster info, loss category/class/cause, notes
- [ ] Job detail page (`/jobs/[id]`): all fields editable inline
- [ ] Job detail tabs: Overview | Photos | Line Items | Report
- [ ] Overview tab: all job fields, editable
- [ ] Delete job: confirmation dialog → delete
- [ ] Mobile-responsive: 48px touch targets, stacked layout on small screens
- [ ] Loading states, error states, empty states for each view

### Phase 4: Photo Upload + Management Frontend — ❌
- [ ] Photos tab on job detail: upload zone + photo grid
- [ ] Upload: "Take photos or upload from camera roll" — `<input type="file" accept="image/*" capture="environment">` for rear camera on mobile
- [ ] Upload progress bar per photo
- [ ] Upload failure: retry button with "Upload failed — check your connection"
- [ ] Photo grid: thumbnails organized by room (grouped) or flat grid
- [ ] Tap photo: view full-size in lightbox/modal
- [ ] Tap-and-hold (mobile) or right-click (desktop): delete photo
- [ ] Photo metadata: tap to edit room name, photo type (damage/equipment/protection/containment/moisture_reading/before/after), caption
- [ ] "Select for AI" toggle on each photo — or bulk select mode
- [ ] Photo guidance banner (first time): "For best AI results, take 5 photos per room: floor, each wall, and ceiling"
- [ ] Photo count indicator: "42 / 100 photos"

### Phase 5: PDF Export + Share Link — ❌
- [ ] Create `api/reports/service.py` — PDF generation logic
- [ ] Create `api/reports/router.py` — route handlers
- [ ] `POST /v1/jobs/:id/report` — generate PDF (WeasyPrint on Railway)
- [ ] `GET /v1/jobs/:id/report/download` — download generated PDF
- [ ] `POST /v1/jobs/:id/share` — generate share token (time-limited, read-only)
- [ ] `GET /v1/shared/:token` — public read-only job view (no auth required)
- [ ] PDF format: company-branded header (logo + name + phone), job address, date, homeowner name
- [ ] PDF body: table of line items (Xactimate Code | Description | Qty | Unit | S500/OSHA Justification)
- [ ] PDF photos: thumbnail grid at bottom with captions
- [ ] PDF footer: "Generated by Crewmatic" + page numbers
- [ ] PDF library: WeasyPrint (HTML-to-PDF). Railway Dockerfile needs cairo + pango system deps.
- [ ] Report tab on job detail: PDF preview (iframe or image), download button, share button
- [ ] Share flow: generate link → copy to clipboard → "Link copied!"
- [ ] PDF error state: "Report generation failed — try again" with retry button
- [ ] pytest: PDF generation produces valid PDF file
- [ ] pytest: share token generates and resolves to correct job
- [ ] pytest: expired share token returns 403

## Technical Approach

**Job creation pattern:**
- 2 required fields: address + loss type. Everything else nullable/optional.
- Auto-generate `job_number` on creation: `JOB-20260324-001`
- Status starts as `needs_scope`, transitions to `scoped` when AI scope runs, `submitted` when user marks as submitted.

**Photo upload pattern (presigned URLs):**
```
1. Frontend calls POST /v1/jobs/:id/photos/upload-url
2. Backend generates presigned upload URL from Supabase Storage
3. Frontend uploads directly to Supabase Storage using presigned URL
4. Frontend calls POST /v1/jobs/:id/photos/confirm with storage path
5. Backend creates photo record, triggers resize (1920px max)
6. Backend returns photo record with signed access URL
```

**PDF generation:**
- WeasyPrint on Railway (HTML template → CSS → PDF)
- Fetch line items + photos + company info from DB
- Generate HTML from template, render to PDF
- Store PDF in Supabase Storage, return signed download URL
- Alternative: `reportlab` if WeasyPrint causes Railway build issues

**Share link:**
- Generate random token, store in DB with expiry (7 days default)
- Public route `/v1/shared/:token` returns job data without auth
- Frontend renders a read-only job view at `/shared/:token`

**Key Files:**
- `backend/api/jobs/router.py`, `service.py`, `schemas.py` — job CRUD
- `backend/api/photos/router.py`, `service.py`, `schemas.py` — photo management
- `backend/api/reports/service.py`, `router.py` — PDF generation
- `backend/api/storage/signed_urls.py` — presigned URL generation
- `web/src/app/(protected)/jobs/page.tsx` — job list
- `web/src/app/(protected)/jobs/[id]/page.tsx` — job detail
- `web/src/app/(protected)/jobs/[id]/photos/` — photo upload + grid
- `web/src/app/(protected)/jobs/[id]/report/` — PDF preview + download
- `web/src/app/(protected)/jobs/new/page.tsx` — create job form
- `web/src/app/shared/[token]/page.tsx` — public shared view

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1, Job CRUD backend
# Prerequisite: Spec 00 (bootstrap) must be complete
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **Job creation:** 2 required fields only (address + loss type). Brett: "can't start without claim number" but that's for insurance submission, not initial creation. Let them add it later.
- **Photo limits:** 100 per job, 10MB each, JPEG/PNG only (Brett takes ~60 per job). HEIC deferred to V2.
- **Photo resize:** 1920px max on upload. Reduces AI token cost ~4x when Spec 02 processes them.
- **PDF library:** WeasyPrint preferred (HTML-to-PDF with CSS styling). Needs cairo + pango on Railway.
- **Storage:** Private bucket. All photo access via signed URLs (15-min expiry). Client property photos are sensitive (insurance claims, identifiable addresses).
- **Share links:** Time-limited (7 days), read-only. No auth required for viewing.
- **Status flow V1:** needs_scope → scoped → submitted. Full V2 lifecycle: new → contracted → in_progress → monitoring → completed → submitted → paid.
- **No photo auto-classification in V1.** User manually tags photo_type. V2: AI classifies damage vs equipment vs documentation shots.
