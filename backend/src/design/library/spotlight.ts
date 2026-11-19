import type { DesignTemplate } from '../types';

/**
 * "Spotlight": one person (a speaker, chief guest or visiting officer) stands cut out on the right,
 * framed by a soft halo of light and two thin rings, while the event's words fill the left: a big
 * headline, the person's name card with its tab ("Guest speaker"), and the date, time and place
 * with icons. Logos are centred at the top; partners sit in a white band with the club's handle.
 * Modelled on how clubs in the region announce visits and talks, set with more care: one
 * measured column, a consistent rhythm, and colour that holds the person and the words together.
 *
 * Without a cut-out the photo melts into the background from the right (no hard box).
 */
export const spotlight: DesignTemplate = {
  id: 'spotlight',
  version: 1,
  name: 'Spotlight',
  description:
    'A featured person (speaker, chief guest, visiting officer) stands cut out on the right in a halo of light; the event fills the left with a big headline, their name card and the date, time and place with icons. Logos centred on top; partners and the club’s handle in a white band. Best for talks, visits, installations and fellowships with one guest.',
  tags: ['person', 'speaker', 'guest', 'event', 'cut-out', 'sponsors'],
  formats: ['portrait', 'square', 'story', 'landscape', 'a4', 'a3'],
  fields: [
    { name: 'eyebrow', max: 34 },
    { name: 'headline', required: true, max: 42 },
    { name: 'subhead', max: 70 },
    { name: 'personLabel', max: 18 },
    { name: 'personName', max: 34 },
    { name: 'personRole', max: 64 },
    { name: 'details' },
    { name: 'cta', max: 26 },
    { name: 'hashtag', max: 26 },
    { name: 'social', max: 30 },
    { name: 'web', max: 30 },
    { name: 'sponsorsTitle', max: 24 }
  ],
  photos: { min: 1, max: 1 },
  cutout: 'preferred',
  sponsors: { min: 0, max: 9 },
  background: 'none',
  params: [
    { key: 'ground', label: 'Background colour', type: 'color', default: 'primary' },
    { key: 'card', label: 'Name card colour', type: 'color', default: 'accent' },
    { key: 'accent', label: 'Accent colour (icons, emphasis)', type: 'color', default: 'accent' },
    { key: 'depth', label: 'How dark the background is', type: 'number', min: 0.3, max: 0.7, default: 0.52, step: 0.02 },
    { key: 'caps', label: 'Headline in capitals', type: 'toggle', default: true },
    { key: 'rings', label: 'Rings around the person', type: 'toggle', default: true }
  ],
  html: `
<div class="sl-ground"></div>
<div class="sl-halo"></div>
<div class="sl-ring sl-ring-1" data-if="param:rings"></div>
<div class="sl-ring sl-ring-2" data-if="param:rings"></div>
<div class="sl-photo t-unify" data-photo="1" data-if="!cutout" data-focus-x="0.62" data-focus-y="0.36"></div>
<div class="sl-person" data-cutout="1" data-stand="portrait|square|landscape|a4|a3" data-focus-x="0.64" data-max-w="1.32"></div>
<div class="sl-floor"></div>
<div class="d-grain"></div>

<header class="sl-head">
  <div class="sl-logo" data-logo="primary" data-surface="dark"></div>
  <span class="sl-divider" data-if="campaign"></span>
  <div class="sl-campaign" data-logo="campaign" data-surface="dark"></div>
</header>

<main class="sl-copy" data-fit-box data-measure="copy">
  <div class="sl-top" data-measure="top">
    <p class="sl-eyebrow" data-field="eyebrow" data-case="upper" data-fit data-min="1.9" data-max="2.4" data-lines="1" data-fit-order="5"></p>
    <h1 class="sl-headline d-balance" data-field="headline" data-fit data-min="5.4" data-max="11.5" data-lines="3" data-fit-order="1"></h1>
    <p class="sl-subhead d-pretty" data-field="subhead" data-fit data-min="2.5" data-max="3.3" data-lines="2" data-fit-order="3"></p>
  </div>
  <div class="sl-info" data-measure="info">
  <section class="sl-card d-shadow" data-if="person">
    <p class="sl-card-tab" data-field="personLabel" data-case="upper"></p>
    <p class="sl-card-name" data-field="personName" data-fit data-min="2.5" data-max="3.4" data-lines="2" data-fit-order="2"></p>
    <p class="sl-card-role" data-field="personRole" data-fit data-min="1.9" data-max="2.5" data-lines="2" data-fit-order="4"></p>
  </section>
  <div class="sl-details" data-details>
    <template><div class="d-detail sl-detail"><span data-detail-icon></span><span data-detail-text></span></div></template>
  </div>
  <p class="sl-cta" data-field="cta"></p>
  </div>
</main>

<footer class="sl-band" data-if="sponsors">
  <div class="sl-sponsors" data-sponsors data-rows="1">
    <p class="sl-sponsors-title" data-field="sponsorsTitle" data-case="upper"></p>
    <div class="sl-sponsor-row d-sponsor-row" data-sponsor-row></div>
  </div>
  <div class="sl-contact" data-if="contact|hashtag">
    <p class="sl-hashtag" data-field="hashtag"></p>
    <p class="sl-contact-line" data-if="social"><span data-icon="at"></span><span data-field="social"></span></p>
    <p class="sl-contact-line" data-if="web"><span data-icon="web"></span><span data-field="web"></span></p>
  </div>
</footer>
<footer class="sl-foot" data-if="!sponsors & contact|hashtag">
  <p class="sl-hashtag" data-field="hashtag"></p>
  <p class="sl-contact-line" data-if="social"><span data-icon="at"></span><span data-field="social"></span></p>
  <p class="sl-contact-line" data-if="web"><span data-icon="web"></span><span data-field="web"></span></p>
</footer>
`,
  css: `
#poster {
  --m: 6.2cqmin;
  --logo-h: 8.2cqmin;
  --band-h: 12.5cqh;
  --head-h: calc(var(--m) + var(--logo-h) * 1.5);
  --stage-l: 47cqw;                     /* where the person's stage starts */
  --stage-t: 21cqh;
  --copy-w: 52cqw;
  --ground-deep: color-mix(in oklab, var(--p-ground), #000 calc(var(--p-depth) * 100%));
  --ground-lit: color-mix(in oklab, var(--p-ground), #000 calc(var(--p-depth) * 45%));
  --floor: var(--band-h);
  background: var(--ground-deep);
  color: var(--c-paper);
}
#poster:not(:has(.sl-band)) { --floor: 0px; }

/* Light: a soft pool of the brand colour where the person stands, darker towards the words and
   the edges, so the photo's own light seems to come from the poster. */
.sl-ground { position: absolute; inset: 0; z-index: 0;
  background:
    radial-gradient(60cqmax 52cqmax at 76% 50%, var(--ground-lit) 0%, color-mix(in oklab, var(--ground-lit), var(--ground-deep) 55%) 46%, transparent 78%),
    linear-gradient(180deg, rgb(0 0 0 / 0.16), transparent 30%, transparent 70%, rgb(0 0 0 / 0.22)),
    var(--ground-deep);
}
.sl-halo { position: absolute; z-index: 1; pointer-events: none;
  left: calc(var(--stage-l) + 6cqw); top: calc(var(--stage-t) - 4cqh); width: 52cqmin; height: 52cqmin; border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in oklab, var(--p-accent) 38%, transparent), transparent);
  filter: blur(2cqmin); opacity: 0.55;
}
.sl-ring { position: absolute; z-index: 1; border-radius: 50%; pointer-events: none; border: 0.32cqmin solid color-mix(in oklab, var(--p-accent) 55%, transparent); }
.sl-ring-1 { width: 62cqmin; height: 62cqmin; left: calc(var(--stage-l) + 1cqw); top: calc(var(--stage-t) - 7cqh); }
.sl-ring-2 { width: 62cqmin; height: 62cqmin; left: calc(var(--stage-l) + 5cqw); top: calc(var(--stage-t) - 4cqh); opacity: 0.45; border-style: solid; border-width: 0.22cqmin; }

/* The person, standing on the band (or the bottom edge). */
.sl-person { position: absolute; z-index: 2; left: var(--stage-l); right: 0; top: var(--stage-t); bottom: var(--floor); }
.sl-person .d-cutout-img { filter: drop-shadow(0 1.6cqmin 2.6cqmin rgb(0 0 0 / 0.38)) contrast(1.03) saturate(0.96); }
/* No cut-out: the photo melts into the ground from its left and top edges. */
.sl-photo { position: absolute; z-index: 2; left: calc(var(--stage-l) - 2cqw); right: 0; top: calc(var(--head-h) + 1cqh); bottom: var(--floor);
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 34%), linear-gradient(180deg, transparent 0, #000 18%);
  -webkit-mask-composite: source-in; mask-image: linear-gradient(90deg, transparent 0, #000 34%), linear-gradient(180deg, transparent 0, #000 18%); mask-composite: intersect; }
.sl-floor { position: absolute; z-index: 3; left: 0; right: 0; bottom: var(--floor); height: 9cqh; pointer-events: none;
  background: linear-gradient(180deg, transparent, rgb(0 0 0 / 0.22)); }
.d-grain { z-index: 3; opacity: 0.09; }

/* Logos: centred, the campaign logo after a hairline. */
.sl-head { position: absolute; z-index: 6; left: 0; right: 0; top: var(--m); height: var(--logo-h);
  display: flex; align-items: center; justify-content: center; gap: calc(var(--logo-h) * 0.5); }
.sl-logo { height: var(--logo-h); }
.sl-campaign { height: calc(var(--logo-h) * 0.96); }
.sl-divider { width: 0.22cqmin; align-self: stretch; margin: 0.6cqmin 0; background: rgb(255 255 255 / 0.55); }

/* The words: one column, its parts spaced in a steady rhythm. */
.sl-copy { position: absolute; z-index: 5; left: var(--m); width: var(--copy-w);
  top: calc(var(--head-h) + 4.5cqh); bottom: calc(var(--floor) + var(--m) * 0.9);
  display: flex; flex-direction: column; justify-content: center; gap: 3.4cqmin; overflow: hidden; }
.sl-top { flex: none; display: flex; flex-direction: column; gap: 1.6cqmin; }
.sl-info { flex: none; display: flex; flex-direction: column; gap: 3.4cqmin; }
.sl-info:empty { display: none; }
.sl-eyebrow { font-family: var(--f-display); font-weight: 700; letter-spacing: 0.16em; line-height: 1.1; color: var(--p-accent); white-space: nowrap; }
.sl-headline { font-family: var(--f-display); font-weight: 800; font-stretch: 80%; line-height: 0.92; letter-spacing: -0.008em; color: var(--c-paper); }
#poster[data-p-caps="true"] .sl-headline { text-transform: uppercase; line-height: 0.9; }
.sl-headline em { font-style: normal; color: var(--p-accent); }
.sl-subhead { font-family: var(--f-text); font-weight: 400; line-height: 1.3; color: rgb(255 255 255 / 0.9); max-width: 30em; }

/* Name card with its tab. */
.sl-card { flex: none; position: relative; align-self: flex-start; max-width: 100%;
  margin-top: 1.6cqmin; padding: 2.6cqmin 3.4cqmin 2.4cqmin;
  background: var(--p-card); color: var(--p-card-on); border-radius: 1.1cqmin; }
.sl-card-tab { position: absolute; left: 3.4cqmin; top: 0; transform: translateY(-58%);
  font-family: var(--f-display); font-weight: 700; font-size: 1.75cqmin; letter-spacing: 0.16em; line-height: 1;
  padding: 0.9cqmin 1.5cqmin 0.85cqmin; border-radius: 0.5cqmin;
  background: var(--c-paper); color: var(--c-ink); white-space: nowrap; }
.sl-card-name { font-family: var(--f-display); font-weight: 800; font-stretch: 90%; line-height: 1.08; }
.sl-card-role { font-family: var(--f-text); font-weight: 400; line-height: 1.25; margin-top: 0.5cqmin; opacity: 0.92; }

.sl-details { display: flex; flex-direction: column; gap: 1.5cqmin; }
.sl-detail { font-family: var(--f-display); font-weight: 600; font-stretch: 92%; font-size: 2.65cqmin; line-height: 1.15;
  letter-spacing: 0.04em; text-transform: uppercase; color: var(--c-paper); }
.sl-detail svg { color: var(--p-accent); width: 1.25em; height: 1.25em; }
.sl-cta { align-self: flex-start; font-family: var(--f-display); font-weight: 800; font-stretch: 85%; font-size: 2.4cqmin;
  letter-spacing: 0.06em; text-transform: uppercase; line-height: 1;
  padding: 1.5cqmin 2.6cqmin 1.4cqmin; border-radius: 99cqmin; background: var(--p-accent); color: var(--p-accent-on); }

/* White band: partners on the left, the club's handle on the right. */
.sl-band { position: absolute; z-index: 6; left: 0; right: 0; bottom: 0; height: var(--band-h);
  display: flex; align-items: center; gap: 3cqmin; padding: 0 var(--m);
  background: var(--c-paper); color: var(--c-ink); }
.sl-band::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 0.6cqmin; background: var(--p-accent); }
.sl-sponsors { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 1cqmin; padding: 2.2cqmin 0 2cqmin; }
.sl-sponsors-title { font-family: var(--f-display); font-weight: 700; font-size: 1.55cqmin; letter-spacing: 0.16em; line-height: 1; color: var(--p-ground-on-paper); }
.sl-sponsor-row { flex: 1; min-height: 0; justify-content: space-between; }
#poster[data-sponsor-count="1"] .sl-sponsor-row, #poster[data-sponsor-count="2"] .sl-sponsor-row, #poster[data-sponsor-count="3"] .sl-sponsor-row { justify-content: flex-start; }
.sl-contact { flex: none; max-width: 30cqw; display: flex; flex-direction: column; gap: 0.9cqmin; padding-left: 3cqmin; border-left: 0.2cqmin solid rgb(var(--c-ink-rgb) / 0.16); }
.sl-contact-line { display: flex; align-items: center; gap: 0.8cqmin; font-family: var(--f-display); font-weight: 600; font-size: 1.75cqmin; line-height: 1.15; white-space: nowrap; }
.sl-contact-line .d-icon { color: var(--p-ground-on-paper); }
.sl-hashtag { font-family: var(--f-display); font-weight: 800; font-size: 2cqmin; line-height: 1.1; color: var(--p-ground-on-paper); white-space: nowrap; }
/* Five or more partners: they take the whole band and the handle sits just above it. */
#poster.d-sp-ge-5 .sl-contact { position: absolute; left: var(--m); bottom: calc(100% + 2.2cqmin); max-width: var(--copy-w); flex-wrap: wrap; row-gap: 0.8cqmin;
  flex-direction: row; align-items: center; gap: 3cqmin; padding: 0; border: none; color: var(--c-paper); }
#poster.d-sp-ge-5 .sl-contact .d-icon, #poster.d-sp-ge-5 .sl-hashtag { color: var(--p-accent); }
#poster.d-sp-ge-5 .sl-copy { bottom: calc(var(--floor) + var(--m) * 0.9 + 4.5cqmin); }
#poster.d-sp-ge-5 .sl-floor { height: 14cqh; background: linear-gradient(180deg, transparent, rgb(0 0 0 / 0.42)); }
/* No partners: the handle sits under the words. */
.sl-foot { position: absolute; z-index: 6; left: var(--m); bottom: var(--m); display: flex; align-items: center; gap: 3cqmin; color: var(--c-paper); }
.sl-foot .sl-hashtag { color: var(--p-accent); }
.sl-foot .d-icon { color: var(--p-accent); }
#poster:has(.sl-foot) .sl-copy { bottom: calc(var(--m) * 2 + 3cqmin); }

/* Square: tighter. */
#poster[data-format="square"] { --logo-h: 7.6cqmin; --band-h: 13cqh; --stage-t: 19cqh; --stage-l: 50cqw; --copy-w: 56cqw; }
#poster[data-format="square"] .sl-copy { gap: 2.6cqmin; top: calc(var(--head-h) + 3cqh); }
#poster[data-format="square"] .sl-ring-1, #poster[data-format="square"] .sl-ring-2 { width: 56cqmin; height: 56cqmin; }

/* Story: the person stands in the middle; the words above and the card and details over a dark
   floor at the bottom. */
#poster[data-format="story"] { --m: 7cqmin; --logo-h: 9cqmin; --band-h: 9.5cqh; --stage-l: 18cqw; --stage-t: 36cqh; --copy-w: calc(100cqw - var(--m) * 2); }
#poster[data-format="story"] .sl-copy { top: calc(var(--head-h) + 3cqh); justify-content: space-between; gap: 2.4cqmin; }
/* Story: the person stands on the information, between it and the headline. */
#poster[data-format="story"] .sl-person { left: 0; right: 0; top: calc(var(--top-bottom, 34cqh) + 1.5cqh); bottom: calc(100cqh - var(--info-top, 72cqh) - 4cqh); }
#poster[data-format="story"] .sl-info { gap: 2.4cqmin; }
#poster[data-format="story"] .sl-top { align-items: center; text-align: center; }
#poster[data-format="story"] .sl-floor { display: none; }
#poster[data-format="story"] .sl-halo { left: 26cqw; top: 33cqh; width: 70cqmin; height: 70cqmin; }
#poster[data-format="story"] .sl-ring-1 { left: 14cqw; top: 31cqh; width: 74cqmin; height: 74cqmin; }
#poster[data-format="story"] .sl-ring-2 { left: 20cqw; top: 33cqh; width: 74cqmin; height: 74cqmin; }
#poster[data-format="story"] .sl-photo { left: 0; -webkit-mask-image: linear-gradient(180deg, transparent 22%, #000 46%); mask-image: linear-gradient(180deg, transparent 22%, #000 46%); }

/* Landscape: logos to the left, the words beside the person. */
#poster[data-format="landscape"] { --m: 5cqmin; --logo-h: 7.6cqmin; --band-h: 15cqh; --stage-l: 56cqw; --stage-t: 8cqh; --copy-w: 52cqw; }
#poster[data-format="landscape"] .sl-head { justify-content: flex-start; left: var(--m); }
#poster[data-format="landscape"] .sl-copy { top: calc(var(--head-h) + 3cqh); gap: 2.4cqmin; }
#poster[data-format="landscape"] .sl-halo { left: 60cqw; top: 6cqh; }
#poster[data-format="landscape"] .sl-ring-1 { left: 57cqw; top: 2cqh; }
#poster[data-format="landscape"] .sl-ring-2 { left: 62cqw; top: 5cqh; }

/* Print: more margin for trimming. */
#poster[data-format="a4"], #poster[data-format="a3"] { --m: 7.5cqmin; --band-h: 11cqh; --stage-t: 23cqh; }
`
};
