import type { DesignTemplate } from '../types';

/**
 * "Hero photo": the activity photo fills the poster and sinks into a deep brand-colour fade where
 * the words sit. Logos live on a clean tab at the top; a round date badge crosses from the photo
 * into the sponsor band, tying the two together.
 */
export const heroPhoto: DesignTemplate = {
  id: 'hero-photo',
  version: 1,
  name: 'Hero photo',
  description:
    'One strong photo of people in action fills the poster and fades into deep brand colour where the headline sits. Logos on a clean top tab, an optional date badge crossing into a white sponsor band. Best for events and campaigns with a great photo.',
  tags: ['photo-led', 'event', 'campaign', 'bold headline', 'sponsors'],
  formats: ['portrait', 'square', 'story', 'landscape', 'a4', 'a3'],
  fields: [
    { name: 'eyebrow', max: 40 },
    { name: 'headline', required: true, max: 60 },
    { name: 'subhead', max: 130 },
    { name: 'details' },
    { name: 'cta', max: 50 },
    { name: 'badge' },
    { name: 'sponsorsTitle', max: 30 }
  ],
  photos: { min: 1, max: 1 },
  sponsors: { min: 0, max: 8 },
  background: 'none',
  params: [
    { key: 'shade', label: 'Depth of the colour fade', type: 'number', min: 0.55, max: 0.95, default: 0.82, step: 0.05 },
    { key: 'focusY', label: 'Where the photo’s subject sits (top to bottom)', type: 'number', min: 0.25, max: 0.55, default: 0.36, step: 0.01 },
    { key: 'badge', label: 'Show the date badge', type: 'toggle', default: true },
    { key: 'accent', label: 'Accent colour', type: 'color', default: 'accent' }
  ],
  html: `
<div class="hp-photo d-fill t-unify" data-photo="1" data-focus-y="param:focusY"></div>
<div class="hp-fade"></div>
<div class="hp-topfade"></div>
<div class="d-grain"></div>
<div class="hp-tab">
  <div class="hp-logo" data-logo="primary" data-surface="light"></div>
  <div class="hp-campaign" data-logo="campaign" data-surface="light"></div>
</div>
<div class="hp-copy" data-fit-box data-measure="copy">
  <div class="hp-eyebrow-row" data-if="eyebrow">
    <span class="hp-rule"></span>
    <p class="hp-eyebrow" data-field="eyebrow" data-case="upper" data-fit data-min="1.9" data-max="2.5" data-lines="1" data-fit-order="4"></p>
  </div>
  <h1 class="hp-headline d-balance" data-field="headline" data-fit data-min="5" data-max="12" data-lines="4" data-fit-order="1"></h1>
  <p class="hp-subhead d-pretty" data-field="subhead" data-fit data-min="2.5" data-max="3.5" data-lines="3" data-fit-order="2"></p>
  <div class="hp-details" data-details>
    <template><div class="d-detail hp-detail"><span data-detail-icon></span><span data-detail-text></span></div></template>
  </div>
  <p class="hp-cta" data-field="cta"></p>
</div>
<div class="hp-badge d-shadow" data-badge data-if="param:badge">
  <span class="hp-badge-top" data-badge-top></span>
  <span class="hp-badge-main" data-badge-main></span>
  <span class="hp-badge-bottom" data-badge-bottom></span>
</div>
<div class="hp-band" data-if="sponsors">
  <div class="hp-sponsors" data-sponsors data-rows="2">
    <p class="hp-sponsors-title" data-field="sponsorsTitle"></p>
    <div class="hp-sponsor-row d-sponsor-row" data-sponsor-row></div>
  </div>
</div>
`,
  css: `
#poster {
  --m: 6.5cqmin;                       /* outer margin */
  --band-h: 15cqh;                     /* sponsor band */
  --logo-h: 7.6cqmin;
  --badge: 19cqmin;
  --copy-t: 30cqh;                     /* highest the words may reach */
  --copy-r: calc(var(--m) * 1.2);
  --copy-b: calc(var(--band-h) + var(--m) * 0.9);
  background: var(--c-primary-deep);
}
.hp-photo { z-index: 0; }
/* The photo sinks into deep brand colour exactly behind the words (--copy-top is where the words
   really start, measured after the type is fitted): above, the photo stays clean. */
.hp-fade {
  position: absolute; inset: 0; z-index: 1; pointer-events: none;
  background: linear-gradient(180deg,
    rgb(var(--c-primary-deep-rgb) / 0) calc(var(--copy-top, 50cqh) - 24cqh),
    rgb(var(--c-primary-deep-rgb) / calc(var(--p-shade) * 0.62)) calc(var(--copy-top, 50cqh) - 6cqh),
    rgb(var(--c-primary-deep-rgb) / var(--p-shade)) calc(var(--copy-top, 50cqh) + 6cqh),
    rgb(var(--c-primary-deep-rgb) / 0.96) 100%);
}
.hp-photo::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, rgb(var(--c-primary-rgb) / 0) calc(var(--copy-top, 50cqh) - 30cqh), rgb(var(--c-primary-rgb) / 0.6) 100%);
  mix-blend-mode: multiply;
}
.hp-topfade {
  position: absolute; left: 0; right: 0; top: 0; height: 24cqh; z-index: 1; pointer-events: none;
  background: linear-gradient(180deg, rgb(var(--c-ink-rgb) / 0.3), rgb(var(--c-ink-rgb) / 0));
}
.d-grain { z-index: 2; opacity: 0.1; }

/* Logo tab: hangs from the top edge, padded by more than the logos' clear space, with an accent
   edge that echoes the band and the badge. */
.hp-tab {
  position: absolute; z-index: 5; left: var(--m); top: 0;
  display: flex; align-items: center;
  gap: calc(var(--logo-h) * max(var(--clear-primary), var(--clear-campaign)) * 2.4);
  padding: calc(var(--logo-h) * var(--clear-primary) * 1.7) calc(var(--logo-h) * var(--clear-primary) * 1.45) calc(var(--logo-h) * var(--clear-primary) * 1.45);
  background: var(--c-paper);
  border-bottom: 0.65cqmin solid var(--p-accent);
  border-radius: 0 0 0.45cqmin 0.45cqmin;
  box-shadow: var(--shadow-soft);
}
.hp-logo { height: var(--logo-h); }
.hp-campaign { height: calc(var(--logo-h) * 0.92); }

.hp-copy {
  position: absolute; z-index: 4;
  left: var(--m); right: var(--copy-r); top: var(--copy-t); bottom: var(--copy-b);
  display: flex; flex-direction: column; gap: 2cqmin;
  overflow: hidden;
  color: var(--c-paper);
}
.hp-copy > :first-child { margin-top: auto; }
/* No band: the words go down to the margin. With a badge, the words never run under it: with a
   band they stop above it, without one they keep clear of its column. */
#poster:not(:has(.hp-band)) { --copy-b: calc(var(--m) * 1.1); }
#poster:has(.hp-badge):has(.hp-band) { --copy-b: calc(var(--band-h) + var(--badge) * 0.58 + 2.6cqmin); }
#poster:has(.hp-badge):not(:has(.hp-band)) { --copy-r: calc(var(--m) + var(--badge) + 3cqmin); }

.hp-eyebrow-row { display: flex; align-items: center; gap: 1.6cqmin; }
.hp-rule { flex: none; width: 6cqmin; height: 0.55cqmin; background: var(--p-accent); border-radius: 1cqmin; }
.hp-eyebrow {
  font-family: var(--f-display); font-weight: 700; letter-spacing: 0.14em; font-stretch: 100%;
  color: var(--p-accent); white-space: nowrap; line-height: 1.1;
}
.hp-headline {
  font-family: var(--f-display); font-weight: 800; font-stretch: 78%;
  line-height: 0.94; letter-spacing: -0.012em; color: var(--c-paper);
  text-shadow: 0 0.2cqmin 1.6cqmin rgb(var(--c-primary-deep-rgb) / 0.35);
}
.hp-subhead {
  font-family: var(--f-text); font-weight: 400; line-height: 1.32;
  color: rgb(255 255 255 / 0.92); max-width: 34em;
}
.hp-details { display: flex; flex-wrap: wrap; column-gap: 4cqmin; row-gap: 1.1cqmin; margin-top: 0.4cqmin; }
.hp-detail {
  font-family: var(--f-display); font-weight: 600; font-stretch: 92%;
  font-size: 2.55cqmin; line-height: 1.2; color: var(--c-paper);
}
.hp-detail svg { color: var(--p-accent); }
.hp-cta {
  align-self: flex-start; margin-top: 0.8cqmin;
  font-family: var(--f-display); font-weight: 800; font-stretch: 85%; letter-spacing: 0.02em;
  font-size: 2.6cqmin; line-height: 1; text-transform: uppercase;
  color: var(--on-accent); background: var(--p-accent);
  padding: 1.5cqmin 2.6cqmin 1.45cqmin; border-radius: 0.6cqmin;
}

/* Date badge: crosses from the photo into the sponsor band. */
.hp-badge {
  position: absolute; z-index: 6;
  right: var(--m); bottom: calc(var(--band-h) - var(--badge) * 0.42);
  width: var(--badge); height: var(--badge); border-radius: 50%;
  background: var(--p-accent); color: var(--c-primary-deep);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-family: var(--f-display); text-align: center; line-height: 1;
  outline: 0.75cqmin solid var(--c-paper); outline-offset: -0.05cqmin;
}
#poster:not(:has(.hp-band)) .hp-badge { bottom: calc(var(--m) * 1.1); }
.hp-badge-top { font-weight: 700; font-size: calc(var(--badge) * 0.13); letter-spacing: 0.14em; text-transform: uppercase; }
.hp-badge-main { font-weight: 800; font-size: calc(var(--badge) * 0.4); font-stretch: 80%; margin: 0.3cqmin 0 0.1cqmin; }
.hp-badge-bottom { font-weight: 700; font-size: calc(var(--badge) * 0.13); letter-spacing: 0.14em; text-transform: uppercase; }

/* Sponsor band. */
.hp-band {
  position: absolute; z-index: 3; left: 0; right: 0; bottom: 0; height: var(--band-h);
  background: var(--c-paper);
  display: flex; align-items: center;
  padding: 0 var(--m);
}
.hp-band::before {
  content: ''; position: absolute; left: 0; right: 0; top: 0; height: 0.7cqmin; background: var(--p-accent);
}
.hp-sponsors { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 1.2cqmin; padding: 2.2cqmin 0 2.4cqmin; min-width: 0; }
#poster:has(.hp-badge) .hp-sponsors { padding-right: calc(var(--badge) + 3cqmin); }
.hp-sponsors-title {
  font-family: var(--f-display); font-weight: 700; font-size: 1.65cqmin; letter-spacing: 0.16em;
  text-transform: uppercase; color: var(--c-primary); line-height: 1;
}
.hp-sponsor-row { flex: 1; min-height: 0; justify-content: flex-start; }

/* Square: a slimmer band and badge. */
#poster[data-format="square"] { --band-h: 14.5cqh; --badge: 17cqmin; --logo-h: 7cqmin; --copy-t: 26cqh; }

/* Story: more air, the words lower. */
#poster[data-format="story"] { --band-h: 11cqh; --m: 7.5cqmin; --badge: 21cqmin; --logo-h: 8.4cqmin; --copy-t: 40cqh; }
#poster[data-format="story"] .hp-copy { gap: 2.4cqmin; }

/* Landscape: the photo on the right; the fade comes from the left behind the words. */
#poster[data-format="landscape"] { --band-h: 17cqh; --m: 5.5cqmin; --badge: 17cqmin; --logo-h: 7.4cqmin; --copy-t: 20cqh; --copy-r: 47cqw; }
#poster[data-format="landscape"]:has(.hp-badge):has(.hp-band) { --copy-b: calc(var(--band-h) + var(--m) * 0.9); }
#poster[data-format="landscape"] .hp-photo { left: 24cqw; }
#poster[data-format="landscape"] .hp-fade {
  background: linear-gradient(90deg,
    rgb(var(--c-primary-deep-rgb) / 0.97) 0, rgb(var(--c-primary-deep-rgb) / 0.97) 24cqw,
    rgb(var(--c-primary-deep-rgb) / var(--p-shade)) calc(var(--copy-right, 52cqw) + 2cqw),
    rgb(var(--c-primary-deep-rgb) / 0) calc(var(--copy-right, 52cqw) + 22cqw));
}
#poster[data-format="landscape"] .hp-photo::after {
  background: linear-gradient(90deg, rgb(var(--c-primary-rgb) / 0.6) 0%, rgb(var(--c-primary-rgb) / 0) 55%);
}
#poster[data-format="landscape"] .hp-topfade { display: none; }

/* Print: a little more margin for trimming. */
#poster[data-format="a4"], #poster[data-format="a3"] { --m: 7.5cqmin; --band-h: 13.5cqh; }
`
};
