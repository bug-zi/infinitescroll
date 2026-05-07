# Finish MVP Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining MVP features: failed job retry, scroll editing, stitch quality scoring, and deploy environment checks.

**Architecture:** Keep the existing Vite frontend plus local Node API shape. Add narrow API endpoints to `scripts/dev-api.mjs`, small pure utilities under `src/lib` for testable logic, and frontend controls in the existing console/workspace surfaces.

**Tech Stack:** React, TypeScript, Vite, Supabase JS, Node HTTP API, Sharp, Vitest.

---

### Task 1: Failed Job Retry

**Files:**
- Modify: `scripts/dev-api.mjs`
- Modify: `src/lib/store.ts`
- Modify: `src/App.tsx`

- [ ] Add `POST /api/jobs/retry` accepting `{ jobId }`.
- [ ] Validate UUID, load failed job, delete/mark failed job cancelled, set scroll to generating, then call manual generation for that scroll.
- [ ] Add store method `retryJob(jobId)`.
- [ ] Add retry button beside failed jobs in Console.

### Task 2: Scroll Editing

**Files:**
- Modify: `scripts/dev-api.mjs`
- Modify: `src/lib/store.ts`
- Modify: `src/App.tsx`

- [ ] Add `POST /api/scrolls/update` accepting `{ scrollId, title, originalTheme, optimizedPrompt }`.
- [ ] Update only provided string fields and `updated_at`.
- [ ] Add a compact modal/form from the scroll header edit button.
- [ ] Persist edits and refresh Supabase state.

### Task 3: Stitch Quality Score

**Files:**
- Create: `src/lib/stitchQuality.ts`
- Create: `src/lib/stitchQuality.test.ts`
- Modify: `scripts/dev-api.mjs`
- Modify: `src/types.ts`
- Modify: `src/lib/store.ts`
- Modify: `src/App.tsx`

- [ ] Add pure score helper for average RGB edge difference mapped to 0-100.
- [ ] Use Sharp in API after generation to compare previous right overlap and new left overlap.
- [ ] Save score in `stitch_quality_score` when the column exists; fall back to `has_stitch_warning`.
- [ ] Show score in Inspector and console risk list.

### Task 4: Deploy Environment Checks

**Files:**
- Create: `scripts/check-deploy-env.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/feature-status.md`

- [ ] Add script checking required env vars without printing secrets.
- [ ] Add `npm run check:deploy-env`.
- [ ] Document Vercel env vars and post-deploy cron verification steps.
- [ ] Update feature status.

### Verification

- [ ] `node --check scripts/dev-api.mjs`
- [ ] `node --check scripts/check-deploy-env.mjs`
- [ ] `npm test`
- [ ] `npm run build`
