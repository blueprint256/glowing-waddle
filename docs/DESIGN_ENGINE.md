# Design engine (designed posters)

Posters are laid out in code, not painted by an image model. Every poster is a **design document**
(JSON: the design, its settings, the words, the photos, the logos) rendered by a sealed headless
Chromium into a PNG, JPEG or print PDF. Because the words, logos and layout are real objects, they
can be checked, edited and printed sharply; image models are used only for an optional background
picture, never for words or logos.

## How a poster is made

1. **Read**: the post's brief, the chosen photos (focal point, size), the brand kit, partners.
2. **Direct**: Claude Sonnet (art director) picks up to four designs from the library, writes the
   words to each design's limits, sets the design's settings, and marks where people and faces are
   in each photo. Without an AI key a fixed plan is used.
3. **Background** (only if an option needs one): a picture from the image model, sized to the area.
4. **Render** each option, then **check** it (below). Options that fail are retried with roomier
   settings, then with shorter words, then with the other designs that fit.
5. **Review**: Claude looks at the clean options and ranks them; bad crops are rejected.
6. **Save** as the post's drafts (kind `design`), best first. Choosing one keeps its document, so it
   can be edited and printed later.

Code: `backend/src/design/*` (engine), `backend/assets/design-runtime/*` (the page runtime and base
CSS), `backend/src/services/design*.ts` (pipeline, brand kit, edits, worker),
`backend/src/routes/design.routes.ts` (API), `frontend/src/components/posts/Poster*.tsx` and
`frontend/src/pages/Settings/PostersSection.tsx` (screens).

## The designs

Built in (`backend/src/design/library/`): **Hero photo**, **Split panel**, **Art led**,
**Spotlight** (a featured person, cut out when possible), **Observance** (days like World Polio
Day), **Bold event** (game nights, dinners). Each declares its fields and their lengths, how many
photos and partners it takes, its shapes (square, portrait, story, landscape, A4, A3) and its
settings. Designs are HTML and CSS against the runtime's `data-*` attributes; the runtime fits the
type, places photos on their subject, sizes partner logos by how big they look, and measures
everything for the checks.

## The checks (every option, before anyone sees it)

Words: overflow, minimum sizes, contrast (WCAG, against what's actually behind them), overlap,
covered by something, running across a photo's edge, over a person or a face. Logos: minimum size,
clear space, cut off, partners outweighing the club's logo, missing partners. Photos: enlarged too
far (on screen past about 2.4×; on paper under 85 dpi). Errors stop an option; warnings lower its
score.

## Brand kit (Settings → Posters)

One per account: brand pack (Rotary, Rotaract), the logo and its versions, campaign logos (End
Polio Now), partner logos, colours, fonts, the contact line, rules. A pack fixes the colours to its
palette and the fonts, and brings its logo rules.

**Logo versions.** At upload each logo is trimmed (a white box is removed), and the luminance of its
outline is measured. On every poster each logo gets the version that reaches 4.5:1 against what's
behind it (3:1 at the least): uploaded versions first; for a one-colour logo the app also makes its
white and dark versions (the same artwork brand centres supply) and uses them only where needed.
If nothing reads, the logo sits on a light or dark plate. Logos are never otherwise recoloured.

## Editing and printing

Typing on the poster (no AI), one-tap changes (headline size, swap colours, another shape or design,
no AI), or a described change (Claude Haiku turns it into the same operations; changes that break
a hard brand rule are explained instead). Every change is a new draft. A4 and A3 PDFs on request.

## Allowance

`designs` is its own monthly allowance (default 12, `aiDesignsPerMonth` in AppConfig, per user in
Admin). A set of options counts once; edits and prints are free. A poster's own AI steps don't count
against the images allowance.

## Deploying

1. `cd backend && npm install` — adds `playwright-core` (the lockfile on the branch was not
   regenerated; run `npm install` once and commit the lockfile).
2. A Chromium for the renderer, either `npx playwright install chromium` (as the app's user), or a
   system Chrome/Chromium with `DESIGN_CHROME_PATH=/path/to/chrome`. On Linux it needs the usual
   libraries (`npx playwright install-deps chromium` installs them).
3. Memory: allow about 8 GB for the server (Chromium plus image work). Posters render one at a time
   per instance by default (`DESIGN_WORKER_CONCURRENCY`).
4. Optional, cut-out people (Spotlight and Bold event stand the person in front of the words):
   `npm install onnxruntime-node` and an open-licence segmentation model file, e.g. BiRefNet-lite
   (MIT) or u2net_human_seg (Apache-2.0), with `CUTOUT_MODEL=/path/model.onnx` and
   `CUTOUT_MODEL_KIND=birefnet|u2net`. Without it those designs use their no-cut-out layouts.
5. AI keys: Anthropic (art director, reviewer, edits) and OpenAI (background pictures) in
   Settings → AI. Without an Anthropic key posters still work with a fixed plan.

Settings (`backend/.env`):

| Setting | What it does |
| --- | --- |
| `DESIGN_CHROME_PATH` | Chrome/Chromium to render with (else Playwright's own) |
| `DESIGN_WORKER=off` | Don't run the poster worker on this instance |
| `DESIGN_WORKER_CONCURRENCY` | Posters rendered at once per instance (default 1) |
| `CUTOUT_MODEL`, `CUTOUT_MODEL_KIND`, `CUTOUT_MODEL_SIZE` | Cut-out model file, its kind and input size |
| `DESIGN_DEV=1` | Reload the runtime files on every render (while developing designs) |

## Checking it

```
cd backend
DESIGN_CHROME_PATH=/usr/bin/google-chrome npx tsx src/scripts/designSelfTest.ts
```

Renders every design in every shape with ordinary, short and very long words and 0, 3 and 6
partners into `/tmp/design-out`, and checks the plan, edit, check and logo-version logic. Long words
are a stress test and are expected to fail. `DESIGN_PHOTOS=<folder>` uses your photos;
`DESIGN_ONLY=bold-event` and `DESIGN_FORMATS=portrait` narrow it.

`src/scripts/designReview.ts` renders one scenario (a JSON file: designs, shapes, words, photo,
real logo and partner files) and a contact sheet, for people to look at.

## Adding a design

Copy a built-in design, change its HTML and CSS, declare its fields, photos, partners, shapes and
settings (`roomy` on the settings that give the words more room), add it to
`library/index.ts`, and run the self-test until every shape passes with ordinary words and six
partners. The art director reads each design's description to decide when to use it, so write it
as a designer would brief one.
