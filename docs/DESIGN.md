# Candles design

## Overview

Candles is a single-page Sepolia market viewer and trading interface. A warm off-white page, dark green text, local sans-serif typography and restrained white panels keep the chart and transaction steps prominent. The market appears before the supporting event feed and hook explanation. There is one emphasized transaction step at a time.

This document lives under `docs/` because the assignment’s explicit write scope forbids repository-root files. It describes the implemented source, not a proposed redesign. Source of truth: `web/src/styles.css`, `web/src/App.tsx`, `web/src/Chart.tsx`.

## Colors

The site uses hex primitives mapped to semantic CSS properties in `web/src/styles.css:2`. There is one light theme.

| Semantic token | Value | Role |
| --- | --- | --- |
| `--bg` | `#f5f5f0` | Page background |
| `--surface` | `#ffffff` | Panels, selected segments, input surfaces |
| `--subtle` | `#eeefe8` | Secondary surfaces, neutral statuses |
| `--text` | `#202b20` | Main text |
| `--muted` | `#616b5e` | Supporting text, axis labels |
| `--line` | `#dfe2d7` | Structural dividers and borders |
| `--accent` | `#38602f` | Current primary action |
| `--accent-hover` | `#254a1d` | Action hover |
| `--accent-soft` | `#eaf1e5` | Review surface and neutral-button hover |
| `--positive` | `#397052` | Rising candles and live-state dot |
| `--negative`, `--error` | `#ab422b` | Falling candles and error text |
| `--error-bg` | `#fff1ec` | Error surface |
| `--warning` | `#8c4a14` | Testnet/network notices |
| `--warning-bg` | `#fcf0e3` | Warning surface |
| `--focus` | `#1e61ab` | Keyboard focus outline |

Statuses also have text. Candles have an Up/Down/Flat gap legend and an accessible data table. The palette is not the only way to obtain price direction or state.

Measured rendered text pairs: muted/page 5.09:1; muted/white 5.57:1; primary white/green 7.29:1; testnet badge 6.03:1; main text/white 14.71:1. Exact sampled values and limitations are in `docs/evidence/contrast.json` and the validation record.

## Typography

`DM Sans Variable` is self-hosted as one Latin normal WOFF2 from `@fontsource-variable/dm-sans` (weights 100–1000); the UI uses regular through bold weights. Fallbacks are `DM Sans`, system UI and sans-serif. `font-display: swap` keeps loading readable. Monospace system text is reserved for IDs; the circular CNDL mark uses Georgia. Font licensing is in `docs/frontend/DM-SANS-LICENSE.txt`.

The root is 16px with unitless 1.5 line height. The hero is `clamp(2rem, 3.2vw, 3rem)`, weight 550, line height 1.16 and letter spacing −0.055em. H2 headings are generally 1.25rem/600, with contextual 1.125–1.6rem variants; H3 is 1rem/650. The small body scale is 0.75, 0.8125, 0.9375, 1 and 1.125rem. Dense chart readouts and footnotes use 0.625–0.6875rem; exact chart values remain available in the table.

Headings balance; paragraphs use pretty wrapping. Prose measures are bounded by their grid columns and local `ch` limits. Updating market statistics, candle readouts and tables use tabular numbers. Inputs stay at least 16px; the amount field is 1.8rem. Long IDs wrap with `overflow-wrap: anywhere`; full addresses remain available through explorer links and their titles.

## Layout

Header, main and footer share a 1440px maximum width. Desktop horizontal padding is 3.5rem, reducing to 2rem and then 1.25/1rem. Spacing commonly uses 0.5, 0.75, 1, 1.5, 2 and 3rem increments. Related controls stay close; larger section gaps separate tasks.

The main market grid is a fluid chart plus a 344px trade panel with a 1.5rem gap. It narrows to 320px and 300px side panels before stacking. The lower section uses a 1.16:1 grid for activity and the hook description. Wallet tools are a native disclosure with a two-column form/allowance area.

Implemented breakpoints:

- 75rem: narrower gutters, 320px trade panel.
- 59rem: 300px trade panel, wrapped stats, compact chart controls, hidden network label.
- 47rem: single-column market/support sections and wallet tools; compact header without section navigation; intro stacks.
- 25rem: 1rem gutters, two-row statistics, compact pair/header treatment and vertically arranged deployment metadata.

The production export was checked at 1440, 940, 750, 390 and 320 CSS pixels with no document overflow. A 200% root-text enlargement check also passed; this is distinct from browser-native zoom. The chart table scrolls within a labeled focusable region and has a maximum height of 320px.

## Elevation & Depth

Surfaces are flat and defined by 1px structural borders. Only the active trade segment uses a subtle `0 1px 3px #202b2014` shadow. No modal, floating transaction overlay or sticky header covers content. Transaction status remains inline.

## Shapes

Panels use `--radius: 16px`, controls use `--control-radius: 8px`. Trade amount/output surfaces use 10px radii. The segmented container has a 10px outer radius, 4px inset and 6px selected-button radius. Small badges use 4px corners. The token mark is circular. The chart panel clips its own content; full data is separately reachable.

## Components

- **Navigation and wallet bar** (`App.tsx`, `.site-header`, `.wallet-bar`): native links/buttons, first-focusable skip link, account display, connection and switch controls. Browser-wallet absence/rejection has recoverable text.
- **Market panel** (`App.tsx`, `.chart-panel`, `.stats`): StateView price, 24h volume and swap count. Loading, live and stale/error states are explicit. There are no demo numbers in the production app.
- **Chart** (`Chart.tsx`): takes `Market | null`. SVG OHLC marks and volume bars, zero-volume flat gaps, labeled range selection and expandable HTML data table. No animation or pointer-only tooltip is needed to read exact data.
- **Trade pattern** (`App.tsx`, `.trade-panel`): grouped pressed-state Buy/Sell buttons; labeled amount/tolerance fields; estimated quote; separate approval; simulation review; confirmation. The Get quote control becomes neutral once a later step is available. Field errors set `aria-invalid`, reference error text and focus the field. Prerequisite failures disable consequential actions and explain why.
- **Statuses** (`.notice`, `.action-error`, `.action-status`): persistent inline messages with alert/status semantics, error coloring and explorer transaction links. No transient toast hides a failure.
- **Activity and deployment disclosure** (`.event-row`, `.details-list`, `.contract-links`): compact linked event records, full pool/source values and labeled contract explorer links. Empty and RPC-error states are visible.
- **Wallet tools** (`.wallet-tools`): native disclosure for ERC-20 transfer and allowance revocation. Simulation precedes wallet confirmation.

Buttons generally have a 44px minimum height; trade segments use 40px. Focus uses a 3px outline with a 4px offset. Hover styles apply only on hover-capable devices. Press feedback scales to 0.96 and transitions background/transform for 120ms only when reduced motion is not requested. Forced-colors mode retains a system Highlight outline. There are no page-load animations.

## Do’s and Don’ts

Reuse semantic tokens rather than borrowing border colors for text. Keep the active transaction step visually dominant and supporting actions neutral. Extend native forms, details and tables before adding custom widgets. Keep exact data available when visual density or shortened addresses reduce detail.

Keep contract identities and network values in the runtime manifest. Never use the candle chart as a quote input or replace an RPC failure with invented market data. Keep disabled-state explanations beside the relevant action. Do not imply PoolSwapTest guarantees minimum output or an onchain deadline.

For another section, reuse the constrained main container, section headings, semantic text tokens and responsive grid patterns. Keep static navigation in the same document or use hash routing; new routed pages need explicit static exports.

## Attribution

Design review applied the pinned Better Interface guidance by Jakub Krehel, MIT, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`: https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface. Documentation method adapted from Paul Bakaus’s Impeccable, Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`: https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md. These works retain their respective licenses; the guide itself is not redistributed here.
