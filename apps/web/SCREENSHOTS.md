# Homepage app screenshots

Replace `apps/web/public/images/editor-light.png` and `editor-dark.png` with your screenshots. Their paths and dimensions live in `src/lib/showcase.ts` - update both when replacing the files, since the frame ratio follows them. (Paths rather than static imports, so the typecheck passes on a fresh checkout before Next.js generates its image types.) If you use different filenames or formats, update those paths. Update the alt text to describe the screenshots.

The showcase follows the visitor's appearance preference. To use one image in both themes, remove the unused import and set that theme's value to `null`. With both values set to `null`, the homepage uses the illustrative editor preview. The frame uses the taller image's aspect ratio for both themes, keeping the layout stable when switching appearance. Images retain their aspect ratio without cropping or stretching; matching dimensions give the most consistent result.

The hero's network counters read `/v1/stats` every minute. Impressions and clicks are lifetime counts of paid, verified receipts, excluding zero-cost test receipts. Active campaigns counts campaigns with active status. No sample totals are displayed if the API is unavailable.
