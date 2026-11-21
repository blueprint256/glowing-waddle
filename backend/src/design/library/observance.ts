import type { DesignTemplate } from '../types';

/**
 * "Observance": for days that matter (World Polio Day, World Water Day, Rotary's anniversary,
 * memorials). A photograph sinks into near-black on the left, where a two-tone headline sits:
 * the occasion in the accent colour and one word (*in stars*) very large and pale, then the date
 * set as a boxed day number beside the month, and a short statement as a quote. Logos are centred
 * at the top, the campaign's beside the club's; partners sit in a white band.
 */
export const observance: DesignTemplate = {
  id: 'observance',
  version: 1,
  name: 'Observance',
  description:
    'For international and remembrance days: a photograph sinks into near-black on the left behind a two-tone headline (one word very large: wrap it in *stars*), a boxed date and a short statement in quotes. Logos centred on top with the campaign logo beside the club’s; partners in a white band. Serious and moving rather than festive.',
  tags: ['observance', 'campaign', 'statement', 'photo-led', 'dark', 'sponsors'],
  formats: ['portrait', 'square', 'story', 'landscape', 'a4', 'a3'],
  fields: [
    { name: 'eyebrow', max: 30 },
    { name: 'headline', required: true, max: 28 },
    { name: 'badge' },
    { name: 'body', max: 190 },
    { name: 'subhead', max: 90 },
    { name: 'cta', max: 30 },
    { name: 'hashtag', max: 26 },
    { name: 'social', max: 30 },
    { name: 'web', max: 30 },
    { name: 'sponsorsTitle', max: 24 }
  ],
  photos: { min: 1, max: 1 },
  sponsors: { min: 0, max: 9 },
  background: 'none',
  params: [
    { key: 'accent', label: 'Headline colour', type: 'color', default: 'accent' },
    { key: 'dark', label: 'How far the dark reaches', type: 'number', min: 0.4, max: 0.75, default: 0.58, step: 0.02, roomy: 'max' },
    { key: 'focusX', label: 'Where the photo’s subject sits (left to right)', type: 'number', min: 0.55, max: 0.85, default: 0.72, step: 0.01, roomy: 'max' },
    { key: 'quote', label: 'Set the statement as a quote', type: 'toggle', default: true }
  ],
  html: `
<div class="ob-photo t-unify" data-photo="1" data-slide data-focus-x="param:focusX" data-focus-y="0.42"></div>
<div class="ob-dark"></div>
<div class="d-grain"></div>

<header class="ob-head">
  <div class="ob-logo" data-logo="primary" data-surface="dark"></div>
  <div class="ob-campaign" data-logo="campaign" data-surface="dark"></div>
</header>

<main class="ob-copy" data-fit-box data-measure="copy">
  <p class="ob-eyebrow" data-field="eyebrow" data-case="upper" data-fit data-min="1.9" data-max="2.4" data-lines="1" data-fit-order="5"></p>
  <h1 class="ob-headline" data-field="headline" data-case="upper" data-fit data-min="5" data-max="9.5" data-lines="4" data-fit-order="1"></h1>
  <div class="ob-date" data-badge>
    <span class="ob-date-day" data-badge-main></span>
    <span class="ob-date-rest"><span class="ob-date-top" data-badge-top></span><span class="ob-date-month" data-badge-bottom></span></span>
  </div>
  <p class="ob-subhead d-pretty" data-field="subhead" data-fit data-min="2.4" data-max="3.2" data-lines="2" data-fit-order="3"></p>
  <p class="ob-body d-pretty" data-field="body" data-fit data-min="2.3" data-max="3.1" data-lines="5" data-fit-order="2"></p>
  <p class="ob-cta" data-field="cta"></p>
</main>

<div class="ob-contact" data-if="contact|hashtag">
  <p class="ob-hashtag" data-field="hashtag"></p>
  <p class="ob-contact-line" data-if="social"><span data-icon="at"></span><span data-field="social"></span></p>
  <p class="ob-contact-line" data-if="web"><span data-icon="web"></span><span data-field="web"></span></p>
</div>

<footer class="ob-band" data-if="sponsors">
  <div class="ob-sponsors" data-sponsors data-rows="1">
    <div class="ob-sponsor-row d-sponsor-row" data-sponsor-row></div>
  </div>
</footer>
`,
  css: `
#poster {
  --m: 6.4cqmin;
  --logo-h: 8.4cqmin;
  --band-h: 12cqh;
  --floor: var(--band-h);
  --night: color-mix(in oklab, var(--c-primary-deep), #000 62%);
  --copy-w: 60cqw;
  background: var(--night);
  color: var(--c-paper);
}
#poster:not(:has(.ob-band)) { --floor: 0px; }

.ob-photo { position: absolute; z-index: 0; left: 18cqw; right: 0; top: 0; bottom: var(--floor); }
.ob-photo .d-photo-img { filter: contrast(1.08) saturate(0.82) brightness(0.92); }
/* The dark: from the left (behind the words), from the top (behind the logos) and a little at the
   bottom, tinted with the brand's deepest colour so the black isn't dead. */
.ob-dark { position: absolute; z-index: 1; inset: 0; bottom: var(--floor); pointer-events: none;
  background:
    linear-gradient(90deg, var(--night) 0, var(--night) calc(var(--p-dark) * 40cqw), color-mix(in oklab, var(--night) 80%, transparent) calc(var(--p-dark) * 80cqw), transparent calc(var(--p-dark) * 128cqw)),
    linear-gradient(180deg, color-mix(in oklab, var(--night) 85%, transparent) 0, transparent 26cqh),
    linear-gradient(0deg, color-mix(in oklab, var(--night) 70%, transparent) 0, transparent 22cqh),
    radial-gradient(70cqmax 60cqmax at 80% 45%, transparent 40%, rgb(0 0 0 / 0.3) 100%); }
.d-grain { z-index: 2; opacity: 0.11; }

.ob-head { position: absolute; z-index: 5; left: 0; right: 0; top: var(--m); height: var(--logo-h);
  display: flex; align-items: center; justify-content: center; gap: calc(var(--logo-h) * 0.9); }
.ob-logo { height: var(--logo-h); }
.ob-campaign { height: calc(var(--logo-h) * 1.25); }

.ob-copy { position: absolute; z-index: 4; left: var(--m); width: var(--copy-w);
  top: calc(var(--m) + var(--logo-h) * 1.25 + 6cqh); bottom: calc(var(--floor) + var(--m) + 5cqmin);
  display: flex; flex-direction: column; justify-content: center; gap: 2.6cqmin; overflow: hidden;
  /* Room on the left for the hanging opening quote. */
  padding-left: 1.4cqmin; margin-left: -1.4cqmin; }
.ob-copy > * { flex: none; }
.ob-eyebrow { font-family: var(--f-display); font-weight: 700; letter-spacing: 0.18em; line-height: 1.1; color: rgb(255 255 255 / 0.78); }
/* The occasion in the accent; the starred word huge and pale beneath it. */
.ob-headline { font-family: var(--f-display); font-weight: 800; font-stretch: 78%; line-height: 0.9; letter-spacing: -0.005em; color: var(--p-accent);
  text-shadow: 0 0.3cqmin 2cqmin rgb(0 0 0 / 0.45); }
.ob-headline em { display: block; font-style: normal; font-size: 1.85em; line-height: 0.84; letter-spacing: -0.02em; color: color-mix(in oklab, var(--c-paper) 82%, var(--c-primary) 6%); margin-top: 0.06em; }
.ob-headline br + em { margin-top: 0.06em; }

/* The date: the day boxed in the accent, the month thin and wide beside it. */
.ob-date { display: flex; align-items: center; gap: 1.6cqmin; margin-top: 1cqmin; }
.ob-date-day { font-family: var(--f-display); font-weight: 800; font-stretch: 80%; font-size: 6.2cqmin; line-height: 1;
  padding: 0.6cqmin 1.1cqmin 0.5cqmin; border-radius: 0.6cqmin; background: var(--p-accent); color: var(--p-accent-on);
  box-shadow: inset 0 0 0 0.35cqmin rgb(255 255 255 / 0.22); }
.ob-date-rest { display: flex; flex-direction: column; justify-content: center; line-height: 1; }
.ob-date-top { font-family: var(--f-display); font-weight: 700; font-size: 1.9cqmin; letter-spacing: 0.2em; text-transform: uppercase; color: rgb(255 255 255 / 0.75); margin-bottom: 0.5cqmin; }
.ob-date-month { font-family: var(--f-display); font-weight: 300; font-stretch: 100%; font-size: 6.2cqmin; letter-spacing: 0.02em; text-transform: uppercase; }

.ob-subhead { font-family: var(--f-display); font-weight: 600; line-height: 1.25; color: var(--c-paper); }
.ob-body { font-family: var(--f-display); font-weight: 600; line-height: 1.32; color: rgb(255 255 255 / 0.94); max-width: 25em; }
#poster[data-p-quote="true"] .ob-body::before { content: '“'; }
#poster[data-p-quote="true"] .ob-body::after { content: '”'; }
#poster[data-p-quote="true"] .ob-body { text-indent: -0.42em; }
.ob-cta { align-self: flex-start; font-family: var(--f-display); font-weight: 800; font-size: 2.3cqmin; letter-spacing: 0.08em; text-transform: uppercase; line-height: 1;
  padding: 1.4cqmin 2.4cqmin 1.3cqmin; border: 0.3cqmin solid var(--p-accent); color: var(--c-paper); border-radius: 0.5cqmin; }

.ob-contact { position: absolute; z-index: 5; left: var(--m); bottom: calc(var(--floor) + var(--m) * 0.75); max-width: var(--copy-w);
  display: flex; flex-wrap: wrap; align-items: center; column-gap: 3cqmin; row-gap: 0.8cqmin; }
.ob-hashtag { font-family: var(--f-display); font-weight: 800; font-size: 2.1cqmin; color: var(--p-accent); line-height: 1.1; }
.ob-contact-line { display: flex; align-items: center; gap: 0.8cqmin; font-family: var(--f-display); font-weight: 600; font-size: 1.8cqmin; line-height: 1.1; color: rgb(255 255 255 / 0.9); }
.ob-contact-line .d-icon { color: var(--p-accent); }

.ob-band { position: absolute; z-index: 6; left: 0; right: 0; bottom: 0; height: var(--band-h); background: var(--c-paper);
  display: flex; align-items: center; padding: 1.7cqmin var(--m); }
.ob-sponsors { flex: 1; height: 100%; min-width: 0; display: flex; flex-direction: column; }
.ob-sponsor-row { flex: 1; min-height: 0; min-width: 0; width: 100%; justify-content: space-between; }
#poster[data-sponsor-count="1"] .ob-sponsor-row, #poster[data-sponsor-count="2"] .ob-sponsor-row, #poster[data-sponsor-count="3"] .ob-sponsor-row { justify-content: center; gap: 7cqmin; }

#poster[data-format="square"] { --logo-h: 7.8cqmin; --band-h: 11.5cqh; --copy-w: 58cqw; }
#poster[data-format="square"] .ob-copy { gap: 2cqmin; top: calc(var(--m) + var(--logo-h) * 1.25 + 4cqh); }

/* Story: the photo above, the words below on the dark. */
#poster[data-format="story"] { --m: 7cqmin; --logo-h: 9cqmin; --band-h: 8.5cqh; --copy-w: calc(100cqw - var(--m) * 2); }
#poster[data-format="story"] .ob-photo { left: 0; bottom: 44cqh; }
#poster[data-format="story"] .ob-dark { background:
    linear-gradient(0deg, var(--night) 0, var(--night) 44cqh, color-mix(in oklab, var(--night) 60%, transparent) 50cqh, transparent 62cqh),
    linear-gradient(180deg, color-mix(in oklab, var(--night) 85%, transparent) 0, transparent 22cqh); }
#poster[data-format="story"] .ob-copy { top: 50cqh; }

/* Landscape: the photo on the right half. */
#poster[data-format="landscape"] { --m: 5cqmin; --logo-h: 7.4cqmin; --band-h: 14cqh; --copy-w: 50cqw; }
#poster[data-format="landscape"] .ob-photo { left: 34cqw; }
#poster[data-format="landscape"] .ob-head { justify-content: flex-start; left: var(--m); }
#poster[data-format="landscape"] .ob-copy { top: calc(var(--m) + var(--logo-h) * 1.25 + 3cqh); gap: 1.8cqmin; }

#poster[data-format="a4"], #poster[data-format="a3"] { --m: 7.5cqmin; --band-h: 10cqh; }
`
};
