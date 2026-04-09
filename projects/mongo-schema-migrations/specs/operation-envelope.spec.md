# Operation Envelope and Serialization SPI

## Context

Migration operations carry family-specific content — SQL operations contain SQL strings, Mongo operations contain DDL command AST nodes and filter expression checks. The framework currently defines `MigrationPlanOperation` as a minimal envelope (`id`, `label`, `operationClass`) and lets each family extend it with family-specific fields. SQL extends it with `precheck[].sql`, `execute[].sql`, `postcheck[].sql`. Mongo extends it with typed AST nodes in the same three-phase structure.

This spec defines the Mongo operation envelope and serialization approach, designed so the three-phase pattern (precheck/execute/postcheck) can later be extracted into a framework generic.

## Target design

The ideal framework design (to be extracted in a follow-up):

```typescript
interface MigrationPlanOperation<TStep, TCheck> {
  readonly id: string;
  readonly label: string;
  readonly operationClass: MigrationOperationClass;
  readonly precheck: readonly TCheck[];
  readonly execute: readonly TStep[];
  readonly postcheck: readonly TCheck[];
}
```

SQL would instantiate this as `MigrationPlanOperation<SqlStep, SqlCheck>` where `SqlStep = { description: string; sql: string }`. Mongo would use `MigrationPlanOperation<MongoMigrationStep, MongoMigrationCheck>`.

The serialization SPI would be:

```typescript
interface MigrationOperationSerializer<TStep, TCheck> {
  serializeStep(step: TStep): Record<string, unknown>;
  serializeCheck(check: TCheck): Record<string, unknown>;
  deserializeStep(json: Record<string, unknown>): TStep;
  deserializeCheck(json: Record<string, unknown>): TCheck;
}
```

The framework would handle the envelope (`id`, `label`, `operationClass`, array structure), delegating the content of each step/check to the family-provided serializer.

## M1 approach

For M1, we build the Mongo-specific types with this shape in mind but don't change the framework.

### Mongo operation types

```typescript
interface MongoMigrationCheck {
  readonly description: string;
  readonly source: AnyMongoInspectionCommand;
  readonly filter: MongoFilterExpr;
  readonly expect: 'exists' | 'notExists';
}

interface MongoMigrationStep {
  readonly description: string;
  readonly command: AnyMongoDdlCommand;
}

interface MongoMigrationPlanOperation extends MigrationPlanOperation {
  readonly precheck: readonly MongoMigrationCheck[];
  readonly execute: readonly MongoMigrationStep[];
  readonly postcheck: readonly MongoMigrationCheck[];
}
```

`MongoMigrationPlanOperation` extends `MigrationPlanOperation` (the framework base), adding the three arrays. The framework sees only the base fields; Mongo code casts to the full type.

### Serialization

The serializer and deserializer are implemented as standalone functions:

```typescript
interface MongoOperationSerializer {
  serialize(op: MongoMigrationPlanOperation): Record<string, unknown>;
  deserialize(json: Record<string, unknown>): MongoMigrationPlanOperation;
}
```

Internally, the serializer:
1. Writes the envelope fields (`id`, `label`, `operationClass`) directly
2. Serializes each `MongoMigrationStep` by relying on the DDL command AST's natural JSON serialization (frozen `MongoAstNode` instances serialize cleanly via `JSON.stringify`)
3. Serializes each `MongoMigrationCheck` by serializing the inspection command and filter expression ASTs

The deserializer:
1. Reads envelope fields
2. Reconstructs DDL command AST nodes from the `kind` discriminant in the JSON
3. Reconstructs filter expression AST nodes from their `kind` discriminants
4. Validates shapes using Arktype schemas per command/expression kind

### ops.json format

The persisted format for a Mongo migration's `ops.json`:

```json
[
  {
    "id": "index.users.create(email:1)",
    "label": "Create index on users (email ascending)",
    "operationClass": "additive",
    "precheck": [
      {
        "description": "index does not already exist",
        "source": { "kind": "listIndexes", "collection": "users" },
        "filter": { "kind": "field", "field": "key", "op": "$eq", "value": { "email": 1 } },
        "expect": "notExists"
      }
    ],
    "execute": [
      {
        "description": "create index",
        "command": {
          "kind": "createIndex",
          "collection": "users",
          "keys": [{ "field": "email", "direction": 1 }],
          "unique": true
        }
      }
    ],
    "postcheck": [
      {
        "description": "unique index exists",
        "source": { "kind": "listIndexes", "collection": "users" },
        "filter": {
          "kind": "and",
          "exprs": [
            { "kind": "field", "field": "key", "op": "$eq", "value": { "email": 1 } },
            { "kind": "field", "field": "unique", "op": "$eq", "value": true }
          ]
        },
        "expect": "exists"
      }
    ]
  }
]
```

The envelope structure (`id`, `label`, `operationClass`, `precheck[]`, `execute[]`, `postcheck[]`) is identical to SQL's ops.json. Only the content inside steps and checks differs.

## Extractability

The following interfaces are designed for later extraction to `@prisma-next/framework-components`:

| M1 type (Mongo-specific) | Future framework generic |
|---|---|
| `MongoMigrationPlanOperation` | `MigrationPlanOperation<TStep, TCheck>` |
| `MongoMigrationStep` | family-specific `TStep` |
| `MongoMigrationCheck` | family-specific `TCheck` |
| `MongoOperationSerializer` | `MigrationOperationSerializer<TStep, TCheck>` |

The SQL family would need a parallel refactor to conform to the same generic, wrapping its current `{ description, sql }` step type.

## Alternatives considered

**Embed display strings in the operation.** We could add a `displayCommands: string[]` field to the base `MigrationPlanOperation` populated by the planner. This couples the plan data to CLI presentation and bloats the persisted format. Rejected in favor of formatter visitors (see [CLI display spec](cli-display.spec.md)).

**Store fully-typed class instances in ops.json.** JSON naturally loses class identity. The deserializer must reconstruct AST nodes from `kind` discriminants regardless. Keeping ops.json as plain JSON with a well-defined schema is simpler and mirrors the SQL approach.
