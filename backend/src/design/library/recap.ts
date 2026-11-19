import type { DesignTemplate } from '../types';

/**
 * "Recap": for after the event — thank-you and report-back posts with a group photo. The photo
 * runs the full width at its own proportions (as wide as it is, so a row of twenty volunteers is
 * never cropped through), under a slim brand bar with the club's logo. Below, on paper, the
 * headline, up to three impact figures in a row (only figures the club gave), a line of thanks,
 * and the partners in the white band.
 *
 * The photo band follows the photo's shape between a minimum and a maximum share of the poster;
 * the words take what's left. In landscape the photo takes the left side.
 */
export const recap: DesignTemplate = {
  id: 'recap',
  version: 1,
  name: 'Recap',
  description:
    'For after an event: thank-you and report-back posts. A group photo across the full width at its own proportions (wide photos of many people are never cropped through), a slim brand bar with the logo, then on white: the headline, up to three impact figures (only figures given in the request), a line of thanks, and the partners. Calm, documentary, trustworthy. Best with a wide photo of the team at the project.',
  tags: ['recap', 'thank you', 'report', 'group photo', 'impact figures', 'sponsors', 'after the event'],
  formats: ['portrait', 'square', 'story', 'landscape', 'a4', 'a3'],
  fields: [
    { name: 'eyebrow', max: 40 },
    { name: 'headline', required: true, max: 56 },
    { name: 'stats' },
    { name: 'subhead', max: 150 },
    { name: 'cta', max: 34 },
    { name: 'hashtag', max: 30 },
    { name: 'sponsorsTitle', max: 30 }
  ],
  photos: { min: 1, max: 1 },
  sponsors: { min: 0, max: 9 },
  background: 'none',
  params: [
    { key: 'bar', label: 'Colour of the top bar', type: 'color', default: 'primary' },
    { key: 'figure', label: 'Colour of the figures and headline', type: 'color', default: 'primary' },
    { key: 'accent', label: 'Accent colour (rule and label)', type: 'color', default: 'accent' },
    { key: 'maxPhoto', label: 'Largest share of the poster for the photo', type: 'number', min: 0.3, max: 0.56, default: 0.44, step: 0.01, roomy: 'min' },
    { key: 'focusY', label: 'Where the group sits in the photo (top to bottom)', type: 'number', min: 0.3, max: 0.7, default: 0.5, step: 0.01 }
  ],
  html: `
<div class="rc-col">
  <header class="rc-bar">
    <div class="rc-logo" data-logo="primary" data-surface="dark"></div>
    <div class="rc-campaign" data-logo="campaign" data-surface="dark"></div>
    <p class="rc-hashtag" data-field="hashtag"></p>
  </header>
  <div class="rc-photo t-unify" data-photo="1" data-focus-y="param:focusY" data-measure="photo"></div>
  <main class="rc-copy" data-fit-box>
    <p class="rc-eyebrow" data-field="eyebrow" data-case="upper" data-fit data-min="1.8" data-max="2.3" data-lines="1" data-fit-order="4"></p>
    <h1 class="rc-headline d-balance" data-field="headline" data-fit data-min="4.7" data-max="7.6" data-lines="3" data-fit-order="1"></h1>
    <div class="rc-stats" data-stats>
      <template><div class="rc-stat"><b class="rc-stat-value" data-stat-value data-fit data-fit-group="figures" data-min="5" data-max="9" data-lines="1" data-fit-order="2"></b><span class="rc-stat-label" data-stat-label></span></div></template>
    </div>
    <p class="rc-subhead d-pretty" data-field="subhead" data-fit data-min="2.25" data-max="3" data-lines="3" data-fit-order="3"></p>
    <p class="rc-cta" data-field="cta"></p>
  </main>
  <footer class="rc-band" data-if="sponsors">
    <div class="rc-sponsors" data-sponsors data-rows="2">
      <p class="rc-sponsors-title" data-field="sponsorsTitle"></p>
      <div class="rc-sponsor-row d-sponsor-row" data-sponsor-row></div>
    </div>
  </footer>
</div>
<div class="d-grain"></div>
`,
  css: `
#poster {
  --m: 6.2cqmin;
  --bar-h: 10.5cqh;
  --logo-h: 6.2cqmin;
  --band-h: 13cqh;
  --ar: var(--photo-1-ar, 1.5);
  --photo-min: 26cqh;
  --photo-max: max(var(--photo-min), calc(var(--p-maxPhoto) * 100cqh));
  background: var(--c-paper);
  color: var(--c-ink);
}
.rc-col { position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden; z-index: 1; }

/* The slim brand bar: the club's logo (its white version where it needs it), campaign logos, tag. */
.rc-bar {
  flex: none; height: var(--bar-h); background: var(--p-bar); color: var(--p-bar-on);
  display: flex; align-items: center; gap: calc(var(--logo-h) * 0.7); padding: 0 var(--m);
}
.rc-logo { height: var(--logo-h); }
.rc-campaign { height: calc(var(--logo-h) * 0.92); }
.rc-hashtag { margin-left: auto; font-family: var(--f-display); font-weight: 700; font-size: 2.2cqmin; letter-spacing: 0.02em; color: var(--p-accent-on-bar); white-space: nowrap; }

/* The photo, as wide as it is: its height follows its proportions between the limits. */
.rc-photo {
  position: relative; flex: none;
  height: clamp(var(--photo-min), calc(100cqw / var(--ar)), var(--photo-max));
}
/* A fine accent rule where photo and paper meet. */
.rc-photo::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 0.8cqmin; background: var(--p-accent); z-index: 2; }

.rc-copy {
  flex: 1 1 auto; min-height: 0; overflow: hidden;
  display: flex; flex-direction: column; justify-content: center; gap: 2.2cqmin;
  padding: 4.4cqmin var(--m) 3.6cqmin;
}
.rc-eyebrow { font-family: var(--f-display); font-weight: 700; letter-spacing: 0.14em; line-height: 1.1; color: var(--p-accent-on-paper); }
.rc-headline { font-family: var(--f-display); font-weight: 800; font-stretch: 82%; line-height: 0.98; letter-spacing: -0.01em; color: var(--p-figure-on-paper); }
.rc-headline em { font-style: normal; color: var(--p-accent-on-paper); }
.rc-subhead { font-family: var(--f-text); line-height: 1.38; color: var(--c-ink); opacity: 0.88; max-width: 34em; }
.rc-cta { align-self: flex-start; font-family: var(--f-display); font-weight: 800; font-size: 2.3cqmin; letter-spacing: 0.06em; text-transform: uppercase; color: var(--p-figure-on-paper);
  padding-bottom: 0.5cqmin; border-bottom: 0.45cqmin solid var(--p-accent); line-height: 1.1; }

/* Impact figures: in a row, separated by fine rules. */
.rc-stats { display: grid; grid-template-columns: repeat(var(--n, 3), minmax(0, 1fr)); margin: 0.6cqmin 0 0.4cqmin; }
#poster[data-stat-count="1"] .rc-stats { --n: 1; }
#poster[data-stat-count="2"] .rc-stats { --n: 2; }
.rc-stat { display: flex; flex-direction: column; gap: 0.6cqmin; padding: 0.4cqmin 3cqmin 0.4cqmin 0; min-width: 0; }
.rc-stat + .rc-stat { padding-left: 3cqmin; border-left: 0.25cqmin solid rgb(var(--c-ink-rgb) / 0.16); }
.rc-stat-value { font-family: var(--f-display); font-weight: 800; font-stretch: 80%; line-height: 0.92; letter-spacing: -0.015em; color: var(--p-figure-on-paper); white-space: nowrap; }
.rc-stat-label { font-family: var(--f-display); font-weight: 600; font-size: 2.3cqmin; line-height: 1.2; color: var(--c-ink); opacity: 0.8; }

/* Partners in the white band, under a fine rule. */
.rc-band { flex: none; min-height: var(--band-h); display: flex; align-items: stretch; padding: 0 var(--m) 2.2cqmin; }
.rc-sponsors { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1.2cqmin; padding-top: 2cqmin; border-top: 0.25cqmin solid rgb(var(--c-ink-rgb) / 0.14); }
.rc-sponsors-title { font-family: var(--f-display); font-weight: 700; font-size: 1.55cqmin; letter-spacing: 0.15em; text-transform: uppercase; color: var(--p-accent-on-paper); line-height: 1; }
.rc-sponsor-row { flex: none; height: 6.6cqmin; justify-content: space-between; }
#poster[data-sponsor-count="1"] .rc-sponsor-row, #poster[data-sponsor-count="2"] .rc-sponsor-row, #poster[data-sponsor-count="3"] .rc-sponsor-row { justify-content: flex-start; gap: 7cqmin; }
.d-grain { z-index: 3; opacity: 0.06; }

/* Square: a shorter photo band, the figures a little smaller. */
#poster[data-format="square"] { --bar-h: 10cqh; --logo-h: 6.2cqmin; --photo-min: 26cqh; --photo-max: max(var(--photo-min), calc(var(--p-maxPhoto) * 84cqh)); }
#poster[data-format="square"] .rc-copy { gap: 1.6cqmin; padding-top: 3.4cqmin; padding-bottom: 2.6cqmin; }
#poster[data-format="square"] .rc-sponsor-row { height: 5.6cqmin; }
#poster[data-format="square"] .rc-band { min-height: 11cqh; padding-bottom: 1.8cqmin; }

/* Story: more room for the photo, figures stacked larger. */
#poster[data-format="story"] { --m: 7cqmin; --bar-h: 8cqh; --logo-h: 7cqmin; --photo-min: 30cqh; --photo-max: max(var(--photo-min), calc(var(--p-maxPhoto) * 100cqh)); --band-h: 10cqh; }
#poster[data-format="story"] .rc-copy { gap: 3cqmin; }
/* Story: the figures stacked, numbers in a column as wide as the widest, labels right beside. */
#poster[data-format="story"] .rc-stats { grid-template-columns: max-content 1fr; column-gap: 3.4cqmin; row-gap: 2.2cqmin; align-items: baseline; }
#poster[data-format="story"] .rc-stat { display: contents; }
#poster[data-format="story"] .rc-stat + .rc-stat { border-left: 0; }
#poster[data-format="story"] .rc-stat-label { font-size: 3cqmin; }

/* Landscape: the photo on the left, full height under the bar; words on the right. */
#poster[data-format="landscape"] { --bar-h: 11.5cqh; --logo-h: 6.2cqmin; }
#poster[data-format="landscape"] .rc-col { display: grid; grid-template-columns: 52cqw 1fr; grid-template-rows: var(--bar-h) 1fr auto; }
#poster[data-format="landscape"] .rc-bar { grid-column: 1 / 3; grid-row: 1; }
#poster[data-format="landscape"] .rc-photo { grid-column: 1; grid-row: 2 / 4; height: auto; }
#poster[data-format="landscape"] .rc-photo::after { left: auto; top: 0; width: 0.8cqmin; height: auto; }
#poster[data-format="landscape"] .rc-copy { grid-column: 2; grid-row: 2; padding: 3.6cqmin var(--m) 2cqmin 5cqmin; gap: 1.6cqmin; }
#poster[data-format="landscape"] .rc-band { grid-column: 2; grid-row: 3; padding: 0 var(--m) 2cqmin 5cqmin; min-height: 0; }
#poster[data-format="landscape"] .rc-stat-label { font-size: 1.9cqmin; }
#poster[data-format="landscape"] .rc-sponsor-row { height: 5cqmin; }

#poster[data-format="a4"], #poster[data-format="a3"] { --m: 7cqmin; --bar-h: 9cqh; --band-h: 11cqh; }
`
};
