# Agents — Prisma Next

Welcome. This is a contract‑first, agent‑friendly data layer.

## Start Here

- [Docs Index](docs/README.md) — How the docs are organized and what to read next
- [Architecture Overview](docs/Architecture%20Overview.md) — High-level design principles
- [Testing Guide](docs/Testing%20Guide.md) — Philosophy, patterns, and commands
- [Rules Index](.cursor/rules/README.md) — All Cursor rules organized by topic
- [ADRs](docs/architecture%20docs/adrs/) — Architecture Decision Records

### Modular Onboarding

- [Getting Started](docs/onboarding/Getting-Started.md) — Build, test, and run demo
- [Repo Map & Layering](docs/onboarding/Repo-Map-and-Layering.md) — Package organization and import rules
- [Conventions](docs/onboarding/Conventions.md) — TypeScript, tooling, and code style
- [Testing](docs/onboarding/Testing.md) — Test commands, patterns, and organization
- [Common Tasks Playbook](docs/onboarding/Common-Tasks-Playbook.md) — Add operation, split monolith, fix import

## Project Overview

**Prisma Next** is a contract-first data access layer:

- **Contract-first**: Emit `contract.json` + `contract.d.ts` — no executable runtime code generation
- **Composable DSL**: Type-safe query builder (`sql().from(...).select(...)`)
- **Machine-readable**: Structured artifacts that agents can understand and manipulate
- **Runtime verification**: Contract hashes and guardrails ensure safety before execution

## Golden Rules

- **Node.js version**: Use the shell's Node. Do not run nvm/fnm or any version switcher. Source of truth is root `package.json` `engines.node`. If the shell's version is wrong or commands fail, report that the shell is misconfigured and the user should configure their environment to satisfy `engines.node`.
- Use pnpm and local scripts (not ad‑hoc `tsc`, `jest`): `.cursor/rules/use-correct-tools.mdc`
- Don't branch on target; use adapters: `.cursor/rules/no-target-branches.mdc`
- Keep tests concise; omit "should": `.cursor/rules/omit-should-in-tests.mdc`
- Keep docs current (READMEs, rules, links): `.cursor/rules/doc-maintenance.mdc`
- Prefer links to canonical docs over long comments

## Common Commands

```bash
pnpm build                 # Build via Turbo
pnpm test:packages         # Run package tests
pnpm test:e2e              # Run e2e tests
pnpm test:integration      # Run integration tests
pnpm test:all              # Run all tests
pnpm coverage:packages     # Coverage (packages only)
pnpm lint:deps             # Validate layering/imports
```

## Core Concepts

### Contract Flow

1. **Authoring**: Write `schema.psl` or use TypeScript builders → canonicalized Contract IR
2. **Emission**: Emitter validates and generates `contract.json` + `contract.d.ts`
3. **Validation**: `validateContract<Contract>(json)` validates structure and returns typed contract
4. **Usage**: DSL functions (`sql()`, `schema()`) accept contract and propagate types

### Key Patterns

- **Type Parameter Pattern**: JSON imports lose literal types. Use `.d.ts` for precise types, `validateContract()` for runtime validation
- **ExecutionContext**: Encapsulates contract, codecs, operations, and types. Pass to `schema()`, `sql()`, `orm()`
- **Interface-Based Design**: Export interfaces and factory functions, not classes
- **Capability Gating**: Features like `includeMany` and `returning()` require capabilities in contract

### Package Organization

Organized by **Domains → Layers → Planes**:

- **Domains**: Framework (target-agnostic), SQL, Document, Targets, Extensions
- **Layers**: Core → Authoring → Tooling → Lanes → Runtime → Adapters
- **Planes**: Migration, Runtime, Shared

See `architecture.config.json` for the complete mapping and `pnpm lint:deps` to validate.

## Quick Reference

### Query Pattern

```typescript
import postgres from '@prisma-next/postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const db = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL']!,
});

const tables = db.schema.tables;
const plan = db.sql
  .from(tables.user)
  .select({ id: tables.user.columns.id, email: tables.user.columns.email })
  .limit(10)
  .build();
```

### Contract Validation

```typescript
// CRITICAL: Type parameter must be the fully-typed Contract from contract.d.ts
const contract = validateContract<Contract>(contractJson);
```

## Common Pitfalls

1. **Don't infer types from JSON** — Use type parameter pattern with `.d.ts`
2. **validateContract requires fully-typed Contract** — NOT generic `SqlContract<SqlStorage>`
3. **Type canonicalization happens at authoring time** — Not during validation
4. **No target-specific branches in core** — Use adapters instead
5. **Builder chaining** — Methods return new instances, always chain calls
6. **Column access** — Use `table.columns.fieldName` to avoid conflicts with table properties

## Boundaries & Safety Rails

- No backward‑compat shims; update call sites instead: `.cursor/rules/no-backward-compatibility.md`
- Package layering is enforced; fix violations rather than bypassing: `scripts/check-imports.mjs` and `.cursor/rules/import-validation.mdc`
- Capability‑gated features must be enabled in contract capabilities

## Frequent Tasks

- Add SQL operation: `docs/briefs/complete` and `.cursor/plans/add-sql-operation.md`
- Split monolith into modules: `.cursor/plans/split-into-modules.md`
- Fix import violation: `.cursor/plans/fix-import-violation.md`
- Shape and deliver a project (spec → plan → implement): `.agents/rules/drive-project-workflow.mdc` (artifacts live under `projects/`, see `projects/README.md`)

## Subsystem Deep Dives

See `docs/architecture docs/subsystems/`:

1. **Data Contract** — Contract structure and semantics
2. **Contract Emitter & Types** — How contracts are generated
3. **Query Lanes** — SQL DSL, ORM, Raw SQL surfaces
4. **Runtime & Plugin Framework** — Execution pipeline and plugins
5. **Adapters & Targets** — Postgres adapter, capability gating
6. **Error Handling** — Error envelope and stable codes
7. **Migration System** — Schema migrations

## Ask First

- Significant refactors to rule scope (`alwaysApply`) or architecture docs
- Changes that affect demo, examples, or CI

---

**Remember**: This is a prototype. Focus on clear docs that reflect implemented behavior.
