# Retros — contract-ir-planes

Project retro log. The mandatory final retro (invariant I10) is below; per-slice
lessons landed continuously in [`drive/retro/findings.md`](../../drive/retro/findings.md)
and the calibration files throughout delivery, so this entry synthesises at the
project level rather than re-listing them.

## 2026-05-30 · mandatory final retro (project close)

**Trigger:** project close — final retro per invariant I10.

**Scope:** the project as a whole — substrate (S1.A) → enum migration (S1.B) →
cross-reference encoding (S1.C) → reap subsumed surfaces (S1.D, narrowed) →
namespace-aware enum planning (S1.E, adopted correctness fix). Five slices
merged (S1.A–C, S1.D-1/-2, S1.E, S1.D-3 merge-ready at write time).

### 1. What went well

- **`co-ship` falsifier at plan time (6→4 slices).** Applied before locking
  Linear tickets; collapsed substrate+wiring and the two migration+regen pairs
  into single slices with multiple dispatches. PR-review pressure stayed bound to
  the right unit. (Landed: `findings.md` 2026-05-20 win.)
- **Narrow-and-defer when an inventory falsified the "clean reap" premise.** The
  2026-05-29 inventory found S1.D's eight subsumed surfaces were not all clean
  deletes — three carried structural prerequisites (`contract.json`-shape change,
  hash-computation change, query-builder type rewrite). Rather than bundle them
  into one un-reviewably broad PR, the project shipped the three clean deletes
  (S1.D-1/-2/-3) and deferred the three structural items to standalone tickets
  (TML-2743/2744/2745). PDoD5/PDoD10 were amended to scope the deferred items out
  explicitly. This is the project's load-bearing planning win.
- **Refusal-trigger discipline paid off repeatedly.** Implementers halted on
  unbriefed structural blockers with precise evidence rather than working around
  them: S1.C R3/R4/R5 (per-call-site audit gaps), S1.E D3 (enum keying would have
  cascaded into a layering violation → re-decomposed as D3b with an injected
  resolver). Each halt cost ~10 min of orchestrator re-scope vs. an adapter-spread
  laundering the discipline gap into the codebase.
- **`elementCoordinates` as a free function, not an interface method (S1.A D6).**
  The structural insight that adding a method to the `Storage` interface would
  cascade byte-stability breakage through every emitted `contract.d.ts` (whose
  storage literals carry no method members) preserved fixture stability and is now
  ADR'd.
- **Composer-for-implementation / Opus-for-review tiering** held across the S1.D
  trio + S1.E with no quality regression at materially lower cost.

### 2. What surprised us

- **"Clean delete" was the wrong default for half the reap surfaces.** The
  asymmetry-driven helpers looked uniformly removable; only an inventory against
  the merged substrate revealed which were structural. Lesson: a "cleanup slice"
  premised on N deletions should be inventory-verified before sizing, not assumed.
- **`StorageBase` lacked the namespace topology it actually depended on.** The
  migration tooling duck-typed `StorageBase → Storage` at runtime because the
  namespace map lived only on the core IR interface. Root cause was a modelling
  accident, not a layering rule: the plain-data shape belonged in foundation all
  along. The fix (lift the topology into foundation; core refines it) was pulled
  *into* S1.D-3 rather than deferred as a runtime bridge — applying the
  "cheapest moment to apply a structural fix is when the symptom surfaces" rule.
- **Naming an interface after an emergent property.** The topology lift first
  shipped interfaces named `StorageTopology` / `StorageNamespaceTopology`;
  topology is emergent, so the names were corrected to `StorageNamespace` (folding
  the namespaces map into `StorageBase`). Caught at review.
- **The upgrade-coverage CI gate is satisfied by directory existence, not
  per-PR entries** (surfaced during this project's review pass) — filed TML-2738
  with a retro-audit obligation. Not a project defect, but the project's PRs were
  where it was noticed.

### 3. Lessons → landing surfaces

| Lesson | Surface | State |
|---|---|---|
| Narrow-and-defer when an inventory falsifies a "clean slice" premise | `drive/retro/findings.md` (project-close stanza) | landed this close-out |
| Reviewers rely on CI for validation gates; implementers run scoped gates | `drive/code/README.md`, `drive/pr/README.md` | landed (DCO + gates realignment) |
| Downstream-source breaking change needs an upgrade record; reviewer is the backstop | `drive/code/README.md` | landed |
| Plane structure + entity coordinate + pack-contributed kinds | ADR `0001-contract-planes` | migrates to `docs/architecture docs/adrs/` at close (PDoD9) |
| Per-call-site vs audit-driven edits; brief gigantism; refusal-trigger discipline; tiering | `findings.md` + `drive/calibration/*` | landed during delivery |

### 4. Deferred scope (now ticketed)

- **TML-2743** — namespaced `SqlModelStorage` coordinate → delete `findSqlTable` + `assertUniqueSqlTableNames`.
- **TML-2744** — kind-agnostic descriptor hashing → delete `stripNamespaceKinds`.
- **TML-2745** — namespace-aware query-builder selection → delete query-builder `UnboundTables`.

All three were recorded in `deferred.md` during delivery and promoted to standalone
Linear tickets at close-out (before the folder deletion removes `deferred.md`).
TML-2582 (the `sql-builder` rename) stays Canceled — distinct from TML-2745.

### 5. ADR-worthy decision

Yes — ADR `0001-contract-planes` (the two-plane IR, the entity coordinate, the
pack-contributed entity-kind mechanism, and the free-function-not-method rationale).
It is part of the framework's public IR contract; it migrates into
`docs/architecture docs/adrs/` as PDoD9 of this close-out.

### 6. One-sentence summary

Restructured the contract IR into `domain`/`storage` planes addressed by a uniform
`(namespace, kind, name)` entity coordinate with a target-pack-contributed
entity-kind mechanism — migrating Postgres enum onto the pack-contribution path —
across five merged slices, using a mid-project narrow-and-defer to keep every PR
reviewable.
