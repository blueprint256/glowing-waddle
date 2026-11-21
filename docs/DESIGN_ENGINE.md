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
again). Each option is designed in a different direction, so they look clearly different.

Changing a picture follows what it is: a designed poster is changed by this engine (the post's
`image/change` route hands it over), a photo by the image model. Both share one monthly
allowance of **AI pictures** (a poster, however many options and edits, counts once).

**Plan with AI** writes each planned post's picture into its brief ("Poster facts: headline idea,
date, time, place, figures", only facts given) so a poster can be made straight away and people
can read and correct the facts first. **Blue and the connector** use the same engine:
`generate_task_poster` (waits up to about 2 minutes, then `poster_status`), `create_task_photo`,
`change_task_picture` and `poster_files` (other sizes, A4/A3 PDF). `ai_setup_status` and Settings ›
AI show the engine's health (`GET /api/design/admin/status`): the Claude, OpenAI and fal.ai keys,
the renderer, cut-outs and the model used for each step.
## Scenes: how a poster is made

Every poster is a **scene**: a stack of layers the AI plans and code draws (`design/scene.ts`).
There is no fixed library of templates: each poster's layout comes from its own concept.

| Layer | What it is |
| --- | --- |
| backdrop | art the image model made (with its words, logos and photos removed), or a plain colour or gradient drawn in code |
| shape | colour blocks, bands, circles, pills, slanted panels and arches, drawn in code |
| photo | a real photo's own pixels in a frame (rectangle, rounded, circle, arch, slanted, soft blob or a traced organic shape), with the part of the photo shown, a fade, a brand-colour wash or duotone, and people breaking out of the frame (a cut-out of them on top) |
| text | the real words (eyebrow, headline, subhead, details, button, badge, contact), fitted to their boxes in the brand fonts; a phrase marked with *stars* takes a second brand colour |
| logo, partners | the real logo files (with their versions and clear space) and one strip of partner logos |

For each option, side by side (`services/designScene.ts`):

0. **Art direction.** There is no list of layouts. For each run a random draw is made from the
   studio's design vocabulary (`DESIGN_VOCAB`: composition, the photo's shape and place, colour,
   type, one graphic accent, mood — thousands of combinations), and a quick Claude call turns the
   draw into a written art direction for each option, judged against the subject and the photos
   (about a tenth of a cent for the whole run). Without a Claude key the draw itself is the
   direction. This is what keeps posters from looking alike while staying designed.
1. **Concept.** The poster image model (Settings › AI › Image models › Posters: GPT-Image-2.5 by
   default, or Qwen-Image on fal.ai) designs to that direction *with the post's photos*: it crops
   them, cuts them into shapes, fades them, lets people overlap a frame, the way a designer would.
   It is told never to add, remove or change people, and that the photograph is one element of a
   designed poster rather than the poster itself. Its pixels are never used, so it is not asked to
   reproduce the photograph faithfully: that would make it place the photo instead of designing.
2. **Reading.** Claude (Sonnet) reads the concept and the real photos into a scene: where every
   layer goes, each photo's frame and treatment and which part of the real photo it shows, the
   brand's colours, and the real words from the brief (dates checked against the weekday).
3. **Backdrop**, only when the scene keeps the concept's art: one image edit removes its words,
   logos and photos. Flat or gradient grounds are drawn in code instead (free, crisp, editable).
4. **Photos, in code.** Each real photo is matched against where the concept drew it (no AI call)
   and placed exactly; organic frames are traced from where the concept differs from its backdrop
   (Qwen-Image-Layered on fal.ai if that fails); people who break out of a frame are cut out with
   **SAM 3** (fal.ai; the subject in a few words, once per photo, cached), else BiRefNet.
5. **Draw, check, repair.** The scene is drawn in a sealed Chromium; every check runs; what fails
   is repaired the way a designer would (auto colour, then a panel; a smaller partner strip; a
   wider or taller box; boxes that give way to each other; words out of the logo's clear space; a
   bigger logo; a photo shown less zoomed), twice at most, then shorter words. What still fails is
   recorded in the AI usage log ("Design · scene checks": the render and the concept, to look at).
6. **Review.** With more than one clean option, Claude ranks them by looking at them.

The finished poster always shows the photos' own pixels: no image model redraws a face.

**Without AI keys** (or when every concept fails), a clean poster is made from the brief in code
(`fallbackScene`): the brief's facts become the words ("Call to action: …" becomes the button,
"Photo: …" notes stay off), stacked so nothing collides, in the brand's colours.

**Cost per option**: a concept (about 2 US cents), Claude's reading (about 2), a backdrop edit only
for art (about 2), cut-outs half a cent per photo once, and the art direction about a tenth of a
cent for the whole run. About 4–7 cents an option.

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
## Editing, other sizes and printing

Every change is a new draft next to the one changed (`services/designEdits.ts`, `design/edits.ts`):

- **Typing** on the poster: any line, the details, the badge. A line the poster doesn't have yet
  (a subhead, a button) gets its own layer.
- **One tap, no AI**: headline size, swap colours, another shape; and the photo: closer, show more,
  move, fade, frame shape, colour wash, people over the frame, another of the post's photos.
- **Described** ("fade the photo into the blue", "move the logo to the bottom"): Claude Haiku turns
  it into the same operations, on any layer. Changes that break a hard brand rule are explained
  instead. A new backdrop picture is the only change that calls the image model.

**Other shapes** (feed, story, landscape; A4/A3 PDFs): a close shape is fitted in code; a very
different one (a portrait poster as a landscape banner) is laid out again by Claude Haiku (about a
third of a cent), each photo keeping the part it showed. Without a Claude key the layout keeps its
percentages and the checks decide.

## Cleaning up

A poster's own picture is deleted when its draft goes. Its side files (concepts and backdrops,
cut-out people, print PDFs: the `design-backgrounds/`, `design-cutouts/` and `post-prints/` folders) are
swept once a day: anything older than a week that no poster refers to is deleted. Cut-outs are also
kept for 30 days after they're made, so the same photo isn't cut out twice. `DESIGN_SWEEP=off`
skips it on an instance.
## Allowance

Posters and photos share one monthly allowance of **AI pictures** (`aiImagesPerMonth` in AppConfig,
default 30; per user in Admin › Users). A poster counts once however many options it has; poster
edits, other sizes and prints are free, and a poster's own AI steps (its concepts, backdrops,
cut-outs, review) aren't counted again. An AI photo or a change to a photo counts one. The older `designs` allowance
(`aiDesignsPerMonth`) is no longer used.
## Deploying

1. Keys in **Settings › AI**: **Anthropic** (reads concepts into scenes, review, changes, new
   shapes) and **OpenAI** (concepts and AI photos with GPT-Image-2.5). **fal.ai** runs Qwen-Image
   and Qwen-Image-Edit-Plus (if chosen as the image model), SAM 3 and BiRefNet (people breaking out
   of frames) and Qwen-Image-Layered (organic frames), or `FAL_KEY` in `.env`. Settings › AI ›
   Poster engine says whether everything is ready.
2. `cd backend && npm install` (adds `playwright-core`).
3. A Chromium for the renderer: `npx playwright install chromium` (as the app's user), or a system
   Chrome with `DESIGN_CHROME_PATH=/path/to/chrome`. On Linux, `npx playwright install-deps chromium`.
4. Memory: about 8 GB for the server (Chromium plus image work). Posters render one at a time per
   instance by default (`DESIGN_WORKER_CONCURRENCY`).
5. Optional: a cut-out model on the server instead of fal.ai (`npm install onnxruntime-node`,
   `CUTOUT_MODEL=/path/model.onnx`, `CUTOUT_MODEL_KIND=birefnet|u2net`).

Settings (`backend/.env`):

| Setting | What it does |
| --- | --- |
| `FAL_KEY` | fal.ai key (if not saved in Settings › AI) |
| `DESIGN_CHROME_PATH` | Chrome/Chromium to render with (else Playwright's own) |
| `DESIGN_WORKER=off` | Don't run the poster worker on this instance |
| `DESIGN_WORKER_CONCURRENCY` | Posters rendered at once per instance (default 1) |
| `CUTOUT_MODEL`, `CUTOUT_MODEL_KIND`, `CUTOUT_MODEL_SIZE` | A cut-out model file on the server (else fal.ai) |
| `DESIGN_SWEEP=off` | Don't run the daily clean-up of unused poster files on this instance |
| `DESIGN_DEV=1` | Reload the runtime files on every render |

## Checking it

```
cd backend
DESIGN_CHROME_PATH=/usr/bin/google-chrome DESIGN_PHOTOS=<folder> npx tsx src/scripts/designSelfTest.ts
```

Draws sample scenes (full-bleed photo with a fade, a slanted split over painted art, people
breaking out of an arch, a circle frame) in every shape into `/tmp/design-out`, and checks the
checks themselves, logo versions, uploaded fonts, the plain poster without AI, cleaning what the
reader writes, repairs, edits, photo placement and matching, organic tracing and the image-model
routing. No AI calls. `DESIGN_ONLY=breakout` and `DESIGN_FORMATS=portrait` narrow it.
