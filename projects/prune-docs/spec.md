# Summary

Prepare this repository for a public launch by **removing internal/strategic documentation**, pruning or rewriting exploratory architecture threads, and ensuring the remaining docs form a coherent, public-safe, technically useful set. As part of this overhaul, remove competitor/market analysis framing from documentation and remove all references to the previously-used competitor ORM name(s).

# Description

We are opening this repo to the public soon. The current documentation set includes content that is inappropriate for a public repo, including internal motivation/strategy, MVP planning artifacts, competitor analysis, and exploratory design threads.

This project defines the scope and acceptance criteria for a docs overhaul that:

- Removes internal documents like executive summaries and MVP plans.
- Removes exploratory threads (example called out: `docs/architecture docs/Contract-Driven DB Update.md`).
- Removes all references to the previously-used competitor ORM name(s) and similar comparative “harness” framing.

**Assumption:** This project will be tracked under `projects/prune-docs/` and culminate in changes to `docs/**`, root docs (`README.md`, `AGENTS.md`), and any other markdown documentation that is user-facing.

# Requirements

## Functional Requirements

- **Audit and classify docs**
  - Inventory documentation under `docs/**` and other user-facing markdown (root `README.md`, `AGENTS.md`, package READMEs when relevant).
  - Classify each doc into one of:
    - Keep (public-safe as-is)
    - Rewrite (keep topic, change framing/content)
    - Remove (delete from repo history-forward)
  - Record the decisions in a short “Doc inventory” table in the project plan (generated later), not by leaving TODOs scattered through docs.

- **Maintain a “problematic removals” log (local-only)**
  - As content is removed or rewritten, maintain a running log at `wip/prune-docs/problematic-removals.md`.
  - Purpose: allow a post-pass assessment of whether any removed content is sensitive enough to justify a history rewrite.
  - Each entry must include:
    - File path
    - Category (e.g. internal strategy/planning, internal identifiers/URLs, competitor framing, exploratory thread)
    - A brief summary of what was removed and why it was problematic
    - Severity (low/med/high) and a recommendation (“consider history rewrite” yes/no)
  - **Constraint:** do not paste raw sensitive content verbatim into this log. If an excerpt is necessary, redact identifiers (names/domains/IDs) and keep it minimal.

- **Remove internal strategy / planning artifacts**
  - Remove docs that expose internal motivations, planning, timelines, resourcing, stage gates, or competitive positioning.
  - Known starting points (non-exhaustive):
    - `docs/Executive Summary.md`
    - `docs/MVP-Spec.md`
    - `docs/v1-end-of-jan/**`

- **Remove exploratory threads from public docs**
  - Remove exploratory/brainstorm/proposal docs that read like ongoing design exploration rather than a stable subsystem description or an accepted ADR.
  - Known starting point (explicitly requested):
    - `docs/architecture docs/Contract-Driven DB Update.md`

- **Remove references to competitor ORM name(s)**
  - Remove references to the previously-used competitor ORM name(s) from documentation, including ADRs and style guides.
  - Known starting points (non-exhaustive):
    - `docs/Executive Summary.md`
    - `docs/MVP-Spec.md`
    - `docs/v1-end-of-jan/v1-plan.md`
    - `docs/CLI Style Guide.md`
    - `docs/architecture docs/adrs/ADR 158 - Execution mutation defaults.md`

- **Remove competitor / market analysis framing**
  - Remove comparative “market positioning” content, competitor tables, and competitor outcome comparisons from docs.
  - When comparisons are materially useful technically (rare), replace with neutral language that does not name competitors or speculate about their gaps.

- **Rewire doc navigation**
  - Ensure no top-level docs point at removed documents.
  - In particular, update `AGENTS.md` “Start Here” links so they only reference public-safe docs.
  - Provide a stable docs index (e.g. `docs/README.md`) that becomes the canonical entry point for documentation beyond the root `README.md`.

## Non-Functional Requirements

- **Public-safe content**
  - No internal planning details, internal stakeholder names, internal timelines, internal program structure, or “why we’re doing this” strategy narratives that go beyond a short technical rationale.
  - No competitor analysis or disparaging comparisons.
  - No references to the previously-used competitor ORM name(s).

- **Sensitive content checklist**
  - Docs do not include (unless explicitly intended for public release):
    - Internal stakeholder names / team names / codenames
    - Names of private design partners or NDA programs
    - Internal links (e.g. internal trackers, docs systems, private dashboards)
    - Internal domains, emails, invite links, or non-public endpoints
    - Operational details that materially increase risk (e.g. security posture specifics, internal infra topology) beyond what’s necessary for a public OSS audience

- **Coherent, navigable docs**
  - A new contributor can find:
    - What Prisma Next is (technical overview)
    - How to build/test
    - Where architecture and subsystem docs live
    - How to navigate the remaining documentation set (what to read next)

- **Link integrity**
  - Internal links within `docs/**`, root docs, and package READMEs remain valid after removals/renames.

## Non-goals

- Adding or polishing standard public repo “meta docs” like `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, or `CODE_OF_CONDUCT.md` (track separately).
- Producing a public roadmap, timelines, resourcing plan, or “MVP plan”.
- Writing marketing collateral or competitive positioning docs.
- Reworking the underlying architecture or implementation (this project is documentation-focused).
- Preserving removed internal docs inside this public repository (they should be archived out-of-band if they must be retained).

# Acceptance Criteria

## Content pruning / redaction

- [ ] `docs/Executive Summary.md` is removed or rewritten such that it no longer functions as an internal strategy/positioning doc (default expectation: removed).
- [ ] `docs/MVP-Spec.md` is removed from the public docs set (default expectation: removed).
- [ ] `docs/v1-end-of-jan/` planning docs are removed from the public docs set (default expectation: removed).
- [ ] `docs/architecture docs/Contract-Driven DB Update.md` is removed from the public docs set (explicit request).

## No competitor ORM references

- [ ] A repo-wide, case-insensitive search for the previously-used competitor ORM name(s) returns **zero** matches in tracked files.

## Navigation and entry points

- [ ] `AGENTS.md` does not link to removed/internal docs (e.g. it no longer links to `docs/MVP-Spec.md`).
- [ ] A canonical docs index exists (e.g. `docs/README.md`) and is linked from the root `README.md` and/or `AGENTS.md`.

## Audit artifacts

- [ ] `wip/prune-docs/problematic-removals.md` exists locally and is kept up to date as removals/rewrites happen.
- [ ] The sensitive content checklist is applied to docs that are kept or rewritten, and any violations found are either fixed or captured in `wip/prune-docs/problematic-removals.md`.

**Reviewer note:** the `wip/` evidence log is intentionally **local-only** and must not be committed. In PR review, verify this criteria by checking (a) `.gitignore` includes `/wip` and (b) the PR contains no `wip/` files.

# Other Considerations

## Security

- Treat this as a **content security** project:
  - Remove internal program details, names, and sensitive internal reasoning.
  - Ensure docs do not include real credentials, internal URLs, private endpoints, or environment details.

## Cost

**Assumption:** Primary cost is engineering time for auditing, rewriting, and link maintenance. Tooling additions (if any) should be minimal and low-maintenance.

## Observability

- Add a lightweight, automated check in CI (or a local script) that enforces:
  - A “banned terms” list (including the previously-used competitor ORM name(s))
  - Optional: broken link detection for markdown within `docs/**`

## Data Protection

- Ensure docs do not include personal data (names of internal stakeholders, private design partners, etc.) unless explicitly intended for the public repo.

## Analytics

- No product analytics requirements for this docs project.

# References

- `AGENTS.md` (current top-level entry points)
- `docs/Architecture Overview.md`
- `docs/onboarding/Getting-Started.md`
- `docs/Executive Summary.md` (explicitly targeted for removal/rewrite)
- `docs/MVP-Spec.md` (explicitly targeted for removal)
- `docs/v1-end-of-jan/v1-plan.md` (explicitly targeted for removal)
- `docs/CLI Style Guide.md` (contains competitor comparisons today)
- `docs/architecture docs/Contract-Driven DB Update.md` (explicitly targeted for removal)
- `docs/architecture docs/adrs/ADR 158 - Execution mutation defaults.md` (contains competitor references today)

# Open Questions

1. **License selection:** What license should the public repo use (MIT/Apache-2.0/etc.)?  
   **Default assumption:** defer to a follow-up project (out of scope here).

2. **Rewrite vs remove for internal docs:** For docs like `docs/Executive Summary.md`, do we want to preserve a public-friendly “Overview” document, or only keep technical overviews in `README.md`/`docs/`?  
   **Default assumption:** remove internal docs and replace with a short, technical `docs/Overview.md` if needed.

3. **Exploratory architecture content policy:** Should exploratory proposals be deleted outright, or moved to a non-public location outside this repository?  
   **Default assumption:** delete from this repo (public) and archive out-of-band if needed.

