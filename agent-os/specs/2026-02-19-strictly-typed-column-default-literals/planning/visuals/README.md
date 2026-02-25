# Visuals

## Typed default lifecycle

```mermaid
flowchart LR
  authoringInput[AuthoringDefaultInput]
  contractBuilder[ContractTsBuilderEncode]
  contractJson[ContractJson]
  validateDecode[ValidateContractDecode]
  runtimeUsage[RuntimeAndQueryLanes]
  schemaIntrospection[DbSchemaDefaults]
  defaultNormalizer[PostgresDefaultNormalizer]
  schemaVerify[SchemaVerifyComparison]
  migrationPlanner[MigrationPlannerRender]
  ddlSql[RenderedDDL]

  authoringInput --> contractBuilder
  contractBuilder --> contractJson
  contractJson --> validateDecode
  validateDecode --> runtimeUsage

  schemaIntrospection --> defaultNormalizer
  defaultNormalizer --> schemaVerify
  contractJson --> schemaVerify

  contractJson --> migrationPlanner
  migrationPlanner --> ddlSql
```

## Encoding and decoding rules

- `bigint` literal defaults encode to tagged JSON objects and decode back to runtime `BigInt`.
- `Date` literal defaults encode to ISO strings and decode to `Date` for temporal columns.
- JSON-safe literals remain JSON values in `contract.json`.
- Postgres planner renders typed literals to SQL using type-aware escaping/stringification.
