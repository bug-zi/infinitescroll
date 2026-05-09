# Create Blank Scroll Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the slow template-based create action with a fast explicit create dialog that creates a blank scroll from user theme and prompt.

**Architecture:** Keep the existing local API and React store. Split prompt optimization into a dedicated API endpoint, and make scroll creation insert only a `scrolls` row with no initial queued job and auto-generation disabled.

**Tech Stack:** React, TypeScript, Vite, Node HTTP API, Supabase, Vitest.

---

### Task 1: Backend API

- [ ] Add `POST /api/prompts/optimize` that accepts `{ theme }` and returns `{ optimizedPrompt }`.
- [ ] Change `POST /api/scrolls/create` to accept `{ theme, optimizedPrompt }`.
- [ ] Create scroll with `image_count = 0`, `auto_generation_enabled = false`, `status = "paused"`, no initial `generation_jobs`.
- [ ] Log blank scroll creation only.

### Task 2: Frontend Store

- [ ] Change `createScroll` to accept `{ theme, optimizedPrompt }`.
- [ ] Add `optimizePrompt(theme)` calling `/api/prompts/optimize`.
- [ ] Remove default "清明上河图风格" fallback from create path.

### Task 3: UI

- [ ] Replace sidebar inline create submit with a create dialog.
- [ ] Dialog contains theme input, prompt textarea, "AI 优化提示词", "创建空白画卷".
- [ ] Creating empty theme is disabled.
- [ ] New blank scroll header should guide the user to click "立即生成" or enable auto-generation.

### Task 4: Verification

- [ ] Add tests for blank create request payload and no template fallback.
- [ ] Run `node --check scripts/dev-api.mjs`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
