# Design system spec

Values were **measured from the live app's computed styles** (not eyeballed) unless marked ≈ (sampled by eye). The source is Mantine-based;
that is why spacing/breakpoints are Mantine's (`xs 10 / sm 12 / md 16 / lg 20 / xl 32`, breakpoints `36 / 48 / 62 / 75 / 88 em`).

## 1. Principles (what makes it look like *this*)
1. **Two-surface depth.** Shell (sidebar, modal aside) is one step lighter than the content panel. Cards/inputs sit one step *above* the panel. No heavy shadows — separation is by 1px borders and surface steps.
2. **Small, calm type.** The UI is 13px. Only the hero headline is large (25px). Everything else is 11–14px, medium/semibold weight, muted greys for secondary text.
3. **Soft geometry.** 6px nav, 8px controls, 10px cards, 12px panel, 16px modal, full-round for chips/FABs.
4. **Colour is rare and meaningful.** Neutrals everywhere; colour appears only as (a) the section accent badge + faint "sky" tint, (b) status dots, (c) destructive actions.
5. **Primary = inverted neutral.** Dark mode: near-white button with black text. Light mode: near-black button with white text.
6. **The panel scrolls, the page doesn't.** Main content is a fixed rounded panel with internal scroll.

## 2. Tokens (see `css/tokens.css`)

### Surfaces & text — semantic (use these, never raw hex, in components)
| Token | Dark | Light |
|---|---|---|
| `--bg-shell` (body, sidebar, modal aside) | `#242424` | `#f4f3f1` |
| `--bg-panel` (main panel, modal body) | `#141414` | `#ffffff` |
| `--bg-raised` (inputs, tiles, cards) | `#2e2e2e` | `#ffffff` |
| `--bg-hover` | `#3b3b3b` | `#efedea` |
| `--border` (all 1px lines) | `#3b3b3b` | `#efedea` |
| `--text` / `--text-strong` | `#c9c9c9` / `#fff` | `#000` / `#18181b` |
| `--text-muted` (descriptions, table heads) | `#b8b8b8` | `#8c806d` |
| `--text-subtle` (section labels) | `#828282` | `#8c806d` |
| `--text-nav` (idle nav) | `#b8b8b8` | `#51483d` |
| `--primary-bg` / `--primary-fg` | `#e9ecef` / `#000` (hover `#dee2e6`) | `#2e2e2e` / `#fff` |
| `--overlay` | `rgba(0,0,0,.2)` | same |

Raw palettes shipped: `dark-0…9`, `paper-0…9` (warm light neutrals), `gray`, `green`, `orange`, `blue`, `red` (each 0–9).
Status: success `green-6 #40c057` · warning `orange-6` · danger `red-8 #e03131` (text `red-6`). Danger-solid/warning-surface are ≈.

### Typography — system stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`)
| Role | Size / weight / line-height |
|---|---|
| Hero headline | 25 / 600 / 1.5 (21px under 768) |
| Hero sub-copy | 16 / 400 / 1.55 |
| Modal header | 14 / 500 |
| **UI default** (nav, buttons, inputs, rows, titles) | **13 / 400–600 / 1.55** |
| Description, table head, hints | 12 / 400 · muted |
| Section label | 11 / 500 · UPPERCASE · letter-spacing −0.01em |
| Mono chip | 11 / 500 · `ui-monospace` |
| Micro badge ("Coming soon") | 9 / 500 · uppercase |

### Spacing: `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48` (`--sp-1…12`) · Mantine names `xs10 sm12 md16 lg20 xl32`.
### Radii: `6 nav · 8 control/badge · 10 card · 12 panel/popover · 16 modal · 9999 chip/FAB/avatar`.
### Control height: **31px** (buttons + inputs). Nav row 30. Table head 37, row 52. Topbar 62.
### Motion: `.15s cubic-bezier(.4,0,.2,1)` for colour/background/border; buttons also `transform .15s`; modal `.2s` fade + 8px rise; respects `prefers-reduced-motion`.
### Z-index: app 100 · modal 200 · popover 300 · overlay 400 · max 9999.

## 3. Section accents
Each top-level section owns an accent used for: the hero icon badge (38×38, radius 8, deep tint bg + pale glyph) and a faint tint in the sky backdrop.

| Section | `data-accent` | Badge bg / glyph (dark) |
|---|---|---|
| Inbox | `green` | `#16451f` / `#ebfbee` |
| Planner | `blue` | `#1b2864` / `#edf2ff` |
| Bio pages | `purple` | `#43174e` / `#f8f0fc` |
| Studio | `wine` | `#530f27` / `#fff0f6` |
| Campaigns | `violet` | `#301f62` / `#f3f0ff` |
| Workflows | `amber` | `#6b2a0c` ≈ / `#fff4e6` ≈ |

Set on `<body data-accent="…">`. In light mode badge colours are *inverted* (inferred — verify against a light-mode hero if you need exactness).

## 4. Layout & responsive (the part that must not break)
| Viewport | Behaviour |
|---|---|
| **< 768px** | No sidebar. Panel inset **8px** all round, radius 12. **40px round hamburger FAB** bottom-left (20px inset, `#4c4c4c`) opens a **drawer** (~245px). Hero: headline 21px, **badge hidden**, centered, mascot smaller. Tables keep **first column only**. Modals are **full-screen**; tab list becomes a **3-column grid** at top (labels truncate); tile grid **2 columns**. Install pill hidden. List pages show a search FAB. |
| **768–991px** | Sidebar visible (**206px**), panel left = 206, inset 8px. Hero headline 25px, badge visible. Modals 2-column (230px aside). |
| **≥ 992px** | Sidebar **214px** (nav rows 190 + 12px gutters), panel inset **12px**. Editor inspector (350px) sits to the right of the canvas; below 992 it stacks under it. |
| ≥ 1200 / 1408 | Only grids add columns (cards 2→3, templates 4→5). No structural change. |

**Test matrix:** 320 · 360 · 390 · 430 (phones) · 768 · 820 · 1024 (tablets / small laptop) · 1280 · 1440 · 1920.
Use `components.html` and resize, or deep-link overlays with `?open=brand:channels`, `?open=settings:billing`, etc.

## 5. Components (class → measured spec)
- **`.btn`** 31h, radius 8, pad `0 12 0 8`, 13/600, gap 8. Variants `--primary --default --subtle --danger`, `--sm` (26h), `--icon`, `--block`, `--pill`. Press = `translateY(1px)`.
- **`.input / .textarea / .select`** 31h, bg raised, border `--border`, radius 8, pad `0 10.33`, 13px, focus border `blue-5`. **`.field`** = label 13/600 + desc 12 muted + control; required `*` in `red-6`.
- **`.nav-item`** 30h, pad `5 8 5 12`, gap 10, radius 6, 13/400 muted → active: white 13/**500**, **no background**. **`.nav-section`** 11px uppercase subtle.
- **`.chip`** 26h full-round, 12px, border; `.is-active` raised-hover; `.count` subtle. **`.segmented`** 24h segments in a 2px-padded raised track.
- **`.card`** raised, 1px border, radius 10 · **`.banner-card`** soft raised strip + illustration on the right · **`.tile`** channel picker 54h · **`.tcard`** template card (square thumb + meta, skeleton pulse) · **`.ecard`** workflow example · **`.plan`** pricing (tinted gradient, "Most popular" flag).
- **`.table`** head 37h 12/500 muted, rows 52h 13/500, hover `--bg-subtle`, bottom rule under head only. `.hide-sm` collapses columns on mobile.
- **`.modal`** content 1000×640, radius 16, aside 230px (`--bg-shell`, right border) + main (`--bg-panel`) with 44px header and bordered footer; sizes `--sm` 620, `--md` 780. Scrim `rgba(0,0,0,.2)`. Mobile = full-screen.
- **`.popover`** radius 10, border, shadow; `.popover--glass` = frosted (notifications). **`.install-pill`** bottom-centre, radius 14.
- **Editor:** `.canvas` dot grid 16px (`--canvas-dot`) · `.node` (type tag: trigger/flow/generate/destination colour-coded, selected = blue 1px ring) · `.link` 1px connector · `.add-dot` · `.inspector` tabs.
- **Hero:** `.hero` centered stack · `.hero__title` (badge + h1) · `.hero__sub` max 440 · `.hero__pill` ("watch the tour") · `.hero__art` bottom-anchored illustration · `.sky` backdrop.

## 6. Extending for a client (rules that prevent rework)
1. Re-skin **only** via `tokens.css`. If you catch yourself writing a hex in `components.css`, add a token instead.
2. Never add a breakpoint other than 48em / 62em. Need more room? Use the auto-fit grids.
3. New pages = one of four patterns: **hero**, **list (topbar + table)**, **gallery (composer + chips + grid)**, **editor (canvas + inspector)**.
4. New overlays go in `js/overlays.js` (`BP.modals`) and open with `data-open="id"` — never ad-hoc markup.
5. Always test each new page at 390 / 820 / 1440 in both themes before sign-off.
6. Keep one primary button per view; secondary actions use `.btn--default`.

## 7. Known approximations
- `--danger-solid`, `--warning-surface`, workflows accent and light-mode accent inversion were sampled by eye or inferred.
- Sidebar resize/collapse handle (thin grip on the sidebar's right edge) is **not** implemented.
- Icons are original look-alikes, not the source icon font; swap in your icon set via `BP.ICONS`.
