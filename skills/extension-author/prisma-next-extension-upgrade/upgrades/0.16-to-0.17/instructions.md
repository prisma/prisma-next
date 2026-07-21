---
from: "0.16"
to: "0.17"
changes: []
---

No extension-side migration actions are required for this transition.

The ORM client's internal `throw new Error(...)` sites were converted to the
ADR 239 structured-error scheme (`ORM.*` codes via `structuredError`, or
`InternalError` for invariants). These are internal throw sites: the errors are
still `Error` instances and their message text is unchanged, so extension code
that catches them by message or by `instanceof Error` is unaffected. The new
`ORM.*` codes are additive — an extension that wants to branch on them can, but
nothing that worked before requires a change. `changes: []` marks this as a
no-op for downstream extensions.
