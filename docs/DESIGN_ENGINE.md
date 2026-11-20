# Design engine (designed posters)

## One picture system

A post's picture comes from one place, **Create with AI** on the post, with two choices:

- **Poster** (the default): this engine. The post's brief, the brand's real logo files, colours
  and fonts, chosen partners and photos, laid out and checked. Every line stays editable (type on
  it, or describe a change; edits are free), and it comes in other sizes and as a print PDF.
- **Photo**: a picture with **no words** from the image model, for posts where the caption says
  it all. Its words come from the `generate-photo` command when an admin sets one, else the
  built-in prompt; every photo prompt ends with a no-words rule. The old `generate-poster` command
  is no longer used.

**No photo?** A poster can ask the image AI for one first ("No photo? Let AI create one" in the
panel; `ai_photo` in the connector). It's a realistic, word-free photo made from the brief, added to
the post's pictures for reuse, and part of the poster (its usage is "Design · photo", not counted
again). The art director is also asked for options that look clearly different, and options that
would look the same at a glance are dropped.

Changing a picture follows what it is: a designed poster is changed by this engine (the post's
`image/change` route hands it over), a photo by the image model. Both share one monthly
allowance of **AI pictures** (a poster, however many options and edits, counts once).

**Plan with AI** writes each planned post's picture into its brief ("Poster facts: headline idea,
date, time, place, figures", only facts given) so a poster can be made straight away and people
can read and correct the facts first. **Blue and the connector** use the same engine:
`generate_task_poster` (waits up to about 2 minutes, then `poster_status`), `create_task_photo`,
`change_task_picture` and `poster_files` (other sizes, A4/A3 PDF). `ai_setup_status` and Settings ›
AI show the engine's health (`GET /api/design/admin/status`): the Claude key, the renderer,
cut-outs, the model used for each step and the design library.

## How it works

Posters are laid out in code, not painted by an image model. Every poster is a **design document**
(JSON: the design, its settings, the words, the photos, the logos) rendered by a sealed headless
Chromium into a PNG, JPEG or print PDF. Because the words, logos and layout are real objects, they
can be checked, edited and printed sharply; image models are used only for an optional background
picture, never for words or logos.

## How a poster is made

1. **Read**: the post's brief, the chosen photos (focal point, size), the brand (kit and voice:
   what it does, tone, audience, always-and-never rules, guidelines), partners.
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
`backend/src/routes/design.routes.ts` (API), `frontend/src/components/posts/CreateWithAI.tsx`,
`PosterEditor.tsx` and `frontend/src/pages/Settings/BrandSection.tsx` (screens).

## The designs

Built in (`backend/src/design/library/`): **Hero photo**, **Split panel**, **Art led**,
**Spotlight** (a featured person, cut out when possible), **Observance** (international days),
**Bold event** (game nights, dinners, launches; also without a photo), **Recap** (thank-you and report-back posts: a wide
group photo at its own proportions and up to three impact figures). Admins add more from reference
posters (below). Each declares its fields and their lengths, how many
photos and partners it takes, its shapes (square, portrait, story, landscape, A4, A3) and its
settings. Designs are HTML and CSS against the runtime's `data-*` attributes; the runtime fits the
type, places photos on their subject, sizes partner logos by how big they look, and measures
everything for the checks.

**Impact figures** (`stats`) appear only when the request states them: the art director is told
never to estimate or invent one, and anything without a digit is dropped.

## The checks (every option, before anyone sees it)

Words: overflow, minimum sizes, contrast (WCAG, against what's actually behind them), overlap,
covered by something, running across a photo's edge, over a person or a face. Logos: minimum size,
clear space, cut off, partners outweighing the brand's own logo, missing partners. Photos: enlarged too
far (on screen past about 2.4×; on paper under 85 dpi). Errors stop an option; warnings lower its
score.

## Brand (Settings → Brand)

One page per account, for every kind of organisation (NGOs, businesses, schools, clubs): who you
are and how you sound (the company information every AI feature reads), then how you look: the
logo and its versions, other logos (a programme, campaign or event), partner logos, colours,
fonts (bundled or uploaded), the contact line, guidelines and poster rules. The main logo is kept in
step with the company information's logo address, so every feature shows the same one; colours
written in the guidelines ("#4B2E1F") seed the kit.

**Clubs.** One tick box, "We're a Rotary or Rotaract club" (off by default), applies that brand
pack: colours limited to its palette, its fonts, and its logo rules. Nothing else in the app
changes, and nobody else sees anything of it.

**Uploaded fonts.** TTF, OTF, WOFF or WOFF2 up to 6 MB (checked by their bytes), up to 10 families
of up to 12 files; weight and italic are read from the file name ("Kawa-BoldItalic.ttf" → 700
italic, a variable font → all weights). They're stored in `brand-fonts/` (never swept), given a
family name of their own (`Brand custom-…`) and served to the renderer like any other file of the
poster. Screens fetch them signed-in, so they never need to be public. Removing a font puts
headlines and text back on the defaults; posters already made keep their pictures.

**Logo versions.** At upload each logo is trimmed (a white box is removed), and the luminance of its
outline is measured. On every poster each logo gets the version that reaches 4.5:1 against what's
behind it (3:1 at the least): uploaded versions first; for a one-colour logo the app also makes its
white and dark versions (the same artwork brand centres supply) and uses them only where needed.
If nothing reads, the logo sits on a light or dark plate. Logos are never otherwise recoloured.

## Design library (Admin › Poster designs)

Admins import a design from a picture of a poster they like. Claude Opus reads it and writes an
**original** design for the runtime: the structure (grid, proportions, hierarchy, how photo and
words meet), never the reference's artwork, logos, photos or words; colours, fonts and logos always
come from each club's kit. The admin confirms the picture is only a layout reference; the picture
itself is never stored.

Every design (built-in or imported) passes the **stress test** before use: each of its shapes with
ordinary words and three partners, ordinary words and six partners, short words with none
(placeholder logos, a stand-in photo; the roomier settings get one try, as in the pipeline). Very
long words are rendered and shown but don't count. When an import fails cases, the renders and the
problems go back to the importer for up to two repairs. The admin sees every render with its
problems, can ask for a change in words, or edit the code (settings JSON, HTML, CSS); saving re-runs
the test. **Approve** needs every case to pass; only approved designs are offered to the art
director. **Retire** stops new posters using it (existing ones can still be edited).

Code: `design/stressTest.ts`, `design/importer.ts` (the authoring guide, with a built-in design as
its worked example), `services/designImport.ts`, `frontend/src/pages/Admin/PosterDesignsPage.tsx`.

## Editing and printing

Typing on the poster (no AI), one-tap changes (headline size, swap colours, another shape or design,
no AI), or a described change (Claude Haiku turns it into the same operations; changes that break
a hard brand rule are explained instead). Every change is a new draft. A4 and A3 PDFs on request.

## Cleaning up

A poster's own picture is deleted when its draft goes. Its side files (AI background, cut-out
person, print PDFs: the `design-backgrounds/`, `design-cutouts/` and `post-prints/` folders) are
swept once a day: anything older than a week that no poster refers to is deleted. Cut-outs are also
kept for 30 days after they're made, so the same photo isn't cut out twice. `DESIGN_SWEEP=off`
skips it on an instance.

## Allowance

Posters and photos share one monthly allowance of **AI pictures** (`aiImagesPerMonth` in AppConfig,
default 30; per user in Admin › Users). A poster counts once however many options it has; poster
edits, other sizes and prints are free, and a poster's own AI steps (its background, its review)
aren't counted again. An AI photo or a change to a photo counts one. The older `designs` allowance
(`aiDesignsPerMonth`) is no longer used.

## Deploying

0. Add an **Anthropic (Claude) key** in Settings › AI. Without it posters still render, but from a
   fixed plan: no art director, no review and no described edits. Settings › AI › Poster engine
   says whether everything is ready.
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
| `DESIGN_SWEEP=off` | Don't run the daily clean-up of unused poster files on this instance |
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

Usually: Admin › Poster designs › Import from a reference. By hand: copy a built-in design, change its HTML and CSS, declare its fields, photos, partners, shapes and
settings (`roomy` on the settings that give the words more room), add it to
`library/index.ts`, and run the self-test until every shape passes with ordinary words and six
partners. The art director reads each design's description to decide when to use it, so write it
as a designer would brief one.
