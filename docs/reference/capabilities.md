# Capabilities Reference

This document defines the canonical capability keys and reserved namespaces used throughout Prisma Next for adapter negotiation, feature gating, and extension integration.

## Core Capability Namespaces

### `postgres`
Core PostgreSQL capabilities managed by the adapter.

| Capability | Type | Description | Stability |
|------------|------|-------------|-----------|
| `lateral` | boolean | Supports LATERAL joins | Stable |
| `jsonAgg` | boolean | Supports JSON aggregation functions | Stable |
| `returning` | boolean | Supports RETURNING clauses for DML operations (INSERT, UPDATE, DELETE) | Stable |
| `partialIndex` | boolean | Supports partial/filtered indexes | Stable |
| `deferrableConstraints` | boolean | Supports DEFERRABLE constraints | Stable |
| `savepoints` | boolean | Supports savepoint transactions | Stable |
| `transactionalDDL` | boolean | Supports transactional DDL | Stable |
| `explainFormat` | enum | EXPLAIN output format (`text` \| `json`) | Stable |

### `mysql`
Core MySQL capabilities managed by the adapter.

| Capability | Type | Description | Stability |
|------------|------|-------------|-----------|
| `jsonFunctions` | boolean | Supports JSON functions | Stable |
| `generatedColumns` | boolean | Supports generated columns | Stable |
| `checkConstraints` | boolean | Supports CHECK constraints | Stable |
| `explainFormat` | enum | EXPLAIN output format (`text` \| `json`) | Stable |

### `sqlite`
Core SQLite capabilities managed by the adapter.

| Capability | Type | Description | Stability |
|------------|------|-------------|-----------|
| `json1` | boolean | Supports JSON1 extension | Stable |
| `fts5` | boolean | Supports FTS5 full-text search | Stable |
| `rtree` | boolean | Supports R*Tree spatial indexing | Stable |

## Extension Capability Namespaces

Extension capabilities are prefixed by pack namespace to avoid collisions.

### `pgvector`
PostgreSQL vector extension capabilities.

| Capability | Type | Description | Stability |
|------------|------|-------------|-----------|
| `ivfflat` | boolean | Supports IVFFlat indexing | Stable |
| `hnsw` | boolean | Supports HNSW indexing | Stable |
| `vector` | object | Vector type support with params | Stable |

### `postgis`
PostGIS geospatial extension capabilities.

| Capability | Type | Description | Stability |
|------------|------|-------------|-----------|
| `gist` | boolean | Supports GiST spatial indexing | Stable |
| `geography` | boolean | Supports geography type | Stable |
| `geometry` | boolean | Supports geometry type | Stable |
| `srid` | array | Supported SRID values | Stable |

### `pg_trgm`
PostgreSQL trigram extension capabilities.

| Capability | Type | Description | Stability |
|------------|------|-------------|-----------|
| `trigram` | boolean | Supports trigram similarity | Stable |
| `gin` | boolean | Supports GIN trigram indexes | Stable |

## Reserved Namespaces

The following namespaces are reserved and cannot be used by extension packs:

### Core Namespaces
- `prisma` - Reserved for Prisma core features
- `core` - Reserved for core adapter capabilities
- `internal` - Reserved for internal implementation details

### Adapter Namespaces
- `postgres` - PostgreSQL adapter capabilities
- `mysql` - MySQL adapter capabilities
- `sqlite` - SQLite adapter capabilities
- `mongodb` - MongoDB adapter capabilities (future)

### System Namespaces
- `system` - System-level capabilities
- `debug` - Debug and development capabilities
- `test` - Testing and validation capabilities

## Capability Key Rules

### Naming Convention
- Use lowercase with underscores: `json_agg`, `partial_index`
- Boolean capabilities use simple names: `lateral`, `savepoints`
- Complex capabilities use descriptive names: `explain_format`, `transactional_ddl`

### Stability Contract
- **Stable**: Core capabilities that cannot change meaning or be removed
- **Deprecated**: Capabilities marked for removal with migration path
- **Experimental**: New capabilities under evaluation

### Versioning
- Capability keys are immutable once published
- New capabilities can be added as stable
- Breaking changes require new capability keys

## Capability Negotiation

### Adapter Advertisement
Adapters declare supported capabilities at connect time:

```typescript
interface AdapterCapabilities {
  [namespace: string]: {
    [capability: string]: boolean | string | object | array
  }
}
```

### Contract Requirements
Contracts declare required capabilities in `contract.capabilities`:

```json
{
  "capabilities": {
    "postgres": { "lateral": true, "jsonAgg": true },
    "pgvector": { "ivfflat": true }
  }
}
```

### Negotiation Process
1. Adapter advertises available capabilities
2. Runtime checks contract requirements against adapter capabilities
3. Missing required capabilities cause connection failure
4. Optional capabilities are noted but don't block connection

### Error Codes
- `E_CAPABILITY_MISSING` - Required capability not available
- `E_CAPABILITY_INCOMPATIBLE` - Capability value incompatible
- `E_CAPABILITY_UNKNOWN` - Unknown capability key

## Extension Pack Guidelines

### Namespace Selection
- Use descriptive, lowercase names: `pgvector`, `postgis`, `pg_trgm`
- Avoid generic terms: `vector`, `geo`, `search`
- Check reserved namespaces before publishing

### Capability Declaration
- Declare all capabilities your pack requires
- Use stable capability keys from this reference
- Document capability requirements in pack README

### Compatibility Matrix
- Test against multiple adapter versions
- Document minimum capability requirements
- Provide fallback behavior for missing capabilities

## Future Extensions

### Planned Capabilities
- `pg_stat_statements` - Query statistics
- `pg_hint_plan` - Query plan hints
- `pg_partman` - Partition management
- `timescaledb` - Time-series extensions

### Community Guidelines
- Follow naming conventions
- Document capability requirements
- Provide migration paths for capability changes
- Submit capability keys for review before publishing

## References

- [ADR 065: Adapter capability schema & negotiation v1](../architecture%20docs/adrs/ADR%20065%20-%20Adapter%20capability%20schema%20&%20negotiation%20v1.md)
- [ADR 117: Extension capability keys](../architecture%20docs/adrs/ADR%20117%20-%20Extension%20capability%20keys.md)
- [Extensions Glossary](./extensions-glossary.md)

## Capability Matrix

Canonical capability keys with descriptions, typical implementers, and ADR references.

| Capability key | Description | Implemented by | ADRs |
|---|---|---|---|
| join.lateral | LATERAL join lowering | postgres adapter | ADR 065 |
| join.semi | SEMI join lowering | adapters that support SEMI semantics | ADR 065 |
| join.anti | ANTI join lowering | adapters that support ANTI semantics | ADR 065 |
| projection.distinct | DISTINCT projection | most SQL adapters | ADR 065 |
| projection.distinctOn | DISTINCT ON projection | postgres adapter | ADR 065 |
| index.partial | Partial/filtered index support | postgres adapter, packs | ADR 065, 116 |
| distribution.shardKey | Distribution/shard key support | citus pack | ADR 065, 116 |
| pgvector.vector | Vector type support | pgvector pack | ADR 112–115 |
| postgis.geometry | Geometry type support | postgis pack | ADR 112–115 |

Notes
- Capability keys are versioned and namespaced; see ADR 117 for stability rules.
- Keep this matrix updated with adapter and pack changes.
