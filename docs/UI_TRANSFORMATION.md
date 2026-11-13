# UI transformation & optimization (Blueprint template)

This branch moves the frontend onto the **Blueprint** design language (dark "two-surface" theme with a warm
light "paper" theme) and trims first-load cost. Full token/pattern reference: [`DESIGN-SYSTEM.md`](./DESIGN-SYSTEM.md).

## What changed

| Area | Change |
|---|---|
| Tokens | `frontend/src/styles/tokens.css` is the single source of truth (colours, type, spacing, radii, layout). |
| MUI theme | `src/theme/index.ts` builds a dark/light MUI theme from the tokens: 13px UI type, 31px controls, Blueprint radii, bordered cards, dialogs on the panel surface, quiet tables/tabs/chips. Breakpoints now match the design system (**sm 576 / md 768 / lg 992 / xl 1200**). |
| Theme switching | `src/store/themeStore.ts` (Zustand) persists `bp-theme`, falls back to the OS preference, sets `<html data-theme>`; `index.html` applies it before first paint (no flash). Toggle is in the sidebar footer. |
| App shell | `DashboardLayout.tsx` rebuilt: inset rounded panel with internal scroll, 214px sidebar (≥768px) / drawer + floating button (<768px), per-section accent badges, user card with theme toggle and logout. |
| Colours | Hard-coded light-only hex values in pages/components replaced with token variables (`var(--border)`, `var(--bg-raised)`, …) so every screen works in both themes. Blue `#2563EB` accents became the neutral primary. Status colours aligned to the palette. |
| Calendar | `calendar.css` re-themed with tokens; compact toolbar on phones. |
| Performance | Every route is `React.lazy` (Settings 2.5k lines, DetailsSheet 1.3k lines and the calendar library no longer load at login); `vite.config.ts` adds stable vendor chunks (react / mui / icons / calendar / dates). |

## Deliberate decisions where the template and the old app disagreed

- **Primary colour**: template's neutral primary (light button/black text in dark) replaces MUI blue. Brand-coloured buttons (indigo, purple, green) keep their colour with explicit white text.
- **Breakpoints**: template's (768/992) replace MUI defaults (600/900). Existing `sm`/`md` usages shift slightly; review dense pages on tablets.
- **Social previews** (`SocialPreviewModal`) intentionally stay light — they imitate Instagram/Facebook/X/LinkedIn cards.
- **Details Sheet hierarchy**: solid light-blue fills replaced by translucent blue tints so the Campaign → Project → Task nesting reads on both themes.
- **Component library kept** (MUI): a rewrite of ~20k lines of UI was not justified; the theme layer gives the new look with a fraction of the risk.

## Not done / follow-ups

1. **Not built or visually verified** in the authoring environment (no network for `npm install`). Run `npm ci && npm run build` and click through each page in both themes before merging; expect small spacing fixes.
2. `Settings.tsx` (2.5k lines) and `DetailsSheet.tsx` (1.3k lines) should be split into per-tab / per-row components.
3. `moment` is only used by `react-big-calendar`; switch to its `dateFns` localizer (already a dependency) to drop ~70 kB.
4. `api.ts` sends `Cache-Control: no-cache` on every request, which forces a CORS preflight; consider removing it.
5. Dashboard fetches all campaigns and tasks to show counts/top 5 — add a summary endpoint.
6. Remaining inline hex colours are brand colours (social networks, Google button) by design.
