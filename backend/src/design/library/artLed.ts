import type { DesignTemplate } from '../types';

/**
 * "Art led": an illustration (made by the image model for this area only, never with words or
 * logos in it) fills the upper part and ends in a soft curve. The headline sits on warm paper below
 * it, the date badge straddles the curve, and a quiet footer carries the logos and partners.
 * Used when there is no strong photo, or for awareness messages that want warmth over realism.
 */
export const artLed: DesignTemplate = {
  id: 'art-led',
  version: 2,
  name: 'Art led',
  description:
    'A warm illustration (made by the image model for this area only, without any words) fills the top and ends in a soft curve; headline in brand colour on warm paper below; date badge on the curve; quiet footer with logos and partners. Best for awareness messages, celebrations and events without a strong photo. Uses the first photo instead if no illustration is made.',
  tags: ['illustration', 'awareness', 'warm', 'no photo needed', 'celebration'],
  formats: ['portrait', 'square', 'story', 'landscape', 'a4', 'a3'],
  fields: [
    { name: 'eyebrow', max: 40 },
    { name: 'headline', required: true, max: 55 },
    { name: 'subhead', max: 140 },
    { name: 'details' },
    { name: 'cta', max: 50 },
    { name: 'badge' },
    { name: 'sponsorsTitle', max: 30 }
  ],
  photos: { min: 0, max: 1 },
  sponsors: { min: 0, max: 6 },
  background: 'optional',
  backgroundBrief:
    'A warm, hopeful editorial illustration with a clear focal subject in the upper middle, soft textured shapes, plenty of calm sky or open space, no text, no letters, no logos, no borders. The lower fifth fades to simple shapes because it will be covered.',
  backgroundArea: { w: 1, h: 0.55 },
  params: [
    { key: 'minArt', label: 'Smallest share of the poster for the illustration', type: 'number', min: 0.36, max: 0.6, default: 0.44, step: 0.01, roomy: 'min' },
    { key: 'curve', label: 'Depth of the curve', type: 'number', min: 0, max: 9, default: 5, step: 1 },
    { key: 'ink', label: 'Headline colour', type: 'color', default: 'primary' },
    { key: 'accent', label: 'Accent colour', type: 'color', default: 'accent' }
  ],
  html: `
<div class="al-col" data-fit-box>
  <div class="al-top" data-measure="art">
    <div class="al-art d-fill" data-bg></div>
    <div class="al-art d-fill t-unify" data-photo="1" data-if="!background"></div>
    <div class="al-wash d-fill"></div>
  </div>
  <div class="al-copy" data-measure="copy">
    <p class="al-eyebrow" data-field="eyebrow" data-case="upper" data-fit data-min="1.9" data-max="2.4" data-lines="1" data-fit-order="4"></p>
    <h1 class="al-headline d-balance" data-field="headline" data-fit data-min="4.6" data-max="9.5" data-lines="3" data-fit-order="1"></h1>
    <p class="al-subhead d-pretty" data-field="subhead" data-fit data-min="2.3" data-max="2.9" data-lines="3" data-fit-order="2"></p>
    <div class="al-details" data-details>
      <template><div class="d-detail al-detail"><span data-detail-icon></span><span data-detail-text></span></div></template>
    </div>
    <p class="al-cta" data-field="cta"></p>
  </div>
  <div class="al-foot">
    <div class="al-logos">
      <div class="al-logo" data-logo="primary" data-surface="light"></div>
      <div class="al-campaign" data-logo="campaign" data-surface="light"></div>
    </div>
    <div class="al-sponsors" data-sponsors data-rows="2" data-if="sponsors">
      <p class="al-sponsors-title" data-field="sponsorsTitle"></p>
      <div class="al-sponsor-row d-sponsor-row" data-sponsor-row></div>
    </div>
  </div>
</div>
<div class="d-grain"></div>
<div class="al-badge d-shadow" data-badge>
  <span class="al-badge-top" data-badge-top></span>
  <span class="al-badge-main" data-badge-main></span>
  <span class="al-badge-bottom" data-badge-bottom></span>
</div>
`,
  css: `
#poster {
  --m: 6.5cqmin;
  --dip: calc(var(--p-curve) * 1cqh);
  --foot-h: 13cqh;
  --logo-h: 7cqmin;
  --badge: 18cqmin;
  background: var(--c-paper-warm);
}
.al-col { position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden; z-index: 1; }
.al-top {
  position: relative; flex: 1 1 auto; min-height: calc(var(--p-minArt) * 100cqh);
  /* A soft curve instead of a hard edge: the illustration rests on the paper. */
  -webkit-mask-image: radial-gradient(150% calc(var(--dip) * 2 + 40px) at 50% 100%, transparent calc(100% - 1px), #000 100%);
  mask-image: radial-gradient(150% calc(var(--dip) * 2 + 40px) at 50% 100%, transparent calc(100% - 1px), #000 100%);
}
/* A light warm wash ties the art to the paper. */
.al-wash {
  pointer-events: none;
  background: linear-gradient(180deg, rgb(var(--c-ink-rgb) / 0.14) 0%, rgb(var(--c-ink-rgb) / 0) 22%, rgb(var(--c-paper-rgb) / 0) 70%, rgb(var(--c-paper-rgb) / 0.18) 100%);
  mix-blend-mode: soft-light;
}
.d-grain { z-index: 2; opacity: 0.12; mix-blend-mode: multiply; }

.al-badge {
  position: absolute; z-index: 5;
  right: var(--m); top: calc(var(--art-bottom, 55cqh) - var(--dip) - var(--badge) * 0.6);
  width: var(--badge); height: var(--badge); border-radius: 50%;
  background: var(--p-accent); color: var(--c-primary-deep);
  border: 0.8cqmin solid var(--c-paper-warm);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-family: var(--f-display); text-align: center; line-height: 1;
}
.al-badge-top, .al-badge-bottom { font-weight: 700; font-size: calc(var(--badge) * 0.125); letter-spacing: 0.14em; text-transform: uppercase; }
.al-badge-main { font-weight: 800; font-size: calc(var(--badge) * 0.4); font-stretch: 80%; margin: 0.3cqmin 0 0.1cqmin; }

.al-copy {
  flex: none; position: relative;
  padding: 2.4cqmin var(--m) 3.6cqmin;
  display: flex; flex-direction: column; gap: 1.6cqmin;
  color: var(--c-ink);
}
#poster:has(.al-badge) .al-copy { padding-right: calc(var(--m) + var(--badge) * 0.8); }
.al-eyebrow { font-family: var(--f-display); font-weight: 700; letter-spacing: 0.14em; color: var(--c-accent-deep); line-height: 1.1; white-space: nowrap; }
.al-headline { font-family: var(--f-display); font-weight: 800; font-stretch: 80%; line-height: 0.96; letter-spacing: -0.01em; color: var(--p-ink-on-paper); }
.al-subhead { font-family: var(--f-text); line-height: 1.34; color: rgb(var(--c-ink-rgb) / 0.86); max-width: 36em; }
.al-details { display: flex; flex-wrap: wrap; column-gap: 4cqmin; row-gap: 0.9cqmin; }
.al-detail { font-family: var(--f-display); font-weight: 600; font-stretch: 92%; font-size: 2.35cqmin; line-height: 1.2; color: var(--c-ink); }
.al-detail svg { color: var(--p-ink-on-paper); }
.al-cta { align-self: flex-start; font-family: var(--f-display); font-weight: 800; font-stretch: 85%; letter-spacing: 0.02em; text-transform: uppercase; font-size: 2.4cqmin; line-height: 1; color: var(--p-ink-on); background: var(--p-ink); padding: 1.4cqmin 2.4cqmin; border-radius: 0.6cqmin; }

.al-foot {
  flex: none; height: var(--foot-h); margin: 0 var(--m);
  display: flex; align-items: center; gap: 0;
  border-top: 0.25cqmin solid rgb(var(--c-ink-rgb) / 0.14);
}
.al-logos { display: flex; align-items: center; gap: calc(var(--logo-h) * max(var(--clear-primary), var(--clear-campaign)) * 2.4); flex: none; }
.al-logo { height: var(--logo-h); }
.al-campaign { height: calc(var(--logo-h) * 0.9); }
.al-sponsors { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 0.9cqmin; padding: 2cqmin 0 2cqmin calc(var(--logo-h) * var(--clear-primary) * 2 + 3cqmin); }
.al-sponsors-title { font-family: var(--f-display); font-weight: 700; font-size: 1.5cqmin; letter-spacing: 0.15em; text-transform: uppercase; color: var(--c-accent-deep); line-height: 1; text-align: right; }
.al-sponsor-row { flex: 1; min-height: 0; justify-content: flex-end; }
#poster.d-sp-ge-4 { --foot-h: 18cqh; }
#poster.d-sp-ge-4 .al-foot { flex-direction: column; align-items: stretch; justify-content: center; gap: calc(var(--logo-h) * var(--clear-primary) + 1.2cqmin); padding: 2cqmin 0 1.8cqmin; }
#poster.d-sp-ge-4 .al-sponsors { padding: 0; }
#poster.d-sp-ge-4 .al-sponsors-title { text-align: left; }
#poster.d-sp-ge-4 .al-sponsor-row { justify-content: flex-start; flex: none; height: var(--partner-h, 6.4cqmin); }
/* The foot takes what the logos and partners need; the words take the rest. */
#poster.d-sp-ge-4 .al-foot { height: auto; }
#poster.d-sp-ge-4 .al-sponsors { height: auto; flex: none; }
#poster[data-format="square"].d-sp-ge-4, #poster[data-format="landscape"].d-sp-ge-4 { --partner-h: 5.4cqmin; }

#poster[data-format="square"] { --foot-h: 14cqh; --badge: 16cqmin; --logo-h: 6.6cqmin; }
#poster[data-format="story"] { --foot-h: 10cqh; --m: 7cqmin; --badge: 21cqmin; --logo-h: 7.8cqmin; }
#poster[data-format="story"].d-sp-ge-4 { --foot-h: 14cqh; }

/* Landscape: art on the right with the curve turned sideways; words on the left. */
#poster[data-format="landscape"] { --foot-h: 16cqh; --m: 5cqmin; --badge: 16cqmin; --logo-h: 6.8cqmin; }
#poster[data-format="landscape"] .al-col { display: grid; grid-template-columns: 1fr calc(var(--p-minArt) * 100cqw + 6cqw); grid-template-rows: 1fr auto; }
#poster[data-format="landscape"] .al-top {
  grid-column: 2; grid-row: 1; min-height: 0;
  -webkit-mask-image: radial-gradient(calc(var(--dip) * 2 + 40px) 150% at 0% 50%, transparent calc(100% - 1px), #000 100%);
  mask-image: radial-gradient(calc(var(--dip) * 2 + 40px) 150% at 0% 50%, transparent calc(100% - 1px), #000 100%);
}
#poster[data-format="landscape"] .al-copy { grid-column: 1; grid-row: 1; justify-content: center; padding: 4cqh 3cqw 4cqh var(--m); }
#poster[data-format="landscape"] .al-foot { grid-column: 1 / 3; grid-row: 2; }
#poster[data-format="landscape"] .al-badge { top: auto; bottom: calc(var(--foot-h) + 5cqh); right: calc(var(--p-minArt) * 100cqw + 6cqw - var(--badge) * 0.5 - var(--dip)); }

#poster[data-format="a4"], #poster[data-format="a3"] { --m: 7cqmin; --foot-h: 12cqh; }
`
};
