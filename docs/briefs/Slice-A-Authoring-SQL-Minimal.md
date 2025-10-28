# Slice A — Authoring Workflow (Minimal SQL DSL, Offline)

See also the [MVP Spec](../MVP-Spec.md) of which this slice is a part.

Objective: Deliver a production-viable foundation for the authoring workflow with a minimal SQL DSL, deterministic Plan generation, and a Postgres-specific lowerer — all testable offline. This slice optimizes for fast unit tests and establishes the seams for adapters and runtime.

## Scope
- Minimal SQL DSL (single-table SELECT) with explicit `.build()` producing immutable Plans
- Contract-backed build-time validation (unknown table/column → PLAN.INVALID)
- Postgres adapter (lowerer) that renders canonical SQL and positional params `$1..$n`
- Plan metadata and parameter descriptors for diagnostics
- Static Postgres `contract.json` fixture for tests (no emitter yet)

Out of scope (future slices): runtime execution, lints/budgets, joins, ORM reshape, migrations.

## References
- [Architecture Overview](../Architecture%20Overview.md)
- [Runtime & Plugin Framework](../architecture%20docs/subsystems/4.%20Runtime%20%26%20Plugin%20Framework.md)
- [Adapters & Targets](../architecture%20docs/subsystems/5.%20Adapters%20%26%20Targets.md)
- [Data Contract](../architecture%20docs/subsystems/1.%20Data%20Contract.md)
- [ADR 011 — Unified Plan Model](../architecture%20docs/adrs/ADR%20011%20-%20Unified%20Plan%20Model.md)
- [ADR 002 — Plans are Immutable](../architecture%20docs/adrs/ADR%20002%20-%20Plans%20are%20Immutable.md)
- [ADR 003 — One Query One Statement](../architecture%20docs/adrs/ADR%20003%20-%20One%20Query%20One%20Statement.md)
- [ADR 027 — Error Envelope & Stable Codes](../architecture%20docs/adrs/ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md)

## Deliverables
- Package updates/new:
  - `@prisma/sql` (extend): minimal SQL builder and AST types
  - `@prisma/adapter-spi` (new): types-only SPI (AdapterProfile, Lowerer, Driver signatures)
  - `@prisma/adapter-postgres` (new): Postgres lowerer (factory + class), golden-tested rendering
- Tests:
  - Offline unit tests for DSL → AST → Postgres SQL (goldens)
  - Build-time validation against contract (unknown refs → PLAN.INVALID)
  - Parameter descriptors ordering and typing metadata

## API Shape
### SQL DSL (slice A)
- Chain
  - `from(table)` → `where(expr)` → `select(fields|aliasMap)` → `orderBy(expr.dir())` → `limit(n)` → `build()`
- Projection
  - `select('id','email')` and `select({ id: 'ID', email: 'userEmail' })`
- Comparison
  - `t.user.id.eq(param('userId'))`

### AST (slice A)
- Select
  - `{ kind: 'select', from: TableRef, where?: Expr, project: Array<{ alias: string, expr: Expr }>, orderBy?: Array<{ expr: Expr, dir: 'asc'|'desc' }>, limit?: number }`
- Expr
  - ColumnRef `{ kind: 'col', table: string, column: string }`
  - ParamRef `{ kind: 'param', index: number }` (positional)
  - Binary `{ kind: 'bin', op: 'eq', left: Expr, right: Expr }`
- TableRef
  - `{ kind: 'table', name: string }` (uses storage names from `contract.storage`)

### Plan (slice A)
- Execution payload (opaque to runtime for now):
  - `plan.sql: string` (rendered by Postgres lowerer)
  - `plan.params: unknown[]` (positional; `$1..$n`)
- Metadata (for verification/diagnostics):
  - `plan.meta = {
      target: 'postgres',
      coreHash: string,
      profileHash?: string,
      lane: 'dsl',
      refs: { tables: string[], columns: Array<{ table: string; column: string }> },
      projection: Record<string,string>,
      annotations?: Record<string,unknown>,
      paramDescriptors: Array<{ name?: string; type?: string; nullable?: boolean; source: 'dsl'|'raw'; refs?: { table: string; column: string } }>
    }`

### Errors
- Build-time validation errors use ADR 027 codes:
  - `PLAN.INVALID` (e.g., unknown table/column in `from`/`select`/`where`)

## Adapter SPI (slice A)
- Package: `@prisma/adapter-spi` (types-only)
  - `AdapterProfile = { id: string; target: 'postgres'; capabilities: Record<string,unknown> }`
  - `Lowerer = (queryAst, contract) => { sql: string; params: unknown[]; annotations?: Record<string,unknown> }`
  - `Driver` present in SPI but not implemented in this slice (execution out of scope)

## Postgres Adapter (slice A)
- Package: `@prisma/adapter-postgres`
- Export both:
  - `createPostgresAdapter(options?)` factory returning a frozen object
  - `class PostgresAdapter` for subclassing/overrides (e.g., DDL-enabled variants)
- Lowering responsibilities (subset):
  - Deterministic identifier quoting with double quotes; use storage names
  - Stable alias rendering and whitespace normalization (for golden tests)
  - Positional params `$1..$n` in SQL; preserve param order from AST
  - ORDER BY and LIMIT rendering

## Contract Fixture
- Static `contract.json` in tests with:
  - `target: 'postgres'`, tables: `user`, columns: `id`, `email`, `createdAt`, mapping matches PSL defaults
  - Core/profile hashes can be placeholders for offline unit tests

## Tests
### Unit (offline, fast)
- DSL → AST: projection, where eq, orderBy desc, limit
- AST → SQL (golden): quoting, aliasing, `$n` ordering, `LIMIT`/`ORDER BY`
- Contract validation: unknown table/column yields `PLAN.INVALID`
- Plan.meta correctness: `refs`, `projection`, `paramDescriptors` ordering

### Type-level (optional at this slice)
- Minimal types for `schema(contract).tables` exposure may be validated via tsd later; focus here is structural rendering

## Milestones & Timeline
- M1 DSL skeleton & AST types (2d)
- M2 Build-time contract validation & Plan.meta shapes (2d)
- M3 Postgres lowerer with golden tests (3d)
- M4 Polish & docs, ready for integration slice (1d)

## Risks & Mitigations
- Risk: AST/Plan fields expand later → Keep metadata additive; avoid breaking shapes
- Risk: Identifier mapping (model vs storage) → Enforce storage-only in this slice; add model helpers later
- Risk: Param name ergonomics → Use `paramDescriptors` to retain names while binding positionally

## Acceptance Criteria (slice A)
- Given a valid table/columns, `.build()` produces a Plan with deterministic SQL and positional params matching goldens
- Invalid refs produce `PLAN.INVALID` with actionable messages
- Plan.meta includes `target`, `coreHash`, `refs`, `projection`, and `paramDescriptors`
- All tests run offline and pass deterministically
