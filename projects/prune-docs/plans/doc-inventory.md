# Doc inventory (prune-docs)

This is the working inventory for docs pruning. It’s intentionally biased toward capturing high-risk / high-churn docs first; expand it as the audit proceeds.

## Legend

- **Keep**: public-safe as-is (may still need link rewires if it references removed docs)
- **Rewrite**: keep the technical topic, but remove internal/competitive framing or sensitive content
- **Remove**: delete from the public docs set

## Inventory

| Path | Decision | Notes | Inbound links to fix |
|---|---|---|---|
| `docs/Executive Summary.md` | Remove | Internal strategy/positioning + competitor framing | Search and rewire any references |
| `docs/MVP-Spec.md` | Remove | Internal MVP plans + competitor comparison harness framing | `AGENTS.md` currently links here (must be removed) |
| `docs/v1-end-of-jan/` | Remove | Execution planning docs (internal timelines/roles) | Search and rewire any references |
| `docs/architecture docs/Contract-Driven DB Update.md` | Remove | Exploratory thread (not a stable reference) | Search and rewire any references |
| `docs/CLI Style Guide.md` | Rewrite | Remove competitor-comparison bullets; keep neutral CLI guidance | Search and rewire any references |
| `docs/architecture docs/adrs/ADR 158 - Execution mutation defaults.md` | Rewrite | Remove competitor references; keep decision + rationale | Search and rewire any references |
| `docs/Architecture Overview.md` | Keep | Canonical high-level architecture overview | Ensure it doesn’t link to removed docs |
| `docs/Testing Guide.md` | Keep | Public-safe engineering guidance | Ensure it doesn’t link to removed docs |
| `docs/onboarding/Getting-Started.md` | Keep / Rewrite if needed | Ensure it doesn’t reference removed MVP/plan docs | Fix links if needed |

