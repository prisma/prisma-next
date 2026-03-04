# feat: Rewrite README for open-source audience

## Overview

Rewrite the README to appeal to an open-source audience of TypeScript developers. Move architectural deep-dives into a new `ARCHITECTURE.md`. Make the README concise, compelling, and honest about the project's early-stage status.

## Problem Statement

The current README (~600 lines) reads like internal documentation. It mixes user-facing value props with deep architectural details (layer diagrams, mermaid charts, package listings, ADR references). An external TypeScript developer landing on this repo would be overwhelmed and uncertain about what the project *does* or *why they should care*.

## Proposed Solution

Split into two files:
1. **README.md** — Concise, outward-facing, developer-friendly
2. **ARCHITECTURE.md** — Deep-dive for contributors and the architecturally curious

### README.md — New Structure

```markdown
<p align="center">
  <!-- Prisma logo — reuse existing or add SVG -->
  <a href="https://www.prisma.io"><img src="..." width="..." alt="Prisma" /></a>
</p>

<h3 align="center">Contract-first data access for TypeScript</h3>

<p align="center">
  <!-- Badges: CI, License, Discord, X -->
</p>

<p align="center">
  <a href="https://www.prisma.io/docs">Docs</a> · <a href="https://pris.ly/discord">Discord</a> · <a href="https://twitter.com/prisma">X</a> · <a href="https://www.prisma.io/blog">Blog</a>
</p>

---

> ⚠️ **Early Preview** — Prisma Next is under active development. APIs will change. Not recommended for production use yet.

## What is Prisma Next?

[2-3 sentence elevator pitch. No jargon. What it does, who it's for.]

## Why Prisma Next?

[3-4 bullet points on what it unlocks — not architectural details, but *developer outcomes*:]
- Lightweight generation — types + contract JSON, not a heavy client
- Composable query DSL — write queries inline, no codegen rebuild loop
- Verifiable contracts — cryptographic hashes catch schema drift before runtime
- Agent-friendly — machine-readable artifacts that AI tools can understand

## Quick Example

[Single, self-contained code block showing the core workflow:
 schema → emit → query. Keep it under 30 lines.]

## Getting Started

[Short prerequisites + install + first query. Link to full docs for more.]

## How It Works

[Brief (5-10 lines) explanation of the contract-first flow:
 1. Define schema
 2. Emit contract + types
 3. Query with composable DSL
 Link to ARCHITECTURE.md for the deep dive.]

## Status

[Honest status table or prose: what works, what's coming, what's experimental.]

## Community

[Links to Discord, X/Twitter, blog. Mention that contributions aren't open yet,
 link to CONTRIBUTORS.md. Encourage starring/watching the repo.]

## License

[Apache 2.0 — link to LICENSE file.]
```

### ARCHITECTURE.md — New File

Move the following sections from the current README into `ARCHITECTURE.md`:
- "Clean Architecture Layers" (Domains → Layers → Planes)
- Layer diagram (mermaid)
- "Packages" listing (Framework Domain, SQL Family Domain, Test Packages)
- "Core Goals" (contract-first architecture, composable query layer, etc.)
- "Agent-Accessible Design"
- "Side-by-Side Comparison" table
- "Workflow Comparison"
- "Motivation"
- References to ADRs, Package-Layering guide, and subsystem docs

Structure of `ARCHITECTURE.md`:

```markdown
# Architecture

> For a quick overview of what Prisma Next is, see the [README](./README.md).

## Motivation
[Moved from README]

## Contract-First Design
[Condensed from "Core Goals" and "Why This Matters"]

## Architecture Model: Domains → Layers → Planes
[Moved from "Clean Architecture Layers" + mermaid diagram]

## Package Organization
[Moved from "Packages" section]

## Agent-Accessible Design
[Moved from README]

## Comparison with Prisma ORM
[Moved from "Side-by-Side Comparison" + "Workflow Comparison"]

## Deep Dives
[Links to docs/architecture docs/subsystems/, ADR index, Package-Layering guide]
```

## Acceptance Criteria

### README.md
- [ ] Under 150 lines (current is ~600)
- [ ] Header with Prisma logo, tagline, badges (CI, License, Discord, X)
- [ ] Navigation links: Docs, Discord, X, Blog
- [ ] Prominent "Early Preview" warning banner
- [ ] "What is Prisma Next?" — 2-3 sentence pitch
- [ ] "Why Prisma Next?" — 3-4 developer-outcome bullet points
- [ ] "Quick Example" — single code block, under 30 lines
- [ ] "Getting Started" — prerequisites + install + first query
- [ ] "How It Works" — brief contract-first flow, links to ARCHITECTURE.md
- [ ] "Status" — honest about what works and what doesn't
- [ ] "Community" — Discord (`https://pris.ly/discord`), X (`https://twitter.com/prisma`), blog, note about contributions not being open yet (link CONTRIBUTORS.md)
- [ ] "License" — Apache 2.0, link to LICENSE file
- [ ] No internal jargon (no "planes", "lanes", "domains" in README)
- [ ] No mermaid diagrams in README
- [ ] No package listing in README
- [ ] Does NOT mention sunsetting Prisma ORM or replacing it

### ARCHITECTURE.md
- [ ] Created at repo root
- [ ] Contains all architectural content moved from README
- [ ] Links back to README for the quick overview
- [ ] Links to existing docs (ADRs, subsystem deep dives, Package-Layering guide)
- [ ] Preserves the mermaid layer diagram
- [ ] Preserves the Prisma ORM comparison table

### Cross-References
- [ ] README links to ARCHITECTURE.md in "How It Works"
- [ ] ARCHITECTURE.md links back to README
- [ ] README links to LICENSE
- [ ] README links to CONTRIBUTORS.md (for contribution status)
- [ ] CLAUDE.md / AGENTS.md are NOT affected (internal docs, separate concern)

## Technical Considerations

- **Tone**: Professional but approachable. Similar to Drizzle ORM's README — confident, concise, developer-first. Avoid marketing speak.
- **Badges**: Use shields.io for CI status, license (Apache 2.0), Discord, X. Don't over-badge.
- **Code example**: Use the `postgres()` one-liner pattern from the current README's "Runtime Connection" section — it's the simplest entry point.
- **Social links**: Use Prisma's existing channels:
  - Discord: `https://pris.ly/discord`
  - X/Twitter: `https://twitter.com/prisma`
  - YouTube: `https://www.youtube.com/c/PrismaData`
  - GitHub: `https://github.com/prisma/prisma-next` (or current repo URL)
- **No emojis** in the README body (per codebase convention), except the ⚠️ in the early preview banner.
- **Source of truth for "what Prisma Next unlocks"**: Use the value props already in the current README's "What Is This?" and "Why This Matters" sections, distilled into developer outcomes.

## What NOT To Do

- Do NOT mention sunsetting Prisma ORM
- Do NOT open contributions or change the CONTRIBUTORS.md messaging
- Do NOT add a "Contributing" section that invites PRs
- Do NOT include the full package listing in the README (that goes in ARCHITECTURE.md)
- Do NOT include the internal "Common Commands" developer reference (that stays in CLAUDE.md for agents)

## References

- Current README: `README.md` (~600 lines, needs trimming)
- License: `LICENSE` (Apache 2.0, Copyright 2026 Prisma Data, Inc)
- Contributors: `CONTRIBUTORS.md` (contributions not open yet)
- Prisma ORM README: [github.com/prisma/prisma](https://github.com/prisma/prisma) — social links, badges, community section as reference
- Drizzle ORM README: [github.com/drizzle-team/drizzle-orm](https://github.com/drizzle-team/drizzle-orm) — tone, conciseness, TypeScript-first messaging
- uniku README: [github.com/jkomyno/uniku](https://github.com/jkomyno/uniku) — badges, structure, quick examples
- Prisma social channels: Discord (`pris.ly/discord`), X (`twitter.com/prisma`), YouTube, GitHub
