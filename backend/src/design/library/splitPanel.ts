import type { DesignTemplate } from '../types';

/**
 * "Split panel": the photo above a diagonal edge, a solid brand panel below for the words, and a
 * white signature bar at the foot with the club's logos and its partners. A gold stripe runs along
 * the diagonal, and a second photo (or the date) sits in a ring that crosses the edge, so photo and
 * panel read as one piece.
 *
 * The words get the room they need and the photo takes the rest (never less than its minimum):
 * the column is a flex layout, and the stripe and ring follow the photo's measured edge.
 */
export const splitPanel: DesignTemplate = {
  id: 'split-panel',
  version: 2,
  name: 'Split panel',
  description:
    'Photo on top with a diagonal edge, a solid brand-colour panel for the words, and a white signature bar with the club logos and up to eight partners. A second photo or the date sits in a ring across the edge. Best when there is a lot to say and many sponsors to thank.',
  tags: ['photo', 'information-rich', 'many sponsors', 'institutional', 'two photos'],
  formats: ['portrait', 'square', 'story', 'landscape', 'a4', 'a3'],
  fields: [
    { name: 'eyebrow', max: 45 },
    { name: 'headline', required: true, max: 70 },
    { name: 'subhead', max: 160 },
    { name: 'details' },
    { name: 'cta', max: 60 },
    { name: 'badge' },
    { name: 'sponsorsTitle', max: 30 },
    { name: 'hashtag', max: 30 }
  ],
  photos: { min: 1, max: 2 },
  sponsors: { min: 0, max: 8 },
  background: 'none',
  params: [
    { key: 'minPhoto', label: 'Smallest share of the poster for the photo', type: 'number', min: 0.32, max: 0.55, default: 0.42, step: 0.01, roomy: 'min' },
    { key: 'slope', label: 'Steepness of the diagonal', type: 'number', min: 0, max: 14, default: 7, step: 1 },
    { key: 'panel', label: 'Panel colour', type: 'color', default: 'primary' },
    { key: 'accent', label: 'Accent colour', type: 'color', default: 'accent' },
    { key: 'focusY', label: 'Where the photo’s subject sits', type: 'number', min: 0.3, max: 0.7, default: 0.48, step: 0.01 }
  ],
  html: `
<div class="sp-col" data-fit-box>
  <div class="sp-top" data-measure="top">
    <div class="sp-photo d-fill t-unify" data-photo="1" data-focus-y="param:focusY"></div>
    <div class="sp-photo-tint d-fill"></div>
  </div>
  <div class="sp-copy" data-measure="copy">
    <p class="sp-eyebrow" data-field="eyebrow" data-case="upper" data-fit data-min="1.9" data-max="2.4" data-lines="2" data-fit-order="4"></p>
    <h1 class="sp-headline d-balance" data-field="headline" data-fit data-min="4.6" data-max="9" data-lines="4" data-fit-order="1"></h1>
    <p class="sp-subhead d-pretty" data-field="subhead" data-fit data-min="2.3" data-max="3" data-lines="4" data-fit-order="2"></p>
    <div class="sp-details" data-details>
      <template><div class="d-detail sp-detail"><span data-detail-icon></span><span data-detail-text></span></div></template>
    </div>
    <div class="sp-cta-row" data-if="cta|hashtag">
      <p class="sp-cta" data-field="cta"></p>
      <p class="sp-hashtag" data-field="hashtag"></p>
    </div>
  </div>
  <div class="sp-bar">
    <div class="sp-logos">
      <div class="sp-logo" data-logo="primary" data-surface="light"></div>
      <div class="sp-campaign" data-logo="campaign" data-surface="light"></div>
    </div>
    <div class="sp-sponsors" data-sponsors data-rows="2" data-if="sponsors">
      <p class="sp-sponsors-title" data-field="sponsorsTitle"></p>
      <div class="sp-sponsor-row d-sponsor-row" data-sponsor-row></div>
    </div>
  </div>
</div>
<div class="sp-stripe"></div>
<div class="d-grain"></div>
<div class="sp-ring sp-ring-photo d-shadow" data-if="photos>=2"><div class="sp-ring-inner t-unify" data-photo="2"></div></div>
<div class="sp-ring sp-badge d-shadow" data-badge data-if="photos<2">
  <span class="sp-badge-top" data-badge-top></span>
  <span class="sp-badge-main" data-badge-main></span>
  <span class="sp-badge-bottom" data-badge-bottom></span>
</div>
`,
  css: `
#poster {
  --m: 6.2cqmin;
  --bar-h: 13.5cqh;
  --logo-h: 7.2cqmin;
  --ring: 23cqmin;
  --rise: calc(var(--p-slope) * 1cqh);            /* the diagonal: this much higher on the right */
  --edge: var(--top-bottom, 50cqh);               /* the photo's bottom on the left (measured) */
  background: var(--p-panel);
}
.sp-col { position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden; z-index: 1; }
.sp-top {
  position: relative; flex: 1 1 auto; min-height: calc(var(--p-minPhoto) * 100cqh);
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - var(--rise)), 0 100%);
  margin-bottom: -0.5px;
}
/* A whisper of shadow at the top and of the panel colour at the bottom: the photo melts in. */
.sp-photo-tint {
  pointer-events: none;
  background: linear-gradient(180deg, rgb(var(--c-ink-rgb) / 0.2) 0%, rgb(var(--c-ink-rgb) / 0) 24%, rgb(var(--c-primary-deep-rgb) / 0) 58%, rgb(var(--c-primary-deep-rgb) / 0.45) 100%);
}
.sp-copy {
  flex: none; position: relative;
  padding: 4.4cqmin calc(var(--m) + var(--ring) * 0.62) 4.2cqmin var(--m);
  display: flex; flex-direction: column; gap: 1.7cqmin;
  color: var(--p-panel-on);
}
.sp-eyebrow { font-family: var(--f-display); font-weight: 700; letter-spacing: 0.13em; line-height: 1.15; color: var(--p-accent-on-panel); }
.sp-headline { font-family: var(--f-display); font-weight: 800; font-stretch: 80%; line-height: 0.96; letter-spacing: -0.01em; }
.sp-subhead { font-family: var(--f-text); line-height: 1.33; opacity: 0.94; max-width: 36em; }
.sp-details { display: grid; grid-template-columns: repeat(2, minmax(0, auto)); justify-content: start; column-gap: 4.5cqmin; row-gap: 1cqmin; margin-top: 0.3cqmin; }
.sp-detail { font-family: var(--f-display); font-weight: 600; font-stretch: 92%; font-size: 2.4cqmin; line-height: 1.2; }
.sp-detail svg { color: var(--p-accent-on-panel); }
.sp-cta-row { display: flex; align-items: center; gap: 3cqmin; flex-wrap: wrap; margin-top: 0.6cqmin; }
.sp-cta { font-family: var(--f-display); font-weight: 800; font-stretch: 85%; letter-spacing: 0.02em; text-transform: uppercase; font-size: 2.45cqmin; line-height: 1; color: var(--on-accent); background: var(--p-accent); padding: 1.4cqmin 2.4cqmin; border-radius: 0.6cqmin; }
.sp-hashtag { font-family: var(--f-display); font-weight: 700; font-size: 2.3cqmin; color: var(--p-accent-on-panel); letter-spacing: 0.02em; }

/* The accent stripe along the diagonal (follows the measured edge). */
.sp-stripe {
  position: absolute; left: 0; right: 0; z-index: 2; pointer-events: none;
  top: calc(var(--edge) - var(--rise) - 0.6cqmin); height: calc(var(--rise) + 1.6cqmin);
  background: var(--p-accent);
  clip-path: polygon(0 calc(100% - 1.25cqmin), 100% 0, 100% 1.25cqmin, 0 100%);
}
.d-grain { z-index: 3; opacity: 0.09; }

/* The ring across the diagonal: a second photo, or the date. */
.sp-ring {
  position: absolute; z-index: 5; right: var(--m);
  top: calc(var(--edge) - var(--rise) * 0.2 - var(--ring) * 0.66);
  width: var(--ring); height: var(--ring); border-radius: 50%;
  border: 0.9cqmin solid var(--c-paper); overflow: hidden;
}
.sp-ring-inner { position: absolute; inset: 0; }
.sp-badge { --ring: 19cqmin; background: var(--p-accent); color: var(--c-primary-deep); display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: var(--f-display); text-align: center; line-height: 1; }
.sp-badge-top, .sp-badge-bottom { font-weight: 700; font-size: calc(var(--ring) * 0.125); letter-spacing: 0.14em; text-transform: uppercase; }
.sp-badge-main { font-weight: 800; font-size: calc(var(--ring) * 0.4); font-stretch: 80%; margin: 0.3cqmin 0 0.1cqmin; }
#poster:has(.sp-badge) .sp-copy { padding-right: calc(var(--m) + 19cqmin * 0.62); }

/* Signature bar: the club's logos on the left, partners on the right. */
.sp-bar {
  flex: none; height: var(--bar-h); position: relative; z-index: 6;
  background: var(--c-paper);
  display: flex; align-items: center; gap: 0;
  padding: 0 var(--m);
}
.sp-logos { display: flex; align-items: center; gap: calc(var(--logo-h) * max(var(--clear-primary), var(--clear-campaign)) * 2.4); flex: none; }
.sp-logo { height: var(--logo-h); }
.sp-campaign { height: calc(var(--logo-h) * 0.9); }
.sp-sponsors {
  flex: 1; min-width: 0; height: 100%;
  display: flex; flex-direction: column; justify-content: center; gap: 1cqmin;
  margin-left: calc(var(--logo-h) * var(--clear-primary) + 2.5cqmin);
  padding: 2.2cqmin 0 2.2cqmin calc(var(--logo-h) * var(--clear-primary) + 2.5cqmin);
  border-left: 0.25cqmin solid rgb(var(--c-ink-rgb) / 0.14);
}
.sp-sponsors-title { font-family: var(--f-display); font-weight: 700; font-size: 1.55cqmin; letter-spacing: 0.15em; text-transform: uppercase; color: var(--c-primary); line-height: 1; }
.sp-sponsor-row { flex: 1; min-height: 0; justify-content: flex-start; }
/* Four or more partners: they move to their own line under the logos. */
#poster.d-sp-ge-4 { --bar-h: 19cqh; }
#poster.d-sp-ge-4 .sp-bar { flex-direction: column; align-items: stretch; justify-content: center; gap: calc(var(--logo-h) * var(--clear-primary) + 1cqmin); padding-top: 2.4cqmin; padding-bottom: 2cqmin; }
#poster.d-sp-ge-4 .sp-sponsors { border-left: 0; margin-left: 0; padding: 1.6cqmin 0 0; border-top: 0.25cqmin solid rgb(var(--c-ink-rgb) / 0.14); flex: 1; }

#poster[data-format="square"] { --bar-h: 15cqh; --ring: 19cqmin; --logo-h: 6.8cqmin; }
#poster[data-format="square"] .sp-top { min-height: calc(var(--p-minPhoto) * 74cqh); }
#poster[data-format="story"] { --bar-h: 12.5cqh; --m: 7cqmin; --ring: 26cqmin; --logo-h: 8.2cqmin; }
#poster[data-format="story"] .sp-copy { gap: 2.2cqmin; padding-bottom: 6cqmin; }
#poster[data-format="story"].d-sp-ge-4 { --bar-h: 15cqh; }

/* Landscape: photo on the right; words on the left; the bar runs across the bottom. */
#poster[data-format="landscape"] { --bar-h: 17cqh; --m: 5cqmin; --ring: 18cqmin; --logo-h: 7cqmin; }
#poster[data-format="landscape"] .sp-col { display: grid; grid-template-columns: 1fr calc(var(--p-minPhoto) * 100cqw + 8cqw); grid-template-rows: 1fr auto; }
#poster[data-format="landscape"] .sp-top { grid-column: 2; grid-row: 1; min-height: 0; clip-path: polygon(calc(var(--p-slope) * 0.7cqw) 0, 100% 0, 100% 100%, 0 100%); }
#poster[data-format="landscape"] .sp-photo-tint { background: linear-gradient(90deg, rgb(var(--c-primary-deep-rgb) / 0.35), rgb(var(--c-primary-deep-rgb) / 0) 35%); }
#poster[data-format="landscape"] .sp-copy { grid-column: 1; grid-row: 1; justify-content: center; padding: 4cqh 3cqw 4cqh var(--m); }
#poster[data-format="landscape"] .sp-bar { grid-column: 1 / 3; grid-row: 2; }
#poster[data-format="landscape"] .sp-stripe { display: none; }
#poster[data-format="landscape"] .sp-ring { top: auto; bottom: calc(var(--bar-h) + 4cqh); right: calc(var(--p-minPhoto) * 100cqw + 8cqw - var(--ring) * 0.5); }
#poster[data-format="landscape"] .sp-ring.sp-badge { right: calc(var(--p-minPhoto) * 100cqw + 8cqw - 9.5cqmin); }

#poster[data-format="a4"], #poster[data-format="a3"] { --m: 7cqmin; --bar-h: 12.5cqh; }
`
};
