# Model-tier routing

Which model tier should this dispatch run on? Per [`docs/drive/principles/decomposition-and-cost.md`](../../docs/drive/principles/decomposition-and-cost.md), the cost-vs-capability decision is dispatch-shape-dependent, not size-dependent. A judgment-heavy M dispatch belongs on the orchestrator tier; a mechanical M dispatch belongs on the cheap tier.

## Routing table

| Dispatch shape | Recommended tier |
|---|---|
| Substrate change / design judgment / spec interpretation | Opus (orchestrator tier) |
| Codemod / mechanical migration / batch fix | Sonnet or composer-2 (mid tier) |
| Test-literal rewrites / fixture regen | composer-2 or composer-2-fast (cheap tier) |
| Spike (read, count, structure findings) | Sonnet or composer-2 |
| Architect-class finding remediation (single discipline, narrow surface) | Sonnet |
| Long-running validation gate runs (typecheck, test:packages) | Whichever tier the parent dispatch chose (no model dispatch — just bash) |

## How this table updates

Per the trigger rule in [`README.md § Maintenance discipline`](./README.md#maintenance-discipline): adjust a row when **three consecutive failed dispatches at the recommended tier** are recorded, OR when a single retro names the tier choice as a contributing factor (e.g. "we routed this to cheap tier and it lost the spec's edge case; mid tier would have caught it"). Note the rationale in the retro that triggered the change.

Defaulting to the parent agent's tier (the Cursor SDK's `Task` default) is treated as a bug — every dispatch's brief carries an explicit tier choice per the brief-discipline principle.
