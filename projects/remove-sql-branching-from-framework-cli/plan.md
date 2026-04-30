# Plan — Remove SQL-specific branching from framework CLI commands

**Spec:** [`spec.md`](spec.md)
**Linear:** [TML-2251](https://linear.app/prisma-company/issue/TML-2251)

## Shape

Single PR, three sequenced milestones, then close-out.

| Milestone | Plan | Achieves |
|---|---|---|
| M1 — Printer accepts `PslDocumentAst` | [`plans/m1-printer-accepts-psl-ast.md`](plans/m1-printer-accepts-psl-ast.md) | A6, A7 |
| M2 — `PslContractInferCapable` and CLI cleanup | [`plans/m2-psl-contract-infer-capable.md`](plans/m2-psl-contract-infer-capable.md) | A1, A2, A3 |
| M3 — `OperationPreviewCapable` and `sql` rename | [`plans/m3-operation-preview-capable.md`](plans/m3-operation-preview-capable.md) | A1, A4, A5 |
| Close-out | [`plans/close-out.md`](plans/close-out.md) | A8, A9, A10 (final verification) |

The milestones land as separate commits (or commit groups) inside one PR. They are sequenced because:

- M1 changes the printer's public surface; M2 needs the new printer signature.
- M2 introduces capability infrastructure; M3 reuses the same infrastructure for a second capability.
- Each milestone leaves the codebase in a consistent state with passing tests for the in-scope subset; M1 is the only one with a temporary friction point (`contract infer` is briefly broken or shimmed at the end of M1; M2 fixes it).

## Pattern reference

Every new capability in this project follows the existing `SchemaViewCapable` pattern in `packages/1-framework/1-core/framework-components/src/control-capabilities.ts`. Every task that introduces a capability touches the same five places:

1. **View type** in a framework-domain package (`framework-components` for `OperationPreview`; `psl-parser` or `psl-types` for `PslDocumentAst`).
2. **Capability interface + type predicate** in `framework-components/src/control-capabilities.ts`.
3. **Export** from `framework-components/src/exports/control.ts`.
4. **Family implementation** on the family instance (SQL: `packages/2-sql/9-family/src/core/control-instance.ts`; Mongo: `packages/2-mongo-family/9-family/src/core/control-instance.ts`).
5. **Client delegation method** on `ControlClient` (`packages/1-framework/3-tooling/cli/src/control-api/client.ts` + types in `control-api/types.ts`).

The per-milestone plans refer to this as "the capability five-step".

## Tests-first discipline

Per `AGENTS.md`: "Always write tests before creating or modifying implementation". Each task in the per-milestone plans names its tests up front and writes them first.

## Acceptance check (run during close-out)

The close-out milestone runs these mechanical checks against the merged state:

```bash
# A1: no familyId === '...' string compares in framework CLI
rg "familyId\\s*===" packages/1-framework/3-tooling/cli/src/

# A2 + A3: no SQL-domain or psl-printer/postgres imports in inspect-live-schema or contract-infer
rg "@prisma-next/(sql-|psl-printer/postgres)" \
   packages/1-framework/3-tooling/cli/src/commands/inspect-live-schema.ts \
   packages/1-framework/3-tooling/cli/src/commands/contract-infer.ts

# A4: no SQL DDL helpers in framework CLI
rg "extractSqlDdl|extract-sql-ddl|extractOperationStatements" packages/1-framework/3-tooling/cli/src/

# A6: psl-printer's old SQL-flavoured exports are gone
rg "validatePrintableSqlSchemaIR|PslPrintableSqlSchemaIR|createPostgresDefaultMapping|createPostgresTypeMap|parseRawDefault" \
   packages/1-framework/2-authoring/psl-printer/src/

# A7: psl-printer doesn't import sql-schema-ir
rg "@prisma-next/sql-schema-ir" packages/1-framework/2-authoring/psl-printer/

# A8: layering clean
pnpm lint:deps

# A9: tests pass
pnpm test:packages
```

Each command should print no matches (or, for `pnpm lint:deps` / `pnpm test:packages`, exit 0).

## Defaults applied (from open questions in spec)

- **OQ-1**: Try `framework-components` → `psl-parser` first; fall back to `@prisma-next/psl-types` foundation package if `pnpm lint:deps` flags it.
- **OQ-2**: `inferPslContract(schemaIR: unknown)` — symmetric with `toSchemaView`.
- **OQ-3**: `language` is a free-form string.
- **OQ-4**: Formatter output is byte-identical to today.
