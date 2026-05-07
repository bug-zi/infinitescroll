# Scroll Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scroll-level management so users can create, select, and delete scrolls with confirmation.

**Architecture:** Keep creation and selection in the existing sidebar. Add a delete endpoint for server-side cascade cleanup, a local store action for UI state, and a small pure helper for post-delete selection behavior. Use the existing `confirmAction` utility for the destructive confirmation.

**Tech Stack:** React, TypeScript, Vite, Supabase, Vitest.

---

### Task 1: Pure Helpers And Tests

**Files:**
- Create: `src/lib/scrollManagement.ts`
- Test: `src/lib/scrollManagement.test.ts`
- Create: `api/_lib/scrollDeletion.ts`
- Test: `api/_lib/scrollDeletion.test.ts`

- [ ] Add tests for choosing the next selected scroll after deletion.
- [ ] Add tests for extracting Supabase Storage object paths from public image URLs.
- [ ] Implement the helpers.
- [ ] Run targeted tests.

### Task 2: Server Delete Endpoint

**Files:**
- Create: `api/scrolls/delete.ts`
- Modify: `scripts/dev-api.mjs`

- [ ] Add `/api/scrolls/delete` with `POST { scrollId }`.
- [ ] Delete jobs, logs, images, storage objects, and then the scroll row.
- [ ] Mirror the route in the local dev API.

### Task 3: Store And Sidebar UI

**Files:**
- Modify: `src/lib/store.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] Add `deleteScroll(scrollId)` to the store.
- [ ] Refactor sidebar scroll rows so selection and delete are separate controls.
- [ ] Add confirmation text before deletion.
- [ ] Update empty-state selection behavior after deleting the current scroll.

### Task 4: Verification

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Restart local API if it is running.
