# Extension Packs — Naming and Layout Conventions

Purpose: define a consistent convention for naming, placing, and describing extension packs across domains.

## NPM Package Name
- Prefer `@prisma-next/ext-<name>`
  - Examples: `@prisma-next/ext-pgvector`, `@prisma-next/ext-postgis`, `@prisma-next/ext-views`
- Include domain only when necessary to avoid ambiguity (rare): `@prisma-next/ext-sql-views`

## Filesystem Location
- Place under domain-specific folder:
  - SQL: `packages/extensions/sql/<name>` (e.g., `packages/extensions/sql/pgvector`)
  - Framework-wide packs (if any): `packages/extensions/framework/<name>`
  - Future domains (document, etc.): `packages/extensions/<domain>/<name>`

## Required package.json Metadata
Add the following fields to support discovery and guardrails:
```json
{
  "name": "@prisma-next/ext-<name>",
  "prismaNext": {
    "family": "sql",            // or "framework", "document"
    "dialects": ["postgres"],    // if domain-specific
    "type": "extension-pack"     // reserved values: extension-pack
  }
}
```

## Minimal Source Layout
```
packages/extensions/<domain>/<name>/
  package.json
  README.md
  src/
    index.ts         // exports the pack
    manifest.ts      // pack manifest (ops/types/codecs/migration hooks)
    codecs.ts        // runtime codecs (if applicable)
    <domain>/        // domain-specific assets, e.g. sql/
      operations.ts
      contract-types.ts
      migration-hooks.ts
```

## Integration Points
- Authoring/Targets: packs contribute ops/types manifests
- Lanes/Runtime: packs expose codecs and are auto-registered by runtime composition
- Tooling (Migration Plane): optional planner/preflight hooks

## Guardrails
- Packs import only via documented SPI of framework/sql packages
- No pack may import from `e2e/**` or `examples/**`
- Domain boundaries remain enforced via `architecture.config.json`

## Rationale
This convention keeps imports short and memorable, keeps the repo navigable, and scales across domains without overly verbose NPM names. Metadata enables automated loading and validation.

