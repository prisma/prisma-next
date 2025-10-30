## Goal

Build the Raw SQL authoring lane described in `Slice-RawSQL-Lane.md` so it interoperates with the unified runtime, supports both template-tag and function forms, compiles to positional parameters, stamps deterministic metadata, and integrates with existing lint/budget plugins.

Key references:
- [ADR 011 — Unified Plan Model](../architecture%20docs/adrs/ADR%20011%20-%20Unified%20Plan%20Model.md)
- [ADR 012 — Raw SQL Escape Hatch](../architecture%20docs/adrs/ADR%20012%20-%20Raw%20SQL%20Escape%20Hatch.md)
- [ADR 013 — Plan Identity](../architecture%20docs/adrs/ADR%20013%20-%20Plan%20Identity.md)
- [ADR 022 — Lint Rule Taxonomy](../architecture%20docs/adrs/ADR%20022%20-%20Lint%20Rule%20Taxonomy.md)
- [ADR 023 — Budget Evaluation](../architecture%20docs/adrs/ADR%20023%20-%20Budget%20Evaluation.md)
- [ADR 024 — Telemetry Schema](../architecture%20docs/adrs/ADR%20024%20-%20Telemetry%20Schema.md)
- [ADR 027 — Error Envelope & Stable Codes](../architecture%20docs/adrs/ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md)
- [Architecture Overview](../Architecture%20Overview.md)
- [MVP Spec](../MVP-Spec.md)


## Constraints and repo conventions

- **pnpm and turborepo**: use `pnpm` and `pnpm build` delegates to Turbo.
- **Typecheck**: prefer `pnpm typecheck` scripts.
- **Schema libs**: use `arktype`, not zod.
- **TS imports**: never include file extensions.
- **Tests**: omit the word "should" in `it()` descriptions.
- **Surfaces**:
  - Raw lane lives under `packages/sql` and is exported via `@prisma-next/sql` root factory `sql(contract)` → `root.raw`.
  - Runtime lint/budget wiring in `packages/runtime`.
  - Postgres adapter/driver remains unchanged (raw passes text directly).
- **Plan**: immutable `{ sql, params, meta }`, positional params only; `meta` includes `lane: 'raw'`, `target: 'postgres'`, `refs?`, `paramDescriptors[]`, `projection?`, `annotations?`.
- **Guardrails**: runtime plugins enforce lints/budgets; the lane stamps metadata only.


## High-level blueprint (end state)

- Implement `root.raw` with two APIs:
  - Template tag: `root.raw\`select * from "user" where id = ${userId}\``
  - Function form: `root.raw(text, { params, refs?, annotations? })`
- Template compilation:
  - Convert template pieces and expressions to SQL with `$1..$n` placeholders.
  - `params: unknown[]` left-to-right order.
  - `paramDescriptors: { index: number; name?: string; type?: string; refs?: unknown }[]` with default names `p1..pn` for template form.
- Plan metadata:
  - `meta.lane = 'raw'`, `meta.target = 'postgres'`, `meta.refs?`, `meta.annotations?`, `meta.paramDescriptors[]`, optional `meta.projection`.
  - Plan identity per ADR 011/013; raw does not produce an AST.
- Guardrails parity (runtime plugins):
  - Best-effort lints: `SELECT *` (error), missing `LIMIT` (warn).
  - With refs: `UNINDEXED_PREDICATE` (warn), `READ_ONLY_MUTATION` (error).
  - Budgets: Heuristic pre-exec for unbounded SELECT; optional EXPLAIN (no ANALYZE).
- Telemetry & errors:
  - Compute `sqlFingerprint` (ADR 024) in runtime.
  - Use stable error codes (ADR 027).
- Tests:
  - Unit tests in `packages/sql` for compilation and metadata.
  - Integration tests in `packages/runtime` for lints/budgets with raw lane.
- Exports & docs:
  - Export via `@prisma-next/sql` entrypoints.
  - Examples in `examples/prisma-next-demo`.


## Iterative chunks (milestones)

- **M1**: Raw lane template tag + function form + param compilation + unit tests.
- **M2**: Metadata stamping + refs/annotations + exports + unit tests.
- **M3**: Runtime plugin wiring for lints/budgets + integration tests + optional EXPLAIN.


## Detailed steps per milestone

### M1: API + parameter compilation

1. Create `packages/sql/src/raw.ts` with `compileTemplateToPositional` and `createRawFactory`.
2. Implement template-tag support: handle `TemplateStringsArray` + expressions → `$1..$n`; collect ordered `params`.
3. Implement function form: accept `text` and `{ params, refs?, annotations? }`; preserve text.
4. Return minimal Plan: `{ sql, params, meta: { lane: 'raw', target: 'postgres', paramDescriptors } }`.
5. Build `paramDescriptors` with default names `p1..pn` (template form) in left-to-right order.
6. Unit tests in `packages/sql/test/raw.test.ts`:
   - Placeholder compilation for 1–3 params.
   - Surrounding text unchanged.
   - `params` order matches expressions.
   - `paramDescriptors` length and names `p1..pn`.
   - Plan is immutable via `Object.isFrozen`.
7. Wire `raw` into `packages/sql/src/sql.ts` and `packages/sql/src/exports/sql.ts`.
8. Export needed types in `packages/sql/src/exports/types.ts`.
9. Update `packages/sql/package.json` exports if needed.
10. Build, typecheck, run tests.

### M2: Metadata + refs + annotations

1. Extend `PlanMeta` in `packages/sql/src/types.ts` to include `refs?`, `annotations?`, optional `projection`.
2. Update raw factory to accept/pass `refs?`, `annotations?` through both forms.
3. Ensure immutability (freeze Plan and nested meta).
4. Unit tests:
   - Metadata presence/values when supplied.
   - `paramDescriptors` stability and order.
   - Optional `projection` pass-through.
5. Ensure public exports are complete.
6. Build, typecheck, tests.

### M3: Runtime wiring for lints/budgets

1. Add/extend runtime plugin in `packages/runtime/src` to register checks when `meta.lane === 'raw'`.
2. Best-effort checks (regex-based):
   - `LINT.SELECT_STAR` (error)
   - `LINT.NO_LIMIT` (warn)
3. Refs-dependent checks:
   - `LINT.UNINDEXED_PREDICATE` (warn)
   - `LINT.READ_ONLY_MUTATION` (error)
4. Budget heuristic:
   - Unbounded SELECT ⇒ `BUDGET.ROWS_EXCEEDED` per policy.
5. Optional EXPLAIN (no ANALYZE) gated by config to refine estimates.
6. Integration tests in `packages/runtime/test/runtime.integration.test.ts`:
   - Without refs: best-effort lints fire.
   - With refs: unindexed predicate and read-only mutation fire.
   - Budget heuristic blocks unbounded SELECT when configured.
   - EXPLAIN path refines estimates without changing Plan shape.
7. Ensure telemetry fingerprint is computed and carried in events (ADR 024).
8. Build, typecheck, tests.

### Docs + examples

1. Update `Slice-RawSQL-Lane.md` Acceptance with links to tests.
2. Add examples in `examples/prisma-next-demo` using both `root.raw` forms.
3. Verify `pnpm build` and run demo scripts locally.


## Prompts for a code-generation LLM (TDD, incremental)

Each prompt builds on the previous and references ADRs/docs. Use `pnpm` and repo conventions. Replace `<workspace>` with `/Users/wmadden/Projects/prisma/skunkworks/prisma-next-2` when executing locally.

### Prompt 1 — Raw lane scaffolding and template compilation

```text
You are working in a monorepo using pnpm and turborepo. Follow these repo conventions:
- Use arktype, not zod
- No file extensions in TypeScript imports
- Tests: omit the word “should” in descriptions
- Keep code immutable and strongly typed
- Export features through @prisma-next/sql

Goal:
Implement the Raw SQL lane template-tag form per ADR 012 and ADR 011. Compile to positional placeholders ($1..$n) and params array with correct order. Return an immutable Plan with minimal meta: lane, target, paramDescriptors.

Files to create/update:
- packages/sql/src/raw.ts
- packages/sql/src/sql.ts (wire raw into root = sql(contract))
- packages/sql/src/exports/sql.ts (public export)
- packages/sql/src/types.ts (add types used by raw if missing)
- packages/sql/test/raw.test.ts (new tests)

Plan shape (per ADR 011/013):
type RawPlan = {
  sql: string;
  params: unknown[];
  meta: {
    lane: 'raw';
    target: 'postgres';
    paramDescriptors: Array<{ index: number; name?: string; type?: string }>;
  };
}

Requirements:
- Implement a factory added to sql(contract) as root.raw (template tag)
- Template literal compilation: convert expressions to $1..$n placeholders
- params array order matches expression order
- paramDescriptors exist for each param with default names p1..pn
- Freeze the returned object to enforce immutability
- Do not implement function form yet
- Do not add lints/budgets here

Tests (packages/sql/test/raw.test.ts):
- Compiles placeholders correctly for 1, 2, and 3 params
- Preserves text around placeholders verbatim
- params order matches the expression order
- paramDescriptors length and default names p1..pn
- Plan object is immutable (Object.isFrozen)

Commands:
- pnpm -C packages/sql test
- pnpm -C packages/sql typecheck

References:
- docs/briefs/Slice-RawSQL-Lane.md API section
- ADR 011 (Unified Plan Model), ADR 012 (Raw SQL Escape Hatch)
```

### Prompt 2 — Function form (text + params) with metadata parity

```text
Extend the raw lane to support the function form per the brief:

API:
const plan = root.raw(
  'select id from "user" where id = $1 limit $2',
  { params: [userId, n], refs?: { tables?: string[] }, annotations?: Record<string, unknown> }
);

Tasks:
- Update packages/sql/src/raw.ts to add function form alongside the template tag.
- Preserve the SQL text exactly; do not recompile placeholders.
- Copy/extend Plan type: same minimal meta as template form for now (lane, target, paramDescriptors).
- For function form, build paramDescriptors in positional order p1..pn.
- Ensure both forms share implementation for building paramDescriptors and immutability.
- Update public exports if needed.

Tests (packages/sql/test/raw.test.ts):
- Function form preserves SQL text and params array order
- paramDescriptors length and default names p1..pn
- Both forms return frozen plans

Commands:
- pnpm -C packages/sql test
- pnpm -C packages/sql typecheck

References:
- docs/briefs/Slice-RawSQL-Lane.md API section
- ADR 011, ADR 012
```

### Prompt 3 — Full metadata: refs, annotations, projection

```text
Enhance Plan meta to include refs, annotations, optional projection per brief.

Tasks:
- In packages/sql/src/types.ts, define/augment PlanMeta to include:
  lane: 'raw', target: 'postgres', refs?: { tables?: string[]; indexes?: unknown }, annotations?: Record<string, unknown>, paramDescriptors, projection?: string[].
- Update raw.ts to accept and stamp refs and annotations for both forms. Allow optional projection for future use (pass-through only).
- Ensure all returned plans and nested objects are deeply immutable (freeze shallow; no mutation in code paths).

Tests:
- Add tests in packages/sql/test/raw.test.ts for:
  - refs and annotations presence when supplied
  - projection passes through when supplied
  - meta object is frozen

Commands:
- pnpm -C packages/sql test
- pnpm -C packages/sql typecheck

References:
- ADR 011 (meta shape), ADR 013 (plan identity), docs/briefs/Slice-RawSQL-Lane.md (Plan metadata)
```

### Prompt 4 — Export surface and typing polish

```text
Wire the raw lane through the public surface and ensure type exports.

Tasks:
- In packages/sql/src/sql.ts, ensure sql(contract) returns a root with raw available in both forms.
- Update packages/sql/src/exports/sql.ts to export the sql factory with raw.
- Update packages/sql/src/exports/types.ts to export RawPlan and related types.
- Verify package.json exports include the public entry points.

Tests:
- Add a high-level test in packages/sql/test/raw.test.ts that imports from the package entrypoint and exercises both forms successfully.

Commands:
- pnpm -C packages/sql build
- pnpm -C packages/sql typecheck
- pnpm -C packages/sql test

References:
- Architecture Overview, MVP Spec
```

### Prompt 5 — Runtime plugin: best-effort lints for raw lane

```text
Implement runtime lint plugin checks for raw lane (best-effort), per ADR 022.

Rules to implement:
- LINT.SELECT_STAR (error): detect select * ignoring case and whitespace.
- LINT.NO_LIMIT (warn): detect SELECT without LIMIT.

Tasks:
- Add/update a plugin module in packages/runtime/src to register lint checks for plans with meta.lane === 'raw'.
- Avoid changing the Plan shape; plugins consume Plan and produce lint results via existing runtime mechanisms.
- Keep detection robust but simple (regex with word boundaries and basic statement normalization).
- Ensure checks run pre-exec in the runtime flow.

Tests (packages/runtime/test/runtime.integration.test.ts):
- When executing a plan produced by raw lane without refs:
  - SELECT * triggers LINT.SELECT_STAR error
  - SELECT without LIMIT triggers LINT.NO_LIMIT warn

Commands:
- pnpm -C packages/runtime typecheck
- pnpm -C packages/runtime test

References:
- ADR 022 (Lint Rule Taxonomy), docs/briefs/Slice-RawSQL-Lane.md (Lints & Budgets)
```

### Prompt 6 — Runtime plugin: refs-powered lints

```text
Add refs-dependent lint checks for raw lane per brief:

Rules:
- LINT.UNINDEXED_PREDICATE (warn): warn if predicate fields used in WHERE have no index in refs.
- LINT.READ_ONLY_MUTATION (error): if refs/annotations indicate read-only intent but SQL is mutating (INSERT/UPDATE/DELETE/DDL).

Tasks:
- Extend the raw lane plugin introduced earlier to:
  - Consult plan.meta.refs for table/index metadata.
  - Perform minimal SQL statement classification (SELECT vs DML/DDL).
  - Cross-check annotations.intent === 'read'|'report' etc. to gate read-only mutation errors.
- Do not modify plan; only produce lint findings.

Tests:
- Update packages/runtime/test/runtime.integration.test.ts to cover:
  - With refs supplied, UNINDEXED_PREDICATE warns.
  - With annotations indicating read-only, DML triggers READ_ONLY_MUTATION error.

Commands:
- pnpm -C packages/runtime typecheck
- pnpm -C packages/runtime test

References:
- ADR 022, ADR 011 (meta.refs), docs/briefs/Slice-RawSQL-Lane.md
```

### Prompt 7 — Runtime budgets: heuristic and config

```text
Implement pre-exec budget heuristic for raw lane per ADR 023.

Behavior:
- Treat SELECT without LIMIT as BUDGET.ROWS_EXCEEDED per policy (error/warn configurable).
- Do not modify Plan; budget results integrate with runtime’s budget evaluation.

Tasks:
- Extend the raw lane plugin to:
  - Check for missing LIMIT on SELECT statements.
  - Emit a budget finding that the runtime maps to policy actions.
- Make severity configurable via existing runtime config mechanisms.

Tests:
- Add cases to packages/runtime/test/runtime.integration.test.ts:
  - Unbounded SELECT triggers budget finding and blocks execution when policy is error.

Commands:
- pnpm -C packages/runtime typecheck
- pnpm -C packages/runtime test

References:
- ADR 023 (Budget Evaluation), docs/briefs/Slice-RawSQL-Lane.md
```

### Prompt 8 — Optional EXPLAIN integration (no ANALYZE)

```text
Add optional EXPLAIN (no ANALYZE) integration to refine estimates for budgets.

Constraints:
- Only when enabled via runtime config.
- Do not change Plan shape; attach findings to budget evaluation path.
- Use driver/adapter plumbing already present; do not add new dependencies.

Tasks:
- In packages/runtime, add a code path that, when config enabled and lane === 'raw', issues EXPLAIN for the plan.sql with plan.params.
- Parse EXPLAIN result minimally to derive estimated rows and feed into budget evaluation.
- Ensure Postgres target only.

Tests:
- Integration tests that simulate EXPLAIN enabled and confirm:
  - Budget evaluation uses refined estimates.
  - Plan shape remains unchanged.

Commands:
- pnpm -C packages/runtime typecheck
- pnpm -C packages/runtime test

References:
- ADR 023, ADR 011, docs/briefs/Slice-RawSQL-Lane.md
```

### Prompt 9 — Telemetry fingerprint and stable error codes

```text
Integrate telemetry fingerprint and stable error codes for raw lane.

Tasks:
- Ensure runtime computes a normalized sqlFingerprint for raw lane plans per ADR 024 (normalize whitespace, literals, identifiers consistently).
- Ensure lint/budget errors use stable codes per ADR 027.
- Verify telemetry events include lane, target, fingerprint, and lint/budget outcomes.

Tests:
- Add tests in packages/runtime/test to verify:
  - same SQL with different literals yields the same fingerprint
  - emitted errors carry stable codes
  - telemetry payload contains expected fields

Commands:
- pnpm -C packages/runtime typecheck
- pnpm -C packages/runtime test

References:
- ADR 024 (Telemetry Schema), ADR 027 (Error Envelope), ADR 011/012
```

### Prompt 10 — Examples and docs wiring

```text
Finalize examples and docs for the raw lane.

Tasks:
- Add example usage to examples/prisma-next-demo:
  - Template form and function form samples with params.
  - A case with refs and annotations.
- Update docs:
  - Link tests in docs/briefs/Slice-RawSQL-Lane.md Acceptance section.
  - Add short section to Architecture Overview to note raw lane parity.
- Ensure @prisma-next/sql export surface includes raw and external consumers can import it.

Verification:
- pnpm build at repo root
- Run the demo script(s) to validate end-to-end behavior.

References:
- docs/briefs/Slice-RawSQL-Lane.md
- Architecture Overview, MVP Spec
```


## Testing best practices

- Unit tests in `packages/sql` validate compilation and metadata only; no DB calls.
- Integration tests in `packages/runtime` validate lint and budget plugins; use controlled inputs.
- Keep tests concise, deterministic, and independent; follow repo’s `it("...")` style without “should”.
- Prefer clear fixtures for `refs` and sample SQL; avoid overfitting regexes.
- CI fast feedback: run typecheck and tests for touched packages via `pnpm -C <pkg> typecheck` and `pnpm -C <pkg> test`.
