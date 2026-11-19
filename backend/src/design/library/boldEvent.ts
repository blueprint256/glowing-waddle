import type { DesignTemplate } from '../types';

/**
 * "Bold event": for nights out, games, fundraisers and launches. The event's name runs across the
 * top in huge condensed capitals; the featured person (cut out) stands in front of its lower edge,
 * as event posters in the region do, which ties the words and the person into one picture. The
 * left keeps a tagline, a big date block (day number, weekday in the accent, month) and the venue
 * in a pill. Without a cut-out the photo sits in a ringed circle; without a photo the date grows.
 */
export const boldEvent: DesignTemplate = {
  id: 'bold-event',
  version: 1,
  name: 'Bold event',
  description:
    'For fun and social events (game nights, dinners, fundraisers, launches): the event’s name across the top in huge condensed capitals, the featured person cut out standing in front of its lower edge (or a ringed circle photo), a tagline, a big date block and the venue in a pill on the left. Saturated brand-colour ground. Works without a photo too.',
  tags: ['event', 'social', 'fun', 'bold headline', 'cut-out', 'sponsors'],
  formats: ['portrait', 'square', 'story', 'a4', 'a3'],
  fields: [
    { name: 'headline', required: true, max: 22 },
    { name: 'subhead', max: 46 },
    { name: 'badge' },
    { name: 'details' },
    { name: 'cta', max: 24 },
    { name: 'hashtag', max: 26 },
    { name: 'social', max: 30 },
    { name: 'web', max: 30 },
    { name: 'sponsorsTitle', max: 24 }
  ],
  photos: { min: 0, max: 1 },
  cutout: 'preferred',
  sponsors: { min: 0, max: 9 },
  background: 'none',
  params: [
    { key: 'ground', label: 'Background colour', type: 'color', default: 'secondary' },
    { key: 'accent', label: 'Accent colour', type: 'color', default: 'accent' },
    { key: 'overlap', label: 'How far the person stands in front of the headline', type: 'number', min: 0.15, max: 0.45, default: 0.32, step: 0.01, roomy: 'min' }
  ],
  html: `
<div class="be-ground"></div>
<div class="be-light"></div>
<div class="d-grain"></div>

<header class="be-head">
  <div class="be-logo" data-logo="primary" data-surface="dark"></div>
  <span class="be-divider" data-if="campaign"></span>
  <div class="be-campaign" data-logo="campaign" data-surface="dark"></div>
</header>

<div class="be-title" data-fit-box data-person-ok="0.34">
  <h1 class="be-headline" data-measure="title" data-field="headline" data-case="upper" data-fit data-min="9" data-max="24" data-lines="2" data-fit-order="1"></h1>
</div>

<div class="be-person" data-cutout="1" data-stand data-focus-x="0.5" data-max-w="1.05"></div>
<div class="be-circle-wrap" data-if="photos & !cutout">
  <div class="be-circle t-unify" data-photo="1" data-focus-y="0.4"></div>
</div>

<main class="be-info" data-fit-box data-measure="info">
  <p class="be-tagline" data-field="subhead" data-fit data-min="3" data-max="4.6" data-lines="3" data-fit-order="3"></p>
  <div class="be-date" data-badge>
    <span class="be-date-icon" data-icon="date"></span>
    <span class="be-date-main" data-badge-main></span>
    <span class="be-date-top" data-badge-top></span>
    <span class="be-date-bottom" data-badge-bottom></span>
  </div>
  <div class="be-details" data-details>
    <template><div class="d-detail be-detail"><span data-detail-icon></span><span data-detail-text></span></div></template>
  </div>
  <p class="be-cta" data-field="cta"></p>
</main>

<div class="be-contact" data-if="contact|hashtag">
  <p class="be-hashtag" data-field="hashtag"></p>
  <p class="be-contact-line" data-if="social"><span data-icon="at"></span><span data-field="social"></span></p>
  <p class="be-contact-line" data-if="web"><span data-icon="web"></span><span data-field="web"></span></p>
</div>

<footer class="be-band" data-if="sponsors">
  <div class="be-sponsors" data-sponsors data-rows="1">
    <div class="be-sponsor-row d-sponsor-row" data-sponsor-row></div>
  </div>
</footer>
`,
  css: `
#poster {
  --m: 6cqmin;
  --logo-h: 8cqmin;
  --band-h: 11.5cqh;
  --floor: var(--band-h);
  --info-w: 42cqw;
  --g: var(--p-ground);
  --g-deep: color-mix(in oklab, var(--g), #000 42%);
  --g-lit: color-mix(in oklab, var(--g), #fff 14%);
  background: var(--g-deep);
  color: var(--c-paper);
}
#poster:not(:has(.be-band)) { --floor: 0px; }
#poster { --circle: 50cqmin; }
/* With the circle photo, the words' column stops short of it. */
#poster:has(.be-circle-wrap) { --info-w: calc(100cqw - var(--m) * 2 - var(--circle) - 3cqmin); }

/* A saturated ground lit from behind the person, with soft diagonal light. */
.be-ground { position: absolute; inset: 0; z-index: 0;
  background:
    radial-gradient(70cqmax 60cqmax at 64% 52%, var(--g-lit) 0%, var(--g) 34%, var(--g-deep) 86%),
    var(--g-deep); }
.be-light { position: absolute; inset: 0; z-index: 1; pointer-events: none; opacity: 0.5; mix-blend-mode: soft-light;
  background: repeating-linear-gradient(115deg, rgb(255 255 255 / 0) 0 9cqmin, rgb(255 255 255 / 0.16) 9cqmin 9.6cqmin, rgb(255 255 255 / 0) 9.6cqmin 22cqmin); }
.d-grain { z-index: 2; opacity: 0.14; }

.be-head { position: absolute; z-index: 6; left: 0; right: 0; top: var(--m); height: var(--logo-h);
  display: flex; align-items: center; justify-content: center; gap: calc(var(--logo-h) * 0.5); }
.be-logo { height: var(--logo-h); }
.be-campaign { height: calc(var(--logo-h) * 0.96); }
.be-divider { width: 0.22cqmin; align-self: stretch; margin: 0.6cqmin 0; background: rgb(255 255 255 / 0.55); }

/* The name of the event, as big as two lines allow. */
.be-title { position: absolute; z-index: 3; left: var(--m); right: var(--m);
  top: calc(var(--m) + var(--logo-h) + 3.2cqh); height: 30cqh;
  display: flex; align-items: flex-start; justify-content: center; overflow: hidden; }
.be-headline { font-family: var(--f-display); font-weight: 800; font-stretch: 75%; line-height: 0.86; letter-spacing: -0.01em;
  text-align: center; color: var(--c-paper); text-shadow: 0 0.5cqmin 3cqmin rgb(0 0 0 / 0.25); }
.be-headline em { font-style: normal; color: var(--p-accent); }

/* The person stands in front of the lower part of the headline's last line (how far: the overlap
   setting, as a share of one line), so every letter stays readable: only their feet are covered. */
.be-person { position: absolute; z-index: 4; left: 30cqw; right: 0; bottom: var(--floor);
  top: calc(var(--title-bottom, 42cqh) - var(--title-h, 20cqh) * 0.5 * var(--p-overlap)); }
.be-person .d-cutout-img { filter: drop-shadow(0 2cqmin 3cqmin rgb(0 0 0 / 0.35)); }
/* No cut-out: the photo in a ringed circle. */
.be-circle-wrap { position: absolute; z-index: 4; right: var(--m); width: var(--circle); height: var(--circle);
  /* Clear of the headline: capitals set this tight overhang their line box a little. */
  top: calc(var(--title-bottom, 42cqh) + 3cqh + 2.5cqmin); border-radius: 50%; padding: 1.2cqmin;
  background: conic-gradient(from 210deg, var(--p-accent), color-mix(in oklab, var(--p-accent) 30%, transparent) 40%, var(--p-accent) 100%); box-shadow: 0 2cqmin 5cqmin rgb(0 0 0 / 0.3); }
.be-circle { width: 100%; height: 100%; border-radius: 50%; }

/* Left: the tagline, the date block, the venue. */
/* The block starts at the poster's edge (padded by the margin) so the venue pill can run off it. */
.be-info { position: absolute; z-index: 5; left: 0; padding-left: var(--m); width: calc(var(--info-w) + var(--m));
  top: calc(var(--title-bottom, 42cqh) + 3cqh); bottom: calc(var(--floor) + var(--m) + 5cqmin);
  display: flex; flex-direction: column; justify-content: flex-end; gap: 2.4cqmin; overflow: hidden; }
.be-info > * { flex: none; }
.be-tagline { font-family: var(--f-display); font-weight: 800; font-stretch: 90%; line-height: 1.08; color: var(--p-accent); margin-bottom: 1cqmin; }
.be-date { display: grid; grid-template-columns: auto auto; grid-template-rows: auto auto auto; column-gap: 1.6cqmin; align-items: center; justify-content: start; }
.be-date-icon { grid-row: 1; grid-column: 1; font-size: 6.2cqmin; color: var(--c-paper); }
.be-date-icon svg { stroke-width: 1.7; }
.be-date-main { grid-row: 1; grid-column: 2; font-family: var(--f-display); font-weight: 800; font-stretch: 85%; font-size: 7.6cqmin; line-height: 0.95; }
.be-date-top { grid-row: 2; grid-column: 1 / span 2; font-family: var(--f-display); font-weight: 800; font-stretch: 85%; font-size: 6cqmin; line-height: 0.95; text-transform: uppercase; color: var(--p-accent); }
.be-date-bottom { grid-row: 3; grid-column: 1 / span 2; font-family: var(--f-display); font-weight: 600; font-size: 3.8cqmin; line-height: 1.1; text-transform: uppercase; margin-top: 0.3cqmin; }
.be-details { display: flex; flex-direction: column; gap: 1.4cqmin; align-items: flex-start; }
.be-detail { font-family: var(--f-display); font-weight: 700; font-size: 2.6cqmin; line-height: 1.1; text-transform: uppercase; letter-spacing: 0.02em; }
.be-detail svg { color: var(--p-accent); }
/* The venue as a pill. */
.be-detail[data-key="detail-place"] { background: var(--p-accent); color: var(--p-accent-on); padding: 1.3cqmin 2.4cqmin 1.2cqmin 1.8cqmin; border-radius: 0 99cqmin 99cqmin 0; margin-left: calc(var(--m) * -1); padding-left: calc(var(--m) + 0.6cqmin); font-size: 3cqmin; }
.be-detail[data-key="detail-place"] svg { color: var(--p-accent-on); }
/* The date block already says the date. */
#poster:has(.be-date) .be-detail[data-key="detail-date"] { display: none; }
.be-cta { align-self: flex-start; font-family: var(--f-display); font-weight: 800; font-size: 2.4cqmin; letter-spacing: 0.06em; text-transform: uppercase; line-height: 1;
  padding: 1.4cqmin 2.4cqmin 1.3cqmin; border-radius: 99cqmin; border: 0.3cqmin solid var(--c-paper); }

.be-contact { position: absolute; z-index: 6; right: var(--m); bottom: calc(var(--floor) + var(--m) * 0.8); max-width: 50cqw;
  display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; column-gap: 2.6cqmin; row-gap: 0.8cqmin; }
.be-hashtag { font-family: var(--f-display); font-weight: 800; font-size: 2.1cqmin; color: var(--p-accent); }
.be-contact-line { display: flex; align-items: center; gap: 0.8cqmin; font-family: var(--f-display); font-weight: 600; font-size: 1.8cqmin; }
.be-contact-line .d-icon { color: var(--p-accent); }
/* With a person standing on the band, the handle moves to the left, under the venue. */
#poster:has(.be-person) .be-contact,
#poster[data-format="square"]:has(.be-circle-wrap) .be-contact { right: auto; left: var(--m); justify-content: flex-start; max-width: var(--info-w); }

.be-band { position: absolute; z-index: 7; left: 0; right: 0; bottom: 0; height: var(--band-h); background: var(--c-paper);
  display: flex; align-items: center; padding: 1.8cqmin var(--m); }
.be-sponsors { flex: 1; height: 100%; min-width: 0; display: flex; flex-direction: column; }
.be-sponsor-row { flex: 1; min-height: 0; min-width: 0; width: 100%; justify-content: space-between; }
#poster[data-sponsor-count="1"] .be-sponsor-row, #poster[data-sponsor-count="2"] .be-sponsor-row, #poster[data-sponsor-count="3"] .be-sponsor-row { justify-content: center; gap: 7cqmin; }

/* No photo: the date block grows and moves under the title, centred. */
#poster:not(:has(.be-person)):not(:has(.be-circle-wrap)) { --info-w: calc(100cqw - var(--m) * 2); }
#poster:not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-info { width: 100cqw; padding: 0 var(--m); justify-content: center; align-items: center; text-align: center; }
#poster:not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-date { justify-content: center; }
#poster:not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-details { align-items: center; }
#poster:not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-cta { align-self: center; }
#poster:not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-info { gap: 3.2cqmin; }
#poster:not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-detail[data-key="detail-place"] { margin-left: 0; padding-left: 2cqmin; border-radius: 99cqmin; }

/* A lot to say (tagline, call to action and two or more detail lines besides the date): the title
   gets less height and the date block tightens, so the left column never runs out of room. */
#poster:has(.be-tagline):has(.be-cta):has(.be-detail:not([data-key="detail-date"]) ~ .be-detail:not([data-key="detail-date"])) {
  --dense: 1;
}
#poster:has(.be-tagline):has(.be-cta):has(.be-detail:not([data-key="detail-date"]) ~ .be-detail:not([data-key="detail-date"])) .be-title { height: 22cqh; }
#poster:has(.be-tagline):has(.be-cta):has(.be-detail:not([data-key="detail-date"]) ~ .be-detail:not([data-key="detail-date"])) .be-info { gap: 1.6cqmin; }
#poster:has(.be-tagline):has(.be-cta):has(.be-detail:not([data-key="detail-date"]) ~ .be-detail:not([data-key="detail-date"])) .be-date-icon { font-size: 5cqmin; }
#poster:has(.be-tagline):has(.be-cta):has(.be-detail:not([data-key="detail-date"]) ~ .be-detail:not([data-key="detail-date"])) .be-date-main { font-size: 6cqmin; }
#poster:has(.be-tagline):has(.be-cta):has(.be-detail:not([data-key="detail-date"]) ~ .be-detail:not([data-key="detail-date"])) .be-date-top { font-size: 4.8cqmin; }
#poster:has(.be-tagline):has(.be-cta):has(.be-detail:not([data-key="detail-date"]) ~ .be-detail:not([data-key="detail-date"])) .be-date-bottom { font-size: 3.1cqmin; }
#poster:has(.be-tagline):has(.be-cta):has(.be-detail:not([data-key="detail-date"]) ~ .be-detail:not([data-key="detail-date"])) .be-detail { font-size: 2.3cqmin; }
#poster:has(.be-tagline):has(.be-cta):has(.be-detail:not([data-key="detail-date"]) ~ .be-detail:not([data-key="detail-date"])) .be-detail[data-key="detail-place"] { font-size: 2.6cqmin; padding-top: 1cqmin; padding-bottom: 0.9cqmin; }

#poster[data-format="square"] { --logo-h: 7.4cqmin; --band-h: 12cqh; }
/* Square with a lot to say: the date sets sideways, [icon] 14 SAT/DEC, and the circle shrinks. */
#poster[data-format="square"]:has(.be-tagline):has(.be-cta):has(.be-detail:not([data-key="detail-date"]) ~ .be-detail:not([data-key="detail-date"])) .be-title { height: 19cqh; }
#poster[data-format="square"]:has(.be-tagline):has(.be-cta):has(.be-detail:not([data-key="detail-date"]) ~ .be-detail:not([data-key="detail-date"])) .be-date { grid-template-columns: auto auto auto; grid-template-rows: auto auto; column-gap: 1.4cqmin; }
#poster[data-format="square"]:has(.be-tagline):has(.be-cta):has(.be-detail:not([data-key="detail-date"]) ~ .be-detail:not([data-key="detail-date"])) .be-date-icon { grid-row: 1 / span 2; grid-column: 1; }
#poster[data-format="square"]:has(.be-tagline):has(.be-cta):has(.be-detail:not([data-key="detail-date"]) ~ .be-detail:not([data-key="detail-date"])) .be-date-main { grid-row: 1 / span 2; grid-column: 2; font-size: 7cqmin; }
#poster[data-format="square"]:has(.be-tagline):has(.be-cta):has(.be-detail:not([data-key="detail-date"]) ~ .be-detail:not([data-key="detail-date"])) .be-date-top { grid-row: 1; grid-column: 3; font-size: 3.4cqmin; align-self: end; }
#poster[data-format="square"]:has(.be-tagline):has(.be-cta):has(.be-detail:not([data-key="detail-date"]) ~ .be-detail:not([data-key="detail-date"])) .be-date-bottom { grid-row: 2; grid-column: 3; font-size: 2.8cqmin; margin-top: 0; align-self: start; }
#poster[data-format="square"]:has(.be-tagline):has(.be-cta):has(.be-detail:not([data-key="detail-date"]) ~ .be-detail:not([data-key="detail-date"])) { --circle: 44cqmin; }
#poster[data-format="square"] .be-title { height: 28cqh; top: calc(var(--m) + var(--logo-h) + 2.2cqh); }
#poster[data-format="square"] .be-info { gap: 1.8cqmin; }
#poster[data-format="square"] .be-date-main { font-size: 6.6cqmin; }
#poster[data-format="square"] .be-date-top { font-size: 5.2cqmin; }
#poster[data-format="square"] .be-date-bottom { font-size: 3.3cqmin; }

#poster[data-format="story"] { --m: 7cqmin; --logo-h: 9cqmin; --band-h: 8.5cqh; }
#poster[data-format="story"] .be-title { top: calc(var(--m) + var(--logo-h) + 4cqh); height: 24cqh; }
/* Tall: the person stands in the right half, the words keep the left column. */
#poster[data-format="story"] { --info-w: 38cqw; }
#poster[data-format="story"] .be-person { left: 38cqw; right: -16cqw; }
#poster[data-format="story"] .be-info { gap: 3cqmin; }

#poster[data-format="a4"], #poster[data-format="a3"] { --m: 7.5cqmin; --band-h: 10cqh; }

/* No photo on a tall poster (story, print): the details have the whole width, so the date and details grow to
   fill the space the photo would have taken (#poster twice: this wins over the dense rules, as a
   poster without a photo has room for everything). */
#poster#poster:is([data-format="story"], [data-format="a4"], [data-format="a3"]):not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-info { gap: 2.8cqmin; }
#poster#poster:is([data-format="story"], [data-format="a4"], [data-format="a3"]):not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-date-icon { font-size: 7cqmin; }
#poster#poster:is([data-format="story"], [data-format="a4"], [data-format="a3"]):not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-date-main { font-size: 9cqmin; }
#poster#poster:is([data-format="story"], [data-format="a4"], [data-format="a3"]):not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-date-top { font-size: 7cqmin; }
#poster#poster:is([data-format="story"], [data-format="a4"], [data-format="a3"]):not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-date-bottom { font-size: 4.2cqmin; }
#poster#poster:is([data-format="story"], [data-format="a4"], [data-format="a3"]):not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-detail { font-size: 3cqmin; }
#poster#poster:is([data-format="story"], [data-format="a4"], [data-format="a3"]):not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-cta { font-size: 2.8cqmin; }
/* Story: much taller, so they grow further. */
#poster#poster[data-format="story"]:not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-info { gap: 3.6cqmin; }
#poster#poster[data-format="story"]:not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-date-icon { font-size: 8cqmin; }
#poster#poster[data-format="story"]:not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-date-main { font-size: 10.5cqmin; }
#poster#poster[data-format="story"]:not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-date-top { font-size: 8cqmin; }
#poster#poster[data-format="story"]:not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-date-bottom { font-size: 4.8cqmin; }
#poster#poster[data-format="story"]:not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-detail { font-size: 3.3cqmin; }
#poster#poster[data-format="story"]:not(:has(.be-person)):not(:has(.be-circle-wrap)) .be-cta { font-size: 3cqmin; }
`
};
