# Scroll Panorama Viewer Design

## Goal

Add a light, scroll-painting viewing mode that opens from the scroll preview and lets users observe the whole scroll as one continuous artwork.

## Requirements

- Clicking a preview segment opens the viewer.
- The viewer defaults to the clicked segment position.
- The artwork should read as one continuous scroll, not as separate cards.
- The viewer uses a beige/light paper-like visual treatment, matching the existing app style.
- Left and right arrow keys move the scroll continuously while held. Movement distance is controlled by hold duration.
- Mouse wheel zooms around the cursor.
- Dragging pans the zoomed scroll.
- Double-click toggles a focused zoom around the clicked point.
- `0` resets the view to the initially clicked segment.
- `Escape` closes the viewer.

## Architecture

Create a focused `ScrollPanoramaViewer` React component in `src/App.tsx` for now, matching the current single-file app structure. Extract pure math helpers for view initialization and continuous key movement into `src/lib/panoramaViewer.ts` so the behavior can be tested without a browser.

The viewer renders all images in a single horizontal flex track. Each segment displays only its `visibleCrop` area and touches adjacent segments without visible labels or borders. The component tracks scale and pan as a transform applied to the full continuous track.

## Interaction Details

- Initial pan centers the clicked segment in the viewport based on cumulative visible segment widths.
- Arrow-key hold uses `requestAnimationFrame`; speed ramps gently with hold time and caps at a restrained maximum.
- Wheel zoom adjusts pan so the point under the cursor remains stable.
- Dragging updates pan directly.
- Double-click zooms to a medium inspection scale, or resets when already zoomed.

## Testing

- Unit-test helper functions for segment layout, initial centering, held-key movement speed, clamping, and cursor-centered zoom math.
- Run `npm run test`.
- Run `npm run build`.
- Verify in browser that click-to-open, centering, continuous arrow movement, wheel zoom, drag, double-click, reset, and Esc close all work.

## Notes

This folder is not currently a git repository, so the design cannot be committed here.
