---
from: "0.8"
to: "0.9"
changes: []
---

Placeholder transition entry for the 0.8 → 0.9 release.

The substrate edits under `examples/` in this PR are part of the
target-extensible-IR refactor (PR1 of the M9 series). Downstream user
upgrade authoring is tracked as a follow-up — the entries here will be
filled in before the 0.9 release ships. The `changes: []` shape keeps
the release pipeline coverage check honest about that follow-up rather
than silently shipping nothing for the transition.
