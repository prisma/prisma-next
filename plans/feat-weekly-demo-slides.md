# Weekly Demo Slides — 2026-03-13

**Type:** Presentation (single `slides.html` file)
**Time:** 7 minutes
**Audience:** Prisma team weekly sync
**Output:** `examples/weekly-demo-2026-03-13/slides.html`

---

## Slide Structure (7 minutes, 9 slides)

### Slide 1 — Title (15s)
- **"Prisma Next CLI — Week of March 13"**
- Subtitle: Alberto Schiabel
- Minimal, dark theme (Catppuccin Frappe palette to match SVG recordings)

---

### Section A: CLI Revamp (PR #228) — 1.5 minutes

### Slide 2 — CLI Revamp: Architecture & UX
- Before: monolithic `output.ts` (~1800 lines) → After: modular formatters (`help`, `styled`, `migrations`, `emit`, `errors`, `verify`) + new `TerminalUI` class
- Key UX wins:
  - `--plan` → `--dry-run`, `--accept-data-loss` → `-y/--yes`
  - "Did you mean?" suggestions for typos
  - Graceful SIGINT/SIGTERM shutdown, flicker-free spinners
  - Copy-pastable examples in every help text
  - Interactive confirmation for destructive `db update`

### Slide 3 — CLI Revamp: Unified Surface
- Global flags table: `--json`, `-q`, `-v`, `--trace`, `--color/--no-color`, `-y/--yes`
- Env vars: `PRISMA_NEXT_DEBUG` / `PRISMA_NEXT_TRACE`
- `db verify` upgraded: marker + structural schema check by default, `--fast` for marker-only

---

### Section B: Bug Fixes — 1 minute

### Slide 4 — Postgres Default Normalizer
- **Problem:** Cast-wrapped timestamps (`now()::timestamp`), NULL defaults, numeric overflow not normalized correctly
- **Fix:** Canonical form normalization in `default-normalizer.ts`
- **Precision:** `clock_timestamp()` kept distinct from `now()` (volatile vs stable)
- Result: schema verification now correctly matches semantically equivalent defaults

---

### Section C: CLI Scenarios Tested — 3.5 minutes

### Slide 5 — Testing Philosophy
- **Goal:** Capture the flows used most often by the majority of our future users
- 12 journey test files covering real-world workflows against real PostgreSQL
- Organized into: Happy Paths, Drift Detection, Error Scenarios
- Each journey recorded as animated SVG for visual review

### Slide 6 — Happy Paths (with SVG recordings)
Two key journeys with embedded SVG recordings + Play/Pause/Stop controls:
1. **Greenfield Setup** (emit → init → verify → introspect)
2. **Direct Update** (emit v2 → update dry-run → apply → noop → verify)

**SVG recordings to embed (pick 2-3 to show live):**
- `greenfield-setup/01-contract-emit.svg`
- `greenfield-setup/03-db-init.svg`
- `greenfield-setup/05-db-verify.svg`
- `direct-update/02-db-update-dry-run.svg`
- `direct-update/03-db-update-apply.svg`

### Slide 7 — Drift Detection (with SVG recordings)
Three drift scenarios with embedded SVG recordings:
1. **Phantom Drift** — marker OK but schema diverged via manual DDL
2. **Missing Marker** — recovery via `db init`
3. **Stale Marker** — recovery via `db update`

**SVG recordings to embed (pick 2-3 to show live):**
- `drift-phantom/01-db-verify-false-positive.svg`
- `drift-phantom/02-db-schema-verify-fail.svg`
- `drift-phantom/04-db-update-recovery.svg`
- `drift-missing-marker/04-db-init-recovery.svg`
- `drift-stale-marker/03-db-update-recovery.svg`

### Slide 8 — Error Scenarios & Brownfield
- Config errors (missing file, invalid TS, missing contract field)
- Connection & contract errors (missing DB, target mismatch, unmanaged DB)
- Brownfield adoption (introspect → emit → verify → sign)
- Help & flags (`--no-color`, `-q`, `-v`)

---

### Slide 9 — Wrap-up (30s)
- **Key takeaway:** Refining user journeys via scenario tests made it easier for us to identify gaps in the CLI, and visually understand our flows through recordings
- The recordings are a living artifact — as the CLI evolves, the scenarios and their visual captures evolve with it
- CLI is now **modular**, **tested**, and **visually documented**

---

## Technical Implementation

### Stack
- **Single HTML file** — zero build step, open in browser
- **reveal.js** via CDN — slide framework
- **Catppuccin Frappe** color palette — matches SVG recording theme
- **Geist + JetBrains Mono** fonts — matches recording config

### SVG Recording Embedding
Each SVG recording slide uses an `<object>` or inline `<iframe>` to embed the animated SVG. Custom Play/Pause/Stop controls implemented via JavaScript:

```html
<div class="recording-container">
  <object data="path/to/recording.svg" type="image/svg+xml" class="recording-svg"></object>
  <div class="recording-controls">
    <button class="ctrl-play" title="Play">▶</button>
    <button class="ctrl-pause" title="Pause">⏸</button>
    <button class="ctrl-stop" title="Stop">⏹</button>
  </div>
</div>
```

**Control logic:**
- **Play:** Resume SVG CSS animations (`animationPlayState = 'running'`)
- **Pause:** Freeze animations (`animationPlayState = 'paused'`)
- **Stop:** Reset to frame 0 + pause (`animation = 'none'` → reflow → re-apply + pause)

The controls should use clean SVG icons (not emoji), styled as pill-shaped buttons at the bottom of each recording.

### SVG Paths (relative to slides.html)
All recordings live at: `../../packages/1-framework/3-tooling/cli/recordings/svgs/`

Selected recordings to include:
```
greenfield-setup/01-contract-emit.svg
greenfield-setup/03-db-init.svg
greenfield-setup/05-db-verify.svg
direct-update/02-db-update-dry-run.svg
direct-update/03-db-update-apply.svg
drift-phantom/01-db-verify-false-positive.svg
drift-phantom/02-db-schema-verify-fail.svg
drift-phantom/04-db-update-recovery.svg
drift-missing-marker/04-db-init-recovery.svg
drift-stale-marker/03-db-update-recovery.svg
```

### Design Directives (from design-taste-frontend skill)
- **DESIGN_VARIANCE: 6** — Offset layouts, asymmetric where useful
- **MOTION_INTENSITY: 4** — Subtle CSS transitions only (no heavy JS motion)
- **VISUAL_DENSITY: 4** — Clean, airy slides with breathing room
- **Color:** Catppuccin Frappe base (`#303446`), accent Emerald/Teal (`#a6d189`)
- **Typography:** `Geist` for headings, `JetBrains Mono` for code
- **No emojis** in slides — use Phosphor-style SVG icons or Unicode symbols
- **No purple/neon gradients** — use neutral base with single teal accent
- **Anti-card-overuse:** Use borders and spacing, not boxed cards everywhere

### File Structure
```
examples/weekly-demo-2026-03-13/
└── slides.html          # Self-contained presentation
```

The HTML file inlines all CSS and JS (no external deps except CDN reveal.js and fonts).

---

## Acceptance Criteria

- [ ] Single `slides.html` file that opens in any browser
- [ ] 9 slides covering CLI revamp, bug fixes, tested scenarios with integrated recordings
- [ ] Embedded SVG recordings with functional Play/Pause/Stop controls (SVG icons)
- [ ] Catppuccin Frappe dark theme matching recording aesthetics
- [ ] Geist + JetBrains Mono fonts
- [ ] Presentation fits comfortably within 7 minutes
- [ ] Keyboard navigation via reveal.js (arrow keys, space, ESC for overview)
- [ ] No build step required — just open the file

---

## References

- SVG recordings: `packages/1-framework/3-tooling/cli/recordings/svgs/`
- Recording config: `packages/1-framework/3-tooling/cli/recordings/config.ts`
- CLI source: `packages/1-framework/3-tooling/cli/src/`
- Journey tests: `test/integration/test/cli-journeys/`
- Design skill: `/Users/jkomyno/work/me/websites/ai-jkomyno-dev/.agents/skills/design-taste-frontend/SKILL.md`
