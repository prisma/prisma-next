# Persona doc shape (v1)

This file is the contract every persona doc under `personas/<id>.md` follows. It exists so the seven v1 personas read uniformly and so future authors don't re-decide section names per persona.

It is not itself a persona — `_shape.md` is excluded from the persona ID set by the leading underscore.

## Required sections (minimum content per spec FR2)

Every persona doc has these four sections, in this order:

1. **`# <Persona name>`** — H1 with the human-readable persona name (e.g. `# Architect`). The persona ID (kebab-case filename) and the H1 should map cleanly (`architect.md` → `# Architect`; `principal-engineer.md` → `# Principal engineer`).

2. **`## Stance`** — A short directive paragraph (advisory voice, ~3–6 sentences) that names the persona's identity, its overarching concern, and how it shifts execution-time defaults. Written in the second person (`You are a …`). This is the section that does the actual frame-shifting when loaded into context, so it should be specific and concrete, not aspirational.

3. **`## Priorities`** — Numbered list (typically 3–6 items). Each item names a priority and gives 1–2 sentences of rationale. Order matters — earlier items take precedence when they conflict with later ones. Priorities are *what this persona watches for first*, not a checklist of every concern that exists.

4. **`## Responsibilities`** — Bulleted list of the concrete things this persona produces, surfaces, or guards. Phrased as observable actions (`Surface naming and typology defects …`, `Critique ADRs against …`), not as character traits.

5. **`## Vocabulary cues`** — Two sub-lists:
   - **Prefer:** terms, framings, and patterns this persona reaches for.
   - **Avoid:** terms, framings, and anti-patterns this persona is allergic to. These are the cues that catch lens-specific defects (e.g. the architect's `Avoid` list is where typology-prefix anti-patterns get named).

## Optional section (admitted in v1 because it carries weight)

6. **`## Out of scope for this lens`** — Bulleted list of the things this persona explicitly does *not* watch for, *not* produce, or *not* adjudicate. Cross-references the persona that owns each — e.g. *"Implementation correctness is the principal engineer's lens; surface to them rather than adjudicating."* This section is what keeps composite-skill orchestrators sane: it tells a persona when to defer rather than overreach. v1 personas should fill this section when there's a real risk of overreach (architect, devrel, OSS specialist), and may omit it when the persona is so narrow it can't overreach.

## Tone and length

- **Advisory voice**, not contractual. A persona is a bias-frame, not a runtime contract (per spec NFR1, NFR2). Use `Prefer …`, `Watch for …`, `Treat … as worth stating`, not `MUST` / `MUST NOT`.
- **One screen of prose** (target: a few hundred words; per spec NFR4). If a persona doc grows past ~500 words, pressure-test it: are the priorities really distinct from another persona's, or is the doc absorbing scope that belongs elsewhere?
- **Concrete over abstract.** When the persona's stance is grounded in a real defect class (e.g. the architect's `Authored*` / `Extension*` typology-prefix examples from the M1-cleanup F4/F6 cycle), name it. Examples are the cheapest way to make a stance specific enough to actually shift behaviour.

## What every persona doc is *not*

- Not a job description for a human. Personas frame agent execution-time defaults; they don't enumerate every duty a real-world tech lead would have.
- Not a workflow. Workflows live in skills; personas are loaded into a workflow to colour how it executes.
- Not an encyclopedia of the discipline. Cite enough discipline (DDD, Clean, SOLID for architect; product-management framings for PM) to anchor the stance, then stop.
- Not a checklist. The output of a persona-loaded skill should read as the work of a coherent identity, not a series of checked boxes.

## Reviewing a new persona doc against this shape

Before landing a new persona doc, the author confirms:

- All five required sections are present and ordered as above.
- The stance section is specific enough that two readers would recognise the persona from prose alone.
- The vocabulary cues include at least one `Avoid` item that's persona-specific (i.e. would feel out-of-place in another v1 persona's doc).
- Word count is roughly one screen, not multiple.
- The optional `Out of scope for this lens` section is present unless overreach is implausible.
