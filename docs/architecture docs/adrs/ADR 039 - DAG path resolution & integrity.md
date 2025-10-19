ADR 039 — DAG path resolution & integrity

Context

Migrations are modeled as directed edges from fromHash to toHash. At apply time, the runner must compute a path from the database’s current contract hash to the desired hash using the set of on-disk edges. The graph must remain acyclic and well-formed so path computation is deterministic, fast, and safe

Problem
	•	Multiple developers create edges concurrently, producing branches
	•	Ambiguous or conflicting edges can lead to non-deterministic path selection
	•	Cycles or malformed edges can deadlock the runner at apply time
	•	Without a consistent tie-breaker, two environments may choose different valid paths
	•	Orphan edges and unreachable nodes accumulate without guardrails

Goals
	•	Deterministic, repeatable path selection between any two hashes
	•	Linear-time detection of cycles and orphans during graph load
	•	Stable tie-breaking across machines and CI
	•	Simple complexity profile suitable for local runs and CI
	•	Clear error codes and diagnostics when integrity is violated

Non-goals
	•	Weighted optimization of path cost beyond hop count
	•	Automatic graph surgery or edge rewriting
	•	Encoding business policies into the graph layer

Decision

Graph model and index
	•	Each edge is { edgeId, from, to, opsHash, createdAt, labels?, archived? }
	•	Migration files carry their own manifest with this metadata
	•	**Default mode**: reconstruct graph on demand from edge files
	•	**Optional**: maintain graph index JSON in repo: migrations/graph.index.json
	•	edgeId = sha256(from + to + opsHash) unless tooling assigns it
	•	Loader builds adjacency maps out[from] and in[to] from edge manifests

Under the squash-first policy (ADR 102), most teams maintain small DAGs (10-20 active edges) where reconstruction is fast and the index is unnecessary.

When to use a committed index (optional)

The graph index is a lockfile optimization that teams can adopt later. **Most teams won't need this initially** when following squash-first hygiene (ADR 102).

The index acts like a lockfile for the migration DAG. It's helpful if you have:
	•	Large migration histories you haven't squashed yet
	•	Lots of concurrent branches and frequent parallel edges
	•	Compliance requirements for reviewable "graph diff" artifacts
	•	External tools (PPg, visualizers) operating without repo access

Benefits when enabled:
	•	Stable neighbor ordering pre-materialized
	•	Auditability via small JSON diff
	•	Fast cold starts (no reconstruction needed)
	•	Canonical createdAt and labels (not inferred from FS)

Not a conflict with reconstruction:
	•	Planner can reconstruct on every invocation by default
	•	On load, tooling verifies file digests match index
	•	If stale, fail with ERR_MIG_GRAPH_INDEX_STALE
	•	Small repos use ephemeral mode: rebuild each run, cache locally

Default recommendation: Start without an index. Enable only if telemetry shows reconstruction cost or compliance requires reviewable artifacts.

Integrity checks on load
	•	Self-loop check: reject from == to with ERR_MIG_GRAPH_SELF_LOOP
	•	Cycle detection: DFS with color marking, error ERR_MIG_GRAPH_CYCLE and report the cycle
	•	Parallel edge policy: two edges with same (from, to) but different opsHash require label parallel-ok, else ERR_MIG_GRAPH_PARALLEL_EDGE
	•	Orphan edge detection: edges unreachable from any genesis or that lead to no declared target are flagged as WARN_MIG_ORPHAN_EDGE (excludes edges marked archived: true)
	•	Dangling target detection: to with no inbound edges and not a genesis is ERR_MIG_GRAPH_DANGLING_TARGET
	•	Genesis set: {EMPTY_DB_HASH} plus declared baselines labeled baseline

Path computation

	•	Default: reconstruct graph from edge file manifests in-memory
	•	Use BFS to compute minimal-hop paths over adjacency list
	•	Complexity O(V+E)
	•	With squash-first policy (ADR 102), typical V+E < 50, making this trivial
	•	Optional index pre-materializes adjacency for performance at scale

Deterministic tie-breaking

Neighbor ordering is deterministic whether using reconstruction or index. Metadata comes from migration file headers (migration.json), not the index. The index merely caches this for faster access.

Neighbor processing order is stable by a sort key tuple
	1.	Label priority: main < default < feature
	2.	createdAt ascending
	3.	to lexicographic
	4.	edgeId lexicographic

If labels are absent the order falls back to the remaining keys

Graph version and caching
	•	graphVersion = sha256(sorted(edgeId, from, to, opsHash))
	•	The runner uses (currentHash, desiredHash, graphVersion) in cache keys
	•	Any index change invalidates cached paths deterministically

Orphans and parallel edges policy
	•	Orphans are warnings by default and can be enforced as errors in CI
	•	Parallel edges are allowed only with parallel-ok labels and deterministic preference via tie-break

Diagnostics
	•	Stable error codes with minimal subgraph rendering and remediation suggestions
	•	migrate graph lint and migrate graph prune commands surface issues and clean up orphans

Consequences

Positive
	•	Deterministic paths across environments
	•	Early detection of cycles and malformed edges
	•	Reviewable, portable graph state for CI/PPg
	•	Simple performance characteristics
	•	Simple default: no index overhead for small/medium repos
	•	Squash-first policy (ADR 102) keeps DAG small, reducing need for index

Negative
	•	Optional index adds maintenance overhead if enabled
	•	Teams using index must regenerate after adding migrations

Mitigations
	•	Tooling owns index lifecycle: migrate create updates the index, migrate graph update regenerates deterministically
	•	The planner refuses to use a stale index by default and offers --refresh

Alternatives considered

Pure reconstruction on every run (chosen as default)
	•	Works well with squash-first hygiene (ADR 102)
	•	Small DAGs make reconstruction negligible
	•	Committed index available as opt-in for scale/compliance

Timestamp-only tie-breaking
	•	Sensitive to clock skew and FS semantics
	•	Rejected in favor of multi-key deterministic sort

Always require committed index
	•	Adds complexity for teams that don't need it
	•	Index remains available as performance optimization

Implementation notes
	•	Implement graph.index.json writer/reader with file digest table
	•	Extend CLI with migrate graph update, migrate graph lint, migrate graph prune
	•	Loader verifies index freshness and returns actionable errors
	•	Telemetry records graphVersion with each apply for reproducibility

Testing
	•	Fixtures with branches, orphans, parallel edges, cycles
	•	Golden tests that identical inputs yield identical index and paths
	•	Scale tests for O(V+E) behavior
	•	CI tests that fail on stale index and pass after graph update

References
	•	ADR 028 — Migration ledger & squash semantics
	•	ADR 037 — Transactional DDL fallback & compensation
	•	ADR 038 — Operation idempotency classification & enforcement
	•	ADR 021 — Contract marker storage & verification modes
	•	ADR 101 — Advisors framework
	•	ADR 102 — Squash-first policy & squash advisor
