# Scroll Panorama Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a light full-screen continuous scroll viewer opened from the preview area and centered on the clicked segment.

**Architecture:** Pure interaction math lives in `src/lib/panoramaViewer.ts` with Vitest coverage. The React viewer lives in `src/App.tsx` to match the existing compact app structure, and styles live in `src/styles.css`.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, plain CSS, lucide-react.

---

## File Structure

- Create `src/lib/panoramaViewer.ts`: layout and transform math for continuous scroll viewing.
- Create `src/lib/panoramaViewer.test.ts`: tests for centering, key movement, clamping, and cursor-centered zoom.
- Modify `src/App.tsx`: replace single-image viewer with continuous scroll viewer and wire preview clicks.
- Modify `src/styles.css`: light paper-like full-screen viewer styles.

## Tasks

### Task 1: Test And Implement Panorama Math

**Files:**
- Create: `src/lib/panoramaViewer.ts`
- Create: `src/lib/panoramaViewer.test.ts`

- [ ] Write failing tests for layout, centering, held-key pan distance, and zoom toward cursor.
- [ ] Run `npm run test -- src/lib/panoramaViewer.test.ts` and confirm failures are due to missing implementation.
- [ ] Implement the minimal exported helpers.
- [ ] Run `npm run test -- src/lib/panoramaViewer.test.ts` and confirm pass.

### Task 2: Add Continuous Viewer Component

**Files:**
- Modify: `src/App.tsx`

- [ ] Replace `ImageViewer` with `ScrollPanoramaViewer`.
- [ ] Pass all scroll images plus the clicked image id.
- [ ] Render a single continuous transformed track, using each image's `visibleCrop`.
- [ ] Add keyboard, wheel, double-click, drag, reset, and close behavior.

### Task 3: Wire Preview Click Behavior

**Files:**
- Modify: `src/App.tsx`

- [ ] Change preview segment click to select the segment and open the viewer.
- [ ] Keep inspector open-viewer action working with the selected image.
- [ ] Ensure empty image lists do not open the viewer.

### Task 4: Style Light Paper Viewer

**Files:**
- Modify: `src/styles.css`

- [ ] Replace dark viewer styles with beige full-screen stage styles.
- [ ] Hide segment boundaries in the viewer while preserving a continuous horizontal track.
- [ ] Add toolbar, reset button, close button, zoom indicator, and instruction bar styles.
- [ ] Check mobile/narrow viewport behavior.

### Task 5: Verify

**Files:**
- No code edits expected.

- [ ] Run `npm run test`.
- [ ] Run `npm run build`.
- [ ] Start the dev server and verify the full interaction in browser.

## Self-Review

- Spec coverage: all requirements map to the five tasks above.
- Placeholder scan: no TBD or incomplete task instructions remain.
- Type consistency: helper and component names are consistent across tasks.
