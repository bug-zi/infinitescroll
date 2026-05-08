# Infinite Scroll Canvas

AI scroll generation app backed by Supabase, OpenAI-compatible image APIs, and Vercel serverless functions.

## Local Development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Verify

```bash
npm test
npm run build
```

## Required Vercel Environment Variables

Set these in Vercel Project Settings -> Environment Variables for Production:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `CRON_SECRET`

Optional:

- `OPENAI_MODEL`
- `OPENAI_RESPONSE_MODEL`
- `OPENAI_IMAGE_MODEL`
- `OPENAI_IMAGE_API_MODEL`
- `OPENAI_API_KEYS`
- `OPENAI_FALLBACK_API_KEY`
- `DEEPSEEK_API_KEY`
- `MAX_CONCURRENT_JOBS`
- `GENERATION_TIMEOUT_MS`

If `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are missing, the deployed frontend cannot connect to Supabase and will display mock/template data.

If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are missing, server APIs such as `/api/bootstrap/data` and `/api/cron/generate` will fail.

## External Scheduler

Vercel Hobby accounts only allow daily Vercel Cron Jobs, so this project does not include `vercel.json` cron configuration. Use an external scheduler such as cron-job.org.

cron-job.org settings:

- URL: `https://YOUR_DOMAIN/api/cron/generate`
- Method: `POST`
- Schedule: every 5 minutes
- Header name: `Authorization`
- Header value: `Bearer YOUR_CRON_SECRET`

The `YOUR_CRON_SECRET` value must match the Vercel `CRON_SECRET` environment variable exactly.

## Production Smoke Test

After deployment:

```bash
curl https://YOUR_DOMAIN/api/system/status
curl https://YOUR_DOMAIN/api/bootstrap/data
curl -X POST https://YOUR_DOMAIN/api/cron/generate \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Expected:

- `/api/system/status` returns JSON with `serviceRunning: true`.
- `/api/bootstrap/data` returns Supabase rows, not 404/500.
- `/api/cron/generate` returns `{ "ok": true, "results": [...] }`.
