# ADR 028 — Migration ledger & squash semantics

## Context

Prisma Next models migrations as edges between data contract hashes rather than ordered files on disk. We need a durable on-disk index that represents this DAG so tools can reason about reachability, safety, and provenance without hitting a live database. Teams want to squash old edges into a baseline to speed fresh environment bootstrap while guaranteeing production safety. CI and PPg features need fast answers to questions like path existence, orphans, cycles, and what would run to reach a target hash.

## Decision

Introduce a versioned migration ledger stored alongside migration packages that encodes the DAG, supports safe squashing, and provides a standard toolkit for path checks and integrity validation:
- Nodes are data contract hashes
- Edges are migration packages with identity derived from content
- The ledger is the single index of record for the DAG in a repository
- Squash produces a new baseline edge that subsumes a contiguous path
- Tooling validates reachability, detects orphans and cycles, and enforces integrity

**Note**: ADR 102 defines the default squash-first policy and advisor system. ADR 101 provides the Advisors framework. This ADR defines the ledger mechanics that support squashing.

This ADR complements:
- ADR 021 Contract marker storage & verification modes
- ADR 039 DAG path resolution & integrity
- ADR 037 Transactional DDL fallback & compensation
- ADR 038 Operation idempotency classification & enforcement
- ADR 044 Pre/post check vocabulary v1
- ADR 101 — Advisors framework
- ADR 102 — Squash-first policy & squash advisor

## Ledger model
- **Node**: coreHash string identifying a canonical data contract
- **Edge**: Directed transition fromCoreHash -> toCoreHash with:
  - edgeId deterministic id derived from the edge header and its operations
  - fromContract, toContract complete contract JSON for state reconstruction
  - hints planner hints and strategies used during planning
  - ops list in JSON IR or typed program reference
  - pre and post check sets
  - labels optional metadata like branch or tag
  - verified proofs such as shadow apply result, planner version, adapter profile
  - authorship info for accountability
  - createdAt timestamp for deterministic ordering (recorded in edge manifest)
  - archived boolean flag marking edges superseded by baseline (kept for audit, ignored for pathfinding)

These fields in each migration's `migration.json` enable graph reconstruction without a separate index. See ADR 039 for details on index-optional operation.

No runtime environment state is embedded in the ledger

## On-disk format

### File layout
```
migrations/
  ledger.json                 # the DAG index
  2025-01-15T1022_add_users/  # migration package directory
    migration.json            # migration header
    ops.json                  # machine ops IR
    notes.md                  # optional human notes
  2025-02-03T0905_add_posts/
    migration.json
    ops.json
  baselines/
    baseline_zero_to_2025-03-01/
      migration.json
      ops.json
```

### ledger.json schema (v1)
```json
{
  "version": 1,
  "nodes": [
    { "coreHash": "sha256:000...zero" },
    { "coreHash": "sha256:abc...123" },
    { "coreHash": "sha256:def...456" }
  ],
  "edges": [
    {
      "edgeId": "sha256:edgexxx",
      "from": "sha256:000...zero",
      "to": "sha256:abc...123",
      "toContractRef": "sha256:contractabc123",
      "fromContractRef": "sha256:contract000zero",
      "path": "migrations/2025-01-15T1022_add_users",
      "kind": "regular",
      "labels": ["main"],
      "verified": {
        "shadowApplied": true,
        "plannerVersion": "1.2.0",
        "adapterProfile": "postgres@15-cap:lateral,jsonAgg",
        "timestamp": "2025-01-15T10:22:33Z"
      },
      "authorship": { "author": "wmadden", "email": "madden@prisma.io" }
    },
    {
      "edgeId": "sha256:edgeyyy",
      "from": "sha256:abc...123",
      "to": "sha256:def...456",
      "toContractRef": "sha256:contractdef456",
      "fromContractRef": "sha256:contractabc123",
      "path": "migrations/2025-02-03T0905_add_posts",
      "kind": "regular",
      "labels": ["main"]
    }
  ],
  "baselines": [
    {
      "edgeId": "sha256:baselinezzz",
      "from": "sha256:000...zero",
      "to": "sha256:def...456",
      "path": "migrations/baselines/baseline_zero_to_2025-03-01",
      "kind": "baseline",
      "supersedes": ["sha256:edgexxx", "sha256:edgeyyy"],
      "verified": {
        "shadowApplied": true,
        "timestamp": "2025-03-01T08:10:00Z"
      }
    }
  ],
  "integrity": {
    "createdWith": "prisma-next@0.8.0",
    "generatedAt": "2025-03-01T08:10:10Z",
    "signature": null
  }
}
```

### migration.json header schema (v1)
```json
{
  "from": "sha256:000...zero",
  "to": "sha256:abc...123",
  "edgeId": "sha256:edgexxx",
  "kind": "regular",
  "fromContract": { /* complete source contract JSON */ },
  "toContract": { /* complete destination contract JSON */ },
  "hints": {
    "used": [],
    "applied": ["additive_only"],
    "plannerVersion": "1.0.0",
    "planningStrategy": "additive"
  },
  "pre": [{ "check": "tableNotExists", "args": { "table": "user" } }],
  "post": [{ "check": "tableExists", "args": { "table": "user" } }],
  "labels": ["main"],
  "authorship": { "author": "wmadden", "email": "madden@prisma.io" }
}
```

edgeId = sha256(canonicalize(migration.json without edgeId) + canonicalize(ops.json) + canonicalize(fromContract) + canonicalize(toContract))

## Operations on the ledger

### Append edge
- Validate from and to nodes exist or add them
- Check that ops.json and migration.json canonicalize and hash to edgeId
- Ensure no duplicate edgeId and no conflicting edge with same from/to but different content
- Update ledger.json and write files atomically

### Squash to baseline (primary hygiene mechanism)
- Squashing is the recommended approach to DAG hygiene (see ADR 102 for policy)
- Input is an ordered path of edgeIds from A to B
- Produce a new baseline edge A→B embedding destination contract JSON
- Set kind = baseline, fill supersedes with edgeIds, place under migrations/baselines/<name>
- Mark superseded edges as archived: true in their migration.json
- Archived edges preserved for provenance/audit but ignored during pathfinding
- Baseline edges eligible only when all included edges verified or policy allows soft baselines
- Branches should rebase onto latest baseline before merge to avoid parallel edges

### Rebase and prune
- If a branch diverges, recompute an edge from current main to to branch to
- Old edges that become unreachable are marked orphaned and can be pruned after policy grace

## Tooling for path checks
- **path-exists(from, to)**: returns whether a reachable path exists and its minimal sequence under deterministic tie-breaks
- **plan-to(from, to)**: returns the concrete sequence of edge packages or a composed baseline edge
- **orphans()**: returns edges not participating in any path from zero to any referenced target
- **cycles()**: detects cycles which are illegal and must be resolved
- **explain-path(from, to)**: summarizes ops count, risk flags, and whether compensation or non-transactional steps are present

All path operations are pure and read only from ledger.json

Path operations reconstruct the graph from migration files by default. The committed index (ADR 039) is optional for performance. PPg can accept `{ migrations/, graph-manifest.json (optional), desiredHash }` and reconstruct server-side if no index provided.

## Integrity and validation
- Canonicalization rules per ADR 010 applied before hashing
- Edge ids are deterministic and content-addressed
- Ledger has a top-level integrity.signature field reserved for repository signing if desired
- CI enforces:
  - no duplicate edgeIds
  - no cycles
  - supersedes lists reference existing edges
  - baselines cover contiguous paths only

## Parallel edges policy
- Default: parallel edges (same from/to, different opsHash) rejected
- Rationale: encourages rebase workflow, keeps graph simple
- Override: require explicit parallel-ok label with justification
- Most teams avoid parallel edges via squash-first + rebase (ADR 102)

## Concurrency and locking
- Local dev uses file-level atomic writes with temp files and rename
- CI and PPg authoring use repo locks or a minimal advisory lock service to serialize ledger edits
- On conflict, tools re-read ledger and reattempt append with deterministic edgeId regeneration

## Runner interaction
- The database stores a contract marker per ADR 021
- Runner determines the DB's current coreHash and computes a path to target coreHash
- Apply edges along the path in order, honoring per-op transactional boundaries and compensation
- Ledger does not require DB to persist applied edgeIds; The DB's coreHash is sufficient to select a path and detect drift

## Squash semantics and safety
- Baselines are intended for cold-start environments like dev or ephemeral previews
- Production avoids baselines unless the DB's current coreHash exactly equals the baseline from
- Applying a baseline when the DB marker does not match from is a hard error
- Baselines can be regenerated at any time from the same contiguous path, yielding the same edgeId due to deterministic canonicalization

## Contract reconstruction and splitting
- Stored contracts enable reconstruction of any historical state
- Migration splitting tools can infer intermediate contract states between any two stored contracts
- Planner can generate new edges between any two historical states using stored contract context
- Tooling can visualize contract evolution and migration impact analysis
- Agents get complete context for migration analysis and debugging

## Contract blob management and GC rules
- Contract blobs are referenced by toContractRef and optionally fromContractRef in edges
- Edges persist plannerHints as structured JSON for reproducible planning decisions
- GC rules for unreferenced contracts: contracts referenced by active edges, baselines, or DB markers are retained
- Squash behavior: when squashing edges, contract references are preserved for audit and visualization
- Contract blob storage is separate from edge storage to enable sharing across multiple edges
- Tools can identify orphaned contract blobs and provide cleanup recommendations

## Drift detection
- If the DB marker hash is unknown or differs from any ledger node, runner reports drift and refuses to choose a path
- Tools provide reconciliation guidance, including planning a corrective edge or instructing a reset path where policy allows

## Observability
- Emit events when edges are appended, squashed, superseded, or pruned
- Surface counts of reachable nodes, orphan edges, and longest path length
- Expose a simple migrations graph command to render the DAG for reviews

## Backward and forward compatibility
- ledger.json is versioned
- New optional fields can be added without breaking older tools
- Major changes to canonicalization or hashing bump version and provide a migration command

## Security and privacy
- Ledger contains no secrets and no parameter values
- Notes may include human context but should not include PII by default
- Signatures and authorship are optional but recommended in regulated environments

## Alternatives considered
- **Pure file-order migrations with applied history in DB**: Simpler but loses determinism, is fragile under branching, and complicates squashing
- **Embedding the full DAG in each edge package**: Bloats artifacts and complicates edits, single ledger is simpler and auditable

## Open questions
- Do we support multiple ledgers per repo for multi-service monorepos or enforce one ledger per contract root
- **Resolved in ADR 102**: Retention windows via squash-first policy handle this. Superseded edges remain on disk with `archived: true` flag and are ignored during pathfinding.
- Do we allow partial squashes that keep certain edges for audit reasons while collapsing others

## Acceptance criteria
- Deterministic path computation from any known coreHash to target coreHash
- Squash produces an identical edgeId when repeated on the same path
- Tools detect and refuse cycles, orphans, and non-contiguous supersedes
- Runner can bring a fresh DB from zero to target using either full path or a single baseline edge without divergence
