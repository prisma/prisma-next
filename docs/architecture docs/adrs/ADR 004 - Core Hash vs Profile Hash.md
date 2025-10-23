# ADR 004 — Core Hash vs Profile Hash

## Context

- We hash the emitted data contract to tie code, database state, and artifacts together
- A single hash makes any physical or capability tweak look like a breaking schema change
- Teams need to evolve physical settings and enable target features without invalidating every artifact or forcing meaningless migrations
- We also need strong guarantees for changes that do alter the logical meaning of the data model

## Decision

- Split hashing into two layers
- **coreHash**: hash of the meaningful schema and mappings that define rows and relations
- **profileHash (pinned)**: contract-derived hash of declared capability profile and optional adapter pins that affect execution but not meaning
- Store both in artifacts and in the database marker
- Use coreHash for applicability of migrations and query verification
- Use profileHash to enforce capability parity with the database marker; runtime compares equality to the marker, not a freshly computed runtime profile

## Details

### What contributes to coreHash

- Models, fields, and nullability
- Relations and their join conditions
- Storage shape: tables, columns, PK/UK/FK sets
- Column logical type and semantic defaults (e.g., autoincrement, now)
- Model↔storage mappings and rename hints that change meaning

### What contributes to profileHash

- Index methods and fill factors
- Constraint names and non-semantic identifiers
- Execution capabilities and toggles (e.g., lateral, jsonAgg, vector)
- Planner hints and non-semantic storage parameters
- Collation or encoding when declared as physical preference, not when it changes the logical comparison semantics we rely on

### Emission and storage

- Emitter produces `contract.json` and computes both hashes via canonicalization (including contract-declared capabilities for `profileHash`)
- Database marker stores coreHash, profileHash, marker version, and a ledger of applied edges
- Migration edges store complete fromContract and toContract JSON alongside hashes
- Runtime embeds coreHash into each Plan's meta and verifies on execute; it reads marker `profile_hash` and enforces equality with the contract's `profileHash`
- Preflight surfaces differences in both hashes with actionable guidance

### Behavior on mismatch

#### coreHash mismatch
- **Migrations**: edge is inapplicable and must be re-planned
- **Runtime**: block or warn per environment policy

#### profileHash mismatch
- **Runtime**: blocking error by default (contract/target-mismatch). The app must re-verify against the database (or update the contract) so the marker reflects the pinned profile.
- **Advisors**: suggest reconciliation steps (enable required capabilities, install extensions, or update contract/pins)
- **PPg**: can surface remediation instructions

### Example changes and their effects

- Add nullable column → new coreHash
- Add GIN index on existing column → new profileHash only
- Enable jsonAgg capability flag → new profileHash only
- Change varchar(255) to text where semantics are identical for our purposes → profileHash only
- Change column nullability → new coreHash
- Change collation to one that alters comparison semantics we depend on → new coreHash

## Alternatives considered

- **Single hash for everything**: Simple but noisy and forces unnecessary re-plans and redeploys
- **Multiple fine-grained hashes per section**: More precision but higher complexity and harder UX
- **No hashing, version integers only**: Weak verification and easy to drift undetected

## Consequences

### Positive

- Clear contract for when migrations and queries must be revalidated
- Safer evolutions of physical tuning without breaking logical compatibility
- Better diagnostics and targeted PPg guidance

### Trade-offs

- Slightly more complexity in artifacts and marker schema
- Requires careful classification of fields into core vs profile

## Scope and non-goals

### In scope for MVP

- Define canonicalization rules and implement both hashes in emitter
- Persist both hashes in the database marker and artifacts
- Runtime verification against coreHash and warnings for profileHash drift
- Preflight diagnostics for both categories

### Out of scope for MVP

- Automated reconciliation for profile drift
- Per-section hashing beyond the two-layer split

## Backwards compatibility and migration

- Existing contracts without profileHash are treated as profileHash = null
- Marker migration adds a nullable profile_hash column and a marker schema version bump
- Old environments continue to verify coreHash as before

## Open questions

- Exact boundary for collations and encodings between core and profile
- Future: a "floating mode" could compute a runtime profile from discovered capabilities and check only that it satisfies contract requirements rather than equality. This would be an additive mode; the default remains pinned and contract-derived.
- How to report combined core/profile diffs in a single, readable diagnostic for CI and PPg

## Decision record

- Adopt a two-layer hashing scheme with coreHash for meaning and profileHash for physical profile
- Verify coreHash for applicability and safety, surface profileHash as drift with advisor guidance
- Persist both in artifacts and database markers to support deterministic planning, safe execution, and platform insights
