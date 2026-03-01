# ADR 126 — PSL top-level block SPI

## Context

We want third-party packs to add first-class domain constructs to PSL, such as `pg.view`, `pg.materializedView`, or `pg.enumType`. Today PSL does not allow external authors to register new top-level blocks or define new block-level attributes. Without an extension SPI, every new database concept forces a core change, which conflicts with our thin-core, fat-targets approach.

Additionally, we need a clear distinction between:
- **Top-level blocks**: standalone constructs with stable identities (views, storage enums) — pack-owned
- **Decorators/attributes**: metadata on existing core entities (columns, indexes, tables) — also pack-owned

## Problem

- PSL syntax is currently closed to extension; packs can only decorate core entities
- Views and storage enums are widely used but vary across targets; they belong in packs, not core
- Without a formal SPI, the emitter has no standard way to consume pack-provided blocks
- Extensions need deterministic, schema-validated representation in `contract.json` with stable identities for verification and migration

## Decision

Introduce a **PSL Extension SPI** that allows packs to register:
1. New top-level blocks with their own grammar, validation, and deterministic emission
2. New attributes that can attach to existing blocks (already partially supported via ADR 104 decorators)
3. A pure transformation from parsed PSL fragments to canonical, deterministic JSON under `contract.extensionPacks.<namespace>.*`

Top-level blocks remain pack-owned objects and do not enlarge core. Core may reference them indirectly through stable identifiers where necessary (e.g., migrations, read-only sources).

## Details

### Distinction: Top-Level Blocks vs Decorators

**Top-level blocks** (pack-owned)
- Declared at file root, one per definition
- Each produces a standalone, addressable object with a stable `id`
- Examples: `pg.view MyActiveUsers { ... }`, `pg.enumType UserStatus { ... }`
- Emit canonical JSON under `contract.extensionPacks.<namespace>.<kind>[]`
- May project into **types-only** surfacing for queries (lane/adapter-owned) or contribute to planning/migrations via pack ops
- Contribute to contract hash per ADR 106 canonicalization rules

**Decorators/attributes** (also pack-owned)
- Attach to existing core entities: `model`, `table`, `index`, `column`, `@id`, etc.
- Do not introduce a new top-level identity
- Example: `@pg.type("user_status")` on a column, `@@pg.predicate("active = true")` on an index
- Emit augmentations/metadata via the extension encoder (decorations under `contract.extensionPacks.<ns>.decorations`)
- Validated against pack schemas, canonicalized per ADR 106

### Block Registration API

Emitter exposes a registration interface for packs to hook in:

```typescript
interface BlockRegistry {
  registerTopLevelBlock(params: {
    kind: string                    // e.g., "view", "materializedView", "enumType"
    namespace: string               // e.g., "postgres" (must match pack namespace)
    parseFn: (tokens: TokenStream) => BlockAST | null
    validateFn: (ast: BlockAST, context: ValidationContext) => Diagnostic[]
    emitFn: (ast: BlockAST, context: EmitContext) => {
      json: unknown                 // canonical JSON for contract.extensionPacks.<ns>.<kind>[]
      id: string                    // stable id computed from canonical content + name
      typeProjections?: { [logicalName: string]: unknown }  // optional types-only surfacing (non-canonical)
    }
    schema: JSONSchema              // for validation and documentation
  }): void
}
```

### Parsing

- Parser is invoked with a `TokenStream` positioned at block keyword (e.g., `pg.view`)
- Parser responsibility: consume tokens, validate grammar, and return a structured AST
- Parser must be **pure** (no I/O, no environment access, no side effects)
- Parse errors include source spans for IDE diagnostics

Example parser implementation (pseudo-code):

```typescript
function parsePgView(tokens: TokenStream): BlockAST | null {
  const name = tokens.peek() === 'IDENT' ? tokens.take().value : null
  if (!name) return null

  tokens.expect('{')
  const body = parseBlockBody(tokens)  // parse schema, sql, shape, etc.
  tokens.expect('}')

  return { kind: 'pg.view', name, body }
}
```

### Validation

- Validate AST structure and semantic constraints independently
- No target system calls or environment access
- Return structured diagnostics with source spans for IDE integration
- Examples: check that SQL is non-empty, that references in `dependsOn` are resolvable within the same PSL file, that shape types are valid codecs

### Emission

- Transform validated AST into canonical JSON for `contract.extensionPacks.<ns>.<kind>[]`
- Compute a stable `id` from fully-qualified name and content hash
- Optionally emit source projections (read-only sources) for DSL consumption
- All outputs must be JSON-serializable and deterministically canonicalized per ADR 010 and ADR 106

Example emission:

```typescript
function emitPgView(ast: BlockAST, context: EmitContext): EmitResult {
  const json = {
    name: ast.name,
    schema: ast.body.schema,
    sql: ast.body.sql,
    shape: ast.body.shape,
    dependsOn: ast.body.dependsOn,
    materialized: false
  }

  // Stable id based on hash of canonical JSON
  const id = `pg.view:${ast.name}@${contentHash(json)}`

  // Optional: project as a read-only source for the DSL
  const sourceProjections = ast.body.shape ? {
    [ast.name]: {
      projection: ast.body.shape,
      origin: { namespace: 'postgres', kind: 'view', id }
    }
  } : {}

  return { json, id, sourceProjections }
}
```

### Namespacing and Identity

- Every pack declares a namespace like `postgres`, `mongo`, or `pgvector`
- Top-level block kinds are fully qualified: `postgres.view`, `postgres.enumType`
- Stable `id` computation includes fully-qualified name and content hash for conflict prevention and linking
- Multiple blocks of the same kind are allowed; each has a unique name and id

### Purity and Determinism

- Parsers, validators, and emitters must be **pure and side-effect free**
- No filesystem, network, environment access, or external function calls
- All outputs must be JSON-serializable and deterministic
- Any nondeterminism is a pack error and fails emission with a clear diagnostic

### Linking to Core

- Packs may reference core entities using stable names (e.g., table names in `dependsOn`)
- Core may reference extension objects by origin: `{ namespace, kind, id }` where necessary (e.g., when publishing read-only sources)
- Cross-pack references are disallowed in MVP; future versions can introduce controlled cross-namespace linking

### Capabilities

- Packs declare capability keys they enable, e.g., `postgres.view.base`, `postgres.view.materialized`, `postgres.enumType.storage`
- Capabilities surface in `contract.capabilities` for negotiation by lanes, runtime, and adapters per ADR 117
- Block registration must declare required and optional capabilities

### Validation and Error Taxonomy

- All pack-produced JSON is validated against pack-provided JSON Schema at emit time
- Emitter tracks parse/validate/emit errors with stable codes, source spans, and remediation hints
- Block misuse on unsupported targets produces a structured error per ADR 027

New error codes:
- `EMIT_BLOCK_UNKNOWN_NAMESPACE` — namespace not pinned in extensions
- `EMIT_BLOCK_PARSE_ERROR` — syntax error in block
- `EMIT_BLOCK_VALIDATION_ERROR` — semantic validation failed
- `EMIT_BLOCK_SCHEMA_VIOLATION` — emitted JSON fails pack schema
- `EMIT_BLOCK_DUP_NAME` — duplicate block name within file
- `EMIT_BLOCK_CAPABILITY_UNSUPPORTED` — block requires unavailable capability

### Watch Mode and Dev Experience

- Dev auto-emit (ADR 032) reloads packs and re-parses only changed blocks
- Diagnostics surface in IDE and terminal with file/line context
- Parse/validate errors appear inline with immediate remediation hints

### Versioning

- Packs declare semver and target SPI version
- Contract embeds `extensions.<ns>.version` for reproducibility, planning, and preflight bundling
- SPI version enables future changes to `BlockRegistry` without breaking older packs

### Security

- Extension code executes within the emitter process but must remain pure
- No dynamic code generation, eval, or WASM
- Pack loading honors project allow-lists (per ADR 100)
- Preflight (hosted or local) validates pack integrity via SHA-256 hashes

### TS-First Parity

The TS builder must support the same blocks via typed helpers:

```typescript
import { defineContract } from '@prisma/contract-core'
import { postgres } from '@prisma/pack-postgres'

const contract = defineContract({
  tables: { /* ... */ },
  blocks: {
    pgViews: [
      postgres.view('active_users', {
        sql: `select id, email from "user" where active = true`,
        shape: { id: 'int4', email: 'text' }
      })
    ]
  }
})
```

- TS-first builders emit identical canonical JSON to PSL for the same inputs
- Lint rules enforce determinism and forbid dynamic values in TS-first authoring per ADR 096

## Consequences

### Positive
- Core remains small while packs add rich domain features
- Deterministic artifacts enable CI, preflight, and agent workflows
- Clear SPI enables community contributions
- Top-level blocks get stable identities for linking and migration

### Negative
- Pack authors bear responsibility for clear schemas and validation logic
- Requires coordination between parse, validate, and emit phases
- Adds complexity to emitter and LSP integration

### Trade-offs
- Purity constraints (no I/O, no dynamic code) limits expressiveness but ensures safety and determinism
- Block registration happens at emit time, not parse time, so packs must be pre-loaded

## Open Questions

- Should we support conditional block registration based on adapter capabilities?
- How do we handle forward compatibility when a pack adds new block types in a minor version?
- Should blocks be allowed to contribute migrations directly, or only via pack ops?
- Cross-namespace references: what conditions allow a block to reference another pack's construct?

## References

- **ADR 010** — Canonicalization rules for contract.json
- **ADR 027** — Error envelope stable codes
- **ADR 032** — Dev auto-emit integration
- **ADR 096** — TS-authored contract parity & purity rules
- **ADR 100** — CI contract emission trust model
- **ADR 104** — PSL extension namespacing & syntax
- **ADR 105** — Contract extension encoding
- **ADR 106** — Canonicalization for extensions
- **ADR 116** — Extension-aware migration ops
- **ADR 117** — Extension capability keys
- **Doc 2** — Contract Emitter & Types
- **Doc 12** — Ecosystem Extensions & Packs
