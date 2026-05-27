# Design notes: mongo-driver-version-support

> Synthesized design document for the mongo-driver-version-support project. Read this if you want to understand **what the project's design is**, **what principles it serves**, and **what alternatives were considered and rejected**. This document is not a chronological log of decisions — it captures the settled design, standing independently of the discussions that produced it.
>
> Owned by the Orchestrator. Authored directly (not delegated — see [`drive/roles/README.md` § Orchestrator-direct authoring](../../drive/roles/README.md)). Updated as design settles; not as decisions happen. Cross-link from the project spec; never block on a design-notes update during execution.

## Status

**Settled** (post-`drive-discussion`, 2026-05-26). The discussion adopted the **architect** + **principal-engineer** lenses with **tech-lead** at synthesis. The reconnaissance grounding the discussion lives in [`./research/mongo-surface-area.md`](./research/mongo-surface-area.md). The next step is `drive-specify-project` to express this design as the project spec, then `drive-plan-project` to decompose it.

## Principles this design serves

- **`@prisma-next/mongo` owns the user-facing type surface.** Users importing types in their application code import them from `@prisma-next/mongo/*` — never directly from `'mongodb'`. PN is the ORM; PN's codec return types are authoritative for what users read and write.
- **The runtime driver dependency is honest in the user's `package.json`.** `mongodb` is declared as a `peerDependencies` entry on the runtime-consumer packages, so users see it in their `package.json` and lockfile and install it explicitly.
- **PN is coupled to one mongodb major at a time.** No abstraction layer over multi-major differences; no compatibility shims; no version-detection branches in our runtime.
- **Conceptual minimality where it doesn't conflict with surface-ownership.** Stale runtime deps come down; vestigial constraints on users disappear.
- **Future major bumps are forced upgrades, not additive features.** When mongodb publishes a new major, we audit and bump in a breaking PN release. Users bump in lockstep.

## The model

### The user surface

Users import everything through `@prisma-next/mongo/*` paths. They do not import from `'mongodb'` in their application code.

| User imports from | Surface |
| --- | --- |
| `@prisma-next/mongo/bson` | `Binary`, `Decimal128`, `Long`, `MongoClient`, `ObjectId`, `Timestamp` (re-exported from `'mongodb'`) |
| `@prisma-next/mongo/runtime` | `MongoBindingOptions` including `mongoClient?: MongoClient`; the `mongo()` factory; binding helpers |
| Contract-emitted types | Codec output types |

The `bson` barrel and the typed `mongoClient` option are explicit public-API commitments. They survive the policy choice because they express the surface-ownership principle — they are *the surface PN owns on the user's behalf*, not redundant courtesy re-exports.

### The dependency graph

`mongodb` is declared as a `peerDependencies` entry on the three runtime-consumer packages, with a single-major range:

| Package | Field | Range (today) |
| --- | --- | --- |
| `@prisma-next/driver-mongo` | `peerDependencies` | `^7.0.0` |
| `@prisma-next/adapter-mongo` | `peerDependencies` | `^7.0.0` |
| `@prisma-next/mongo` | `peerDependencies` | `^7.0.0` |

When mongodb v8 publishes, the peer range becomes `^8.0.0` in a breaking PN release; never `^7.0.0 || ^8.0.0`.

The workspace catalog (`pnpm-workspace.yaml`) holds a concrete version inside the supported major for our own dev/test/CI builds — `mongodb: ^7.x.y`. Internal `devDependencies` reference the catalog as today.

`@prisma-next/target-mongo` and `@prisma-next/family-mongo` lose their `mongodb` declarations entirely — they never imported from `'mongodb'` in `src/`. (Recon Section 1 confirmed.)

### The version-bump cycle

When mongodb publishes a new major:

1. We extend the surface-area recon to the new major (the [`./research/mongo-surface-area.md`](./research/mongo-surface-area.md) artifact is the template).
2. We assess breaking-change impact on the symbols we import and on the BSON value classes we re-export.
3. We bump the peer range and the catalog in a breaking PN release.
4. We document any user-visible class-shape changes in migration notes (BSON-v7-class-shape changes propagate through our `bson` re-export to users; we own that as a public-API commitment).
5. Users bump their own `mongodb` install in lockstep.

We never run two majors simultaneously in the codebase.

### Implementation surface (this work)

The first slice of this project, in scope:

- `pnpm-workspace.yaml`: catalog entry `mongodb: ^7.x.y` (latest minor at land time).
- `packages/3-mongo-target/3-mongo-driver/package.json`: move `mongodb` from `dependencies` → `peerDependencies` (`^7.0.0`).
- `packages/3-mongo-target/2-mongo-adapter/package.json`: same move.
- `packages/3-extensions/mongo/package.json`: same move.
- `packages/3-mongo-target/1-mongo-target/package.json`: remove `mongodb` declaration entirely.
- `packages/2-mongo-family/9-family/package.json`: remove `mongodb` declaration entirely.
- Audit `adapter-mongo/src/core/command-executor.ts:58` for the `collection.drop()` semantic change (B6: was-throw → now-false on NamespaceNotFound). Likely benign — confirm during implementation.
- Update the three example apps' `package.json` files (`mongo-demo`, `retail-store`, `mongo-blog-leaderboard`) and the test fixture `cli-e2e-test-app` if their direct `mongodb` declarations need to change. They may continue to declare `mongodb` directly (they're consumers of the framework, modelling real user apps).
- Verify the install graph is coherent post-bump: `mongodb-memory-server@11.1.0` already bundles driver 7.x internally, so moving to `^7` should resolve the existing two-major coexistence side effect.

What is **not** in scope:

- Multi-major support of any kind.
- Driver-version-detection branches in our runtime.
- Compatibility shims.
- Wrapping BSON classes with our own type identities.

## Alternatives considered

- **A. Pin `mongodb` to a single major in `dependencies` (driver is our implementation detail).** **Rejected because:** the user-facing framing was less clean than peer-dep — explicit peer-dep makes the runtime driver visible in the user's `package.json`, which the operator preferred. The architectural surface ends up materially similar; the dep-declaration mechanism is the difference, and peer-dep gives the user explicit control over minor/patch within the supported major.
- **B. Peer-range `^6 || ^7 || ^8` (multi-major support).** **Rejected because:** forces dropping the `bson` re-export (cross-major BSON identity breaks `instanceof` checks across realms), forces structural typing of `mongoClient`, doubles or triples the test matrix, and multiplies maintenance cost on every breaking change in any in-range major. The operator explicitly does not want PN to take on the complexity of abstracting across mongodb majors.
- **C-minus-barrel: peer-dep with the `bson` re-export dropped.** **Rejected because:** the conceptual-minimality argument ("the barrel is a redundant courtesy re-export") was outweighed by the surface-ownership argument. PN owns the user-facing types; making users import BSON classes from `'mongodb'` directly contradicts the "users only touch `@prisma-next/mongo/*`" framing. The barrel earns its keep as the PN-owned import path for these classes.
- **"Pin to latest now, follow-up ticket adds previous-version support."** **Rejected because:** the framing was incoherent — adding multi-major support is not an additive follow-up; it requires breaking the `bson` barrel and restructuring the typed `mongoClient` option, both of which are public-API breaks. If multi-major ever becomes necessary, it is correctly framed as a future breaking-change project with its own design and migration story, not as an additive feature on top of this work. The discussion settled on: multi-major support is **out of scope indefinitely**; surface as a new project if a customer ever needs it.

## Open questions

> **Status (2026-05-26): all four questions researched and resolved.** Research artifact: [`./research/open-questions.md`](./research/open-questions.md). Three ✅ confirms, one ⚠️ framing correction. None reopen the design.

- **BSON v7's breaking-change surface — ✅ confirms benign.** The only class-shape change touching our re-exports is the removal of `new ObjectId(numericTimestamp)` (replacement: `ObjectId.createFromTime()`). Zero numeric `ObjectId` calls in our source or tests. `Binary` / `Decimal128` / `Long` / `Timestamp` unchanged. Captured as a user-facing migration-note item in the spec (FR8). I12 falsification trigger remains in force for any future major bump.
- **`collection.drop()` no-throw-on-NamespaceNotFound (recon B6) — ✅ confirms benign.** Single call site at `command-executor.ts:57-59` (return value discarded); no caller and no test depends on the throw; the migration-runner's idempotency check at `mongo-runner.ts:121-128` already short-circuits drops on missing collections. No code change required beyond awareness.
- **Cursor `batchSize` default removal (recon B11) — ⚠️ defer is correct, framing corrected.** The original rationale ("more `getMore` round-trips") was inverted. v7's release notes explicitly state the change *reduces* round-trips: without the driver-side 1000-doc cap, the server packs up to 16 MB per `getMore`. Six cursor sites identified; five return small result-sets that fit in the initial 101-doc batch (so the v6 default was never engaged); the user-facing aggregate path is more likely to see a perf improvement than a regression.
- **`MongoClient.connect()` fail-fast handshake (recon B13) — ✅ confirms defer.** Every `client.connect()` in the repo connects to credential-free `mongodb-memory-server`. Zero tests assert on lazy-vs-eager error timing. Our control-driver wrapper at `driver-mongo/src/exports/control.ts:38-62` already wraps `connect()` in `try`/`catch` and surfaces a structured `errorRuntime`; v7 just shifts *when* the same error fires.

## Persona-pass cross-pollinations

- **Architect's "consumer-vs-essence" probe on the `bson` barrel** initially pointed at dropping the re-export — the name "BSON" is a domain concept that exists independent of any mongo-driver version, and the implementation pinned the team to one major's class realm. The user's surface-ownership framing (*"PN's codec return types are authoritative; users don't fish types out of a third-party package"*) reframed the barrel from "redundant courtesy re-export" to "the PN-owned import path for BSON classes." The architect-lens verdict shifted: the barrel survives because it serves a stated surface-ownership goal that the architect lens alone hadn't weighted.
- **Principal-engineer's cross-realm `instanceof` footgun** narrowed dramatically once the policy locked to single-major peer range. The footgun is now "user accidentally has two mongodb majors in their install graph" rather than "we ship multi-major support and inevitable cross-realm bugs." Memory-server v11 already aligns with v7 internally, so the most likely source of two-major coexistence resolves itself when we bump.

## References

- Linear ticket: [TML-2663](https://linear.app/prisma-company/issue/TML-2663/mongo-driver-is-pinned-to-version-6-cant-support-7-or-8)
- Project spec: [`./spec.md`](./spec.md)
- Project plan: [`./plan.md`](./plan.md)
- Surface-area recon: [`./research/mongo-surface-area.md`](./research/mongo-surface-area.md)
- Open-questions research: [`./research/open-questions.md`](./research/open-questions.md)
- mongodb npm driver release notes: <https://github.com/mongodb/node-mongodb-native/releases>
- BSON npm package release notes: <https://github.com/mongodb/js-bson/releases/tag/v7.0.0>
- Sub-agent registry for this project: [`./subagent-registry.md`](./subagent-registry.md)
