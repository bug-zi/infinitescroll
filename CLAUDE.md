# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"无限画卷" (Infinite Scroll Canvas) — an AI-powered infinite horizontal scroll painting application. Users create themed scrolls, and the system auto-generates images that stitch together seamlessly using overlap/outpainting. The two-phase AI pipeline uses DeepSeek for prompt optimization and OpenAI (or compatible) image generation.

## Development Commands

```bash
npm run dev          # Start Vite dev server on :5173 (proxies /api to :5180)
npm run dev:api      # Start local API server on :5180 (reads .env.local)
npm run build        # TypeScript check + Vite production build
npm run test         # Run vitest tests
npm run preview      # Preview production build
```

Run `npm run dev` and `npm run dev:api` in parallel for full local development.

## Architecture

### Frontend (React + Vite)

Single-page app in `src/`. All state lives in `src/lib/store.ts` as a custom React hook (`useInfiniteScrollStore`). No external state library.

- **Data modes**: The store detects whether Supabase is configured via `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` env vars. If configured, it loads from Supabase; otherwise falls back to `src/data/mockData.ts`.
- **Stitching logic**: `src/lib/stitching.ts` handles overlap crop calculations. Images are generated wider than visible, with the left overlap region matching the previous image's right edge. Three presets: standard (12.5%), strong (20%), maximum (25%).
- **Styling**: Plain CSS in `src/styles.css`. No CSS framework or CSS-in-JS.
- **Icons**: lucide-react.

### Backend (Dual: Vercel Serverless + Local Dev API)

Two implementations of the same API logic:

1. **Vercel serverless functions** in `api/` — used in production. `api/cron/generate.ts` is triggered every 5 minutes by `vercel.json` cron config. `api/scrolls/create.ts` handles scroll creation.
2. **Local dev API** in `scripts/dev-api.mjs` — a plain Node HTTP server that replicates the Vercel function logic for local development. Reads `.env.local` for credentials.

Both share the same AI pipeline pattern:
- DeepSeek Chat optimizes user themes into scroll-continuity prompts
- OpenAI Responses API (or compatible via `OPENAI_BASE_URL`) generates images
- Generated images are stored in Supabase Storage bucket `scroll-images`

### Database (Supabase/Postgres)

Schema in `supabase/schema.sql`. Four tables: `scrolls`, `scroll_images`, `generation_jobs`, `generation_logs`. Uses Postgres enums for status fields and a unique partial index (`one_running_job_per_scroll`) to enforce at most one running job per scroll.

### Environment Variables

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — frontend Supabase client
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — backend admin client
- `DEEPSEEK_API_KEY` — prompt optimization (optional, falls back to template)
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_IMAGE_MODEL` — image generation (optional, falls back to placeholder SVG)

## Key Conventions

- Image dimensions: first image 1024x768 (4:3), subsequent images 1152x768 with overlap region cropped on the left
- All crop regions (`visibleCrop`, `overlapCrop`, `newContentCrop`) use absolute pixel coordinates
- Database columns use snake_case; TypeScript types use camelCase. Mappers in `src/lib/supabaseMappers.ts` bridge the gap
- UI language is Chinese (zh-CN); date formatting uses `Intl.DateTimeFormat` with `zh-CN` locale
