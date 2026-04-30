# Match all screens to the new landing-page styling

The landing and email-capture screens have been restyled to a clean palette:
- **CTA buttons**: solid deep red `#be1e28` with cream `#fff5f6` text (replacing the purple `gradient-mystic`)
- **Body / secondary text**: cream `#fff5f6` (replacing `text-muted-foreground`)
- **Accent text & icons**: white (replacing `text-accent` gold)
- **Inputs**: `border-secondary-foreground`
- **Headings**: white, with bold/italic emphasis

The **quiz, loading, and results screens** still use the original purple/gold palette and look inconsistent. This plan brings them in line.

## Changes (all in `src/pages/Index.tsx`)

### Quiz screen (lines ~281–381)
- Progress meta row: `text-muted-foreground` → `text-[#fff5f6]`
- "% aligned" badge: `text-accent` → `text-white font-semibold`
- Question heading: add `text-white`
- Multi-select hint: `text-accent` → `text-white`
- Option cards: hover/selected accent (`hover:border-primary/60`, `border-primary`) → `hover:border-[#be1e28]/60`, `border-[#be1e28]` so the active state matches the red CTA
- Selected radio/check fill: `bg-primary` / `border-primary` → `bg-[#be1e28]` / `border-[#be1e28]`; check icon `text-primary-foreground` → `text-[#fff5f6]`
- Multi-select Continue button: drop the `gradient-mystic` inline style → `bg-[#be1e28] text-[#fff5f6]`
- Skip link: `text-muted-foreground hover:text-accent` → `text-[#fff5f6]/70 hover:text-white`
- Back button + footer hint: `text-muted-foreground` → `text-[#fff5f6]`

### Loading screen (lines ~383–401)
- "Reading your energy…" heading: add `text-white`
- Subtext: `text-muted-foreground` → `text-[#fff5f6]`

### Results screen (lines ~403–553)
- Main heading: add `text-white`
- "Your 3 soul-aligned crystals…" subtext: `text-muted-foreground` → `text-[#fff5f6]`
- "No matches found" fallback: `text-muted-foreground` → `text-[#fff5f6]`
- Crystal cards:
  - "✦ Your primary crystal" eyebrow: `text-accent` → `text-white font-semibold`
  - Crystal name `<h3>`: add `text-white`
  - Resonance score block: `text-muted-foreground` → `text-[#fff5f6]`; the big number `text-accent` → `text-white`
  - "Supports:" body text: keep readable on dark — `text-foreground/90` → `text-[#fff5f6]`, label `text-muted-foreground` → `text-[#fff5f6]/70`
  - Tag pills: `bg-secondary` → `bg-[#be1e28] text-[#fff5f6]` so they echo the CTA
- "Want us to send these crystals" card:
  - Border `border-accent/40` → `border-[#be1e28]/50`
  - Heart icon `text-accent` → `text-white`
  - Heading: add `text-white`
  - Body `text-muted-foreground` → `text-[#fff5f6]`
  - "Yes, send my crystals" button: drop `gradient-mystic` style → `bg-[#be1e28] text-[#fff5f6]`
  - "Maybe later" ghost button: add `text-[#fff5f6] hover:text-white`
- Post-choice confirmation line: `text-muted-foreground` → `text-[#fff5f6]`
- "Personalised birth-chart report" card: same treatment as the supply card (border, icon, heading, body, primary button → red, ghost button → cream text)
- Final report-status confirmation line: `text-muted-foreground` → `text-[#fff5f6]`

## Notes
- All edits are className/inline-style swaps only — no logic, structure, or component API changes.
- Inline `style={{ background: "var(--gradient-mystic)", color: "..." }}` on buttons is removed where it conflicts with the new red CTA; the `var(--gradient-card)` background on cards is kept (it works well behind the cream text).
- The cosmic starfield background and `var(--gradient-cosmic)` on `<main>` are preserved — only foreground colors change.

## Tip for future tweaks
For one-off color/text changes like these, **Visual Edits** lets you click an element in the preview and change its color/font directly — no credits used and faster than chatting. Worth a try next time you want to nudge a color.
