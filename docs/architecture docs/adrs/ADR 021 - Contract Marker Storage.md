# ADR 021 — Contract marker storage & verification modes

## Context

The runtime and the migration runner must know which data contract a database currently satisfies. Plans carry meta.coreHash and meta.target and must be verified against the database before execution. We need a durable, unambiguous marker in the database plus clear verification modes suited to dev, CI, and production.

## Decision

Store the current contract identity in a small, reserved table called prisma_contract.marker in each target schema or database:
- The marker records the core hash of the data contract and the profile hash pinned by the contract (declared capability profile)
- The runtime implements three verification modes: startup, onFirstUse, and always
- Cross-environment drift is reported with structured errors and remediation guidance, never auto-patched

## Marker schema

### Default for Postgres

```sql
create schema if not exists prisma_contract;

create table if not exists prisma_contract.marker (
  id smallint primary key default 1,
  core_hash text not null,
  profile_hash text not null,
  contract_json jsonb,
  canonical_version int,
  updated_at timestamptz not null default now(),
  app_tag text,
  meta jsonb not null default '{}'
);
```

### Notes
- Single row keyed by id = 1 keeps reads cheap and avoids accidental fan-out
- core_hash is the canonical hash of contract.json after canonicalization
- profile_hash mirrors the contract-pinned capability profile and is used to enforce equality at verification time
- contract_json is optional complete contract JSON for drift analysis and PPg features
- canonical_version tracks the canonicalization version used for the contract_json
- app_tag is optional human context (service or deployment name)
- meta is reserved for forward-compatible fields the platform may add later

### Other targets
- **MySQL**: same table in prisma_contract database or current schema
- **SQLite**: prisma_contract_marker table with the same columns
- **Mongo**: prisma_contract.marker collection with a single document keyed by _id: 1
- Adapters must provide DDL for creating and reading the marker consistently

## Ownership and lifecycle
- The migration runner is the only component that updates the marker
- It writes core_hash and profile_hash at the end of a successful edge apply, in the same transaction when transactional DDL is available
- It also writes an entry to the migration ledger for audit
- For profile-only updates (no DDL), the runner updates `profile_hash` after a successful verification that the database satisfies the contract-declared capabilities (core_hash remains unchanged)
- The runtime reads but never mutates the marker
- Reads are cheap, cached per process, and invalidated by configurable TTLs or explicit cache busting
- If the marker is missing, the runtime reports contract/marker-missing and refuses to execute in strict mode

## Contract storage modes
- **off**: contract_json is null, only hashes are stored (default for backward compatibility)
- **compressed**: contract_json contains gzipped canonical JSON for space efficiency
- **full**: contract_json contains complete canonical JSON for drift analysis and PPg features
- **Verification**: hash equality is authoritative; JSON equality is diagnostic only

## Namespacing and multi-tenant
- Default behavior is per schema for Postgres
- Each schema that hosts application tables has its own prisma_contract.marker
- The runtime verifies against the schema implied by the Plan's meta.refs or a configured default schema
- Alternative centralized mode is supported for platforms that mandate a single control schema
- Adapters surface a markerLocator to find the correct row keyed by schema_name or tenant_id
- Policy is defined by deployment, not by Plans
- Plans must not embed tenant identifiers beyond normal table qualification

## Verification modes

### startup
- Verify once when the runtime starts
- Read the marker, compare contract coreHash/profileHash to marker values, cache the result
- On mismatch, throw contract/hash-mismatch or contract/target-mismatch and refuse to start in strict mode
- Intended for stable production processes and long-lived workers

### onFirstUse
- Verify lazily the first time a table from a schema is referenced
- Uses Plan meta.refs.tables if present, else a configured default schema
- Caches per schema in memory for the process lifetime
- Good balance for modern serverless or frequently recycled workers

### always
- Verify for every Plan
- Highest safety, highest cost
- Recommended for CI, preflight, and debug sessions

## Drift handling

### Error taxonomy
- contract/marker-missing when the marker table or row is absent
- contract/hash-mismatch when DB core_hash and Plan coreHash differ
- contract/target-mismatch when DB profile_hash and contract profileHash differ (run a profile-only verify if the contract intentionally changed capability profile)

### Behavior
- In strict mode these are blocking errors
- In permissive mode marker-missing may be downgraded to a warning in dev if configured, but hash-mismatch remains an error
- Errors include a remediation hint:
  - run migration planner to build an edge from DB marker to app contract
  - or re-emit types and Plans against the DB's current contract if the app is outdated

### Minor drift tolerances
- Only comment and description changes are considered minor and may be ignored if the profile declares them non-material
- Column default differences, index method changes, and nullability are material and must be reconciled by a migration

### Cross-environment examples
- Dev DB on Hdev, app built against Hhead → runtime refuses and instructs to plan and apply path Hdev → Hhead
- Prod DB on Hprod, CI planning Hprod → Hnew → preflight succeeds if path exists; release gates promotion on this status

## Concurrency and locks
- Marker updates are performed inside the transaction that applies an edge where possible
- The runner acquires an advisory lock before applying an edge and holds it until the marker is updated
- Reads do not take locks beyond default read consistency
- If transactional DDL is not available, the runner orders operations to minimize partial apply and re-reads the marker before updating to defend against concurrent writers

## Configuration

### Runtime
```typescript
createRuntime({
  contract,
  adapter,
  driver,
  verify: 'startup' | 'onFirstUse' | 'always',
  verifyCacheTtlMs?: number,
  markerLocator?: { schema?: string, centralized?: { schema: string, key: string } },
  contractStorage?: 'off' | 'compressed' | 'full'
})
```

### Runner
```typescript
createRunner({
  adapter,
  adminDriver,
  ledger: { enabled: true },
  lock: { namespace: 'prisma-next', keyStrategy: 'per-database' }
})
```

## Performance
- Marker read is O(1) and amortized in startup and onFirstUse modes
- In always, the extra read adds sub-millisecond overhead on pooled connections on Postgres
- Cache TTL is configurable to trade freshness for fewer reads in high-throughput services

## Security
- The marker table should be owned by a role with DDL privileges
- Application roles require SELECT on prisma_contract.marker only
- The runner role requires UPDATE on prisma_contract.marker and INSERT on the ledger
- No secrets are stored in the marker or ledger

## Alternatives considered
- **Storing the hash in database comments or extension metadata**: rejected due to portability and permission variability across vendors
- **Storing the hash outside the database in an app config store**: rejected because it breaks the invariant that the database can self-describe its contract
- **Recording a full migration history as the source of truth**: retained as an optional ledger for audit, but the marker remains the authoritative state

## Consequences

### Positive
- Simple, fast verification with clear modes and minimal reads
- Unambiguous drift detection that agents and humans can reason about
- Works across environments and supports squashed baselines without special cases

### Trade-offs
- Requires creating a reserved schema/table in each target schema or a centralized control schema
- always mode adds a small per-query overhead and should be limited to CI and debug

## Testing
- Migration runner tests that marker is updated atomically with edge apply
- Runtime tests for each verification mode with and without cache
- Drift scenarios across schemas and tenants
- Adapter conformance tests for marker DDL and read APIs

## Open questions
- Optional replication of the marker to read replicas and how verification should behave on replicas
- Standardizing a minor drift whitelist beyond comments for specific adapters under strict guarantees
- PPg-specific UI for visualizing current marker, proposed edges, and promotion gates
