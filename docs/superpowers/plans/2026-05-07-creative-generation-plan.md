# Creative Generation Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the visible generation plan and the actual image-generation prompt use one shared creative plan.

**Architecture:** Add a shared TypeScript `creativePlan` module for frontend and Vercel API code. Mirror the same deterministic logic in the local `.mjs` dev API, persist plans on `generation_jobs.creative_plan`, and render the plan in `GenerationPlan`.

**Tech Stack:** React, TypeScript, Vitest, Supabase JSONB, Vercel API, local Node dev API.

---

### Task 1: Shared Creative Plan Model

**Files:**
- Create: `src/lib/creativePlan.ts`
- Modify: `src/types.ts`
- Test: `src/lib/creativePlan.test.ts`

- [x] Write failing tests for deterministic plan generation and prompt serialization.
- [ ] Add `CreativePlan` type and functions `createCreativePlan`, `normalizeCreativePlan`, and `buildCreativePlanPromptSection`.
- [ ] Run `npm test -- src/lib/creativePlan.test.ts`.

### Task 2: Frontend Plan Items

**Files:**
- Modify: `src/lib/time.ts`
- Modify: `src/lib/supabaseMappers.ts`
- Modify: `src/data/mockData.ts`
- Test: `src/lib/countdown.test.ts`, `src/lib/supabaseMappers.test.ts`

- [x] Write failing tests proving persisted job plans are used and missing plans get fallbacks.
- [ ] Map `generation_jobs.creative_plan` to `GenerationJob.creativePlan`.
- [ ] Add `creativePlan` to each returned `GenerationPlanItem`.
- [ ] Run `npm test -- src/lib/countdown.test.ts src/lib/supabaseMappers.test.ts`.

### Task 3: Backend Prompt Integration

**Files:**
- Modify: `api/cron/generate.ts`
- Modify: `api/scrolls/create.ts`
- Modify: `scripts/dev-api.mjs`
- Modify: `supabase/schema.sql`

- [ ] Add `creative_plan jsonb` to `generation_jobs`.
- [ ] Store a creative plan when creating queued jobs.
- [ ] Normalize and persist the claimed job plan before generation.
- [ ] Append the serialized creative plan to `buildImagePrompt`.

### Task 4: UI Rendering

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] Render each future plan as a readable card with schedule, anchor, new scene, composition, and forbidden drift.
- [ ] Keep the latest image tile compact and avoid layout overflow.

### Task 5: Verification

**Commands:**
- `npm test`
- `npm run build`

- [ ] Fix any failures.
- [ ] Review `git diff`.
