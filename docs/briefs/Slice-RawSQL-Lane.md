# Raw SQL Lane — Side Quest Brief

Objective: Introduce a raw SQL authoring lane that interoperates with the unified runtime: template-tag and function forms, positional parameters, consistent lints/budgets across lanes, and deterministic plan metadata.

## Scope
- Raw lane factory under `@prisma-next/sql` exported via the existing `root = sql(contract)` surface:
  - Template literal: `root.raw\`select * from "user" where id = ${userId}\``
  - Function form: `root.raw(text, { params, refs?, annotations? })`
- Parameterization: compile template to `$1..$n` positional placeholders and `params: unknown[]`
- Plan metadata:
  - `lane: 'raw'`, `target: 'postgres'`, `refs?`, `paramDescriptors[]`, `projection` (when supplied), `annotations?`
- Guardrails/budgets parity: apply the same lint/budget rules as other lanes (see below)

Out of scope (this brief): adapter lowering (raw uses provided SQL directly), ORM reshape, extension packs.

## References
- [MVP Spec](../MVP-Spec.md)
- [Architecture Overview](../Architecture%20Overview.md)
- ADRs:
  - [ADR 012 — Raw SQL Escape Hatch](../architecture%20docs/adrs/ADR%20012%20-%20Raw%20SQL%20Escape%20Hatch.md)
  - [ADR 011 — Unified Plan Model](../architecture%20docs/adrs/ADR%20011%20-%20Unified%20Plan%20Model.md)
  - [ADR 022 — Lint Rule Taxonomy](../architecture%20docs/adrs/ADR%20022%20-%20Lint%20Rule%20Taxonomy.md)
  - [ADR 023 — Budget Evaluation](../architecture%20docs/adrs/ADR%20023%20-%20Budget%20Evaluation.md)
  - [ADR 027 — Error Envelope & Stable Codes](../architecture%20docs/adrs/ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md)
  - [ADR 024 — Telemetry Schema & privacy](../architecture%20docs/adrs/ADR%20024%20-%20Telemetry%20Schema.md)

## API
- Template literal form
  ```ts
  const plan = root.raw\`
    select id, email from "user"
    where id = ${userId}
    order by "createdAt" desc
    limit ${n}
  \`;
  ```
- Function form
  ```ts
  const plan = root.raw(
    'select id from "user" where id = $1 limit $2',
    { params: [userId, n], refs: { tables: ['user'] }, annotations: { intent: 'report' } }
  );
  ```
- Output (both): immutable Plan with `{ sql, params, meta }`, positional params only; `paramDescriptors[]` includes optional `name`, `type?`, `refs?`

## Lints & Budgets (consistency across lanes)
- Best‑effort (no refs required):
  - `LINT.SELECT_STAR` (error)
  - `LINT.NO_LIMIT` (warn)
- Require `refs` to enable deterministic checks:
  - `LINT.UNINDEXED_PREDICATE` (warn)
  - `LINT.READ_ONLY_MUTATION` (error)
- Budgets:
  - Pre‑exec heuristics: treat SELECT without LIMIT as `BUDGET.ROWS_EXCEEDED` (policy decides error/warn)
  - Optional EXPLAIN (no ANALYZE) integration when enabled to refine estimates
- Param/budget enforcement happens in runtime plugins; raw lane only stamps metadata and compiled params

## Determinism & Telemetry
- Raw leaves SQL text as provided (plus placeholder compilation); runtime/telemetry uses normalized `sqlFingerprint` (ADR 024)
- Plan identity follows ADR 013/011; raw lane does not supply an AST

## Tests
### Unit (offline)
- Template tag compiles to positional placeholders with correct order
- Function form preserves given SQL/params
- `paramDescriptors` order and optional names inferred (`p1`, `p2` fallback) when template form used
- Best‑effort lint detection triggers for `select *` and missing `limit`

### Integration
- With refs supplied: `UNINDEXED_PREDICATE` and `READ_ONLY_MUTATION` fire appropriately
- Pre‑exec budget heuristic blocks unbounded SELECT when configured as error
- Optional EXPLAIN path integrates without changing Plan shape

## Milestones & Timeline
- M1 Template tag + function form + param compilation (1–2d)
- M2 Metadata + refs/annotations + unit tests (1–2d)
- M3 Integration with lints/budgets (wire to plugins; add tests) (1–2d)

## Risks & Mitigations
- False negatives without refs → Document refs requirement; provide helper to derive refs from contract where trivial
- SQL dialect specifics (quoting) → Raw trusts author; adapter not involved; budgets/lints remain lane‑agnostic
- Injection concerns → Template tag compiles to params; function form encourages parameterization; doc examples avoid string interpolation

## Acceptance Criteria
- Raw lane emits Plans with positional params and stable metadata via both forms
- Best‑effort lints fire without refs; additional lints fire when refs are provided
- Budgets enforce pre/post (heuristic + optional EXPLAIN) consistently with other lanes
