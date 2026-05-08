# Creative Generation Plan Design

## Goal

Make the visible “生成计划” panel and the real image-generation prompt use the same structured creative plan, so the user can see what the next frame will do and the AI is asked to follow that exact plan.

## Requirements

- Each upcoming generation item has a creative plan with a title, continuity anchor, new scene, composition rule, forbidden drift, and prompt fragment.
- The frontend shows the creative plan instead of only countdown cards.
- The backend includes the same creative plan in the prompt sent to the image model.
- Persisted job plans take priority. If an old job has no plan, the app derives a deterministic fallback from the scroll theme, optimized prompt, previous prompt, target index, and whether a reference image exists.
- The implementation remains compatible with existing database rows.

## Data Shape

`creativePlan`:

- `title`: short human-readable segment title.
- `continuityAnchor`: what must connect from the previous image.
- `newScene`: what appears in the new right-side area.
- `composition`: how the segment should be arranged.
- `forbidden`: what the model must not change.
- `promptFragment`: the exact planning text appended to the generation prompt.

## Flow

1. When a scroll is created, the first queued job receives a plan for segment 1.
2. When the cron/dev API generates a frame, it claims or creates the job for the target index.
3. The job’s persisted plan is normalized. If missing, a fallback plan is generated and saved back to the job.
4. The prompt builder appends a serialized creative-plan section to the image prompt.
5. The frontend maps `generation_jobs.creative_plan` into `GenerationJob.creativePlan` and displays it in the “生成计划” panel.

## Testing

- Unit-test plan generation and prompt serialization.
- Unit-test countdown plan items so fallback and persisted plans are both used.
- Unit-test Supabase mapping of `creative_plan`.
- Run the full test suite and production build.
