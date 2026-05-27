# Project learnings: mongo-driver-version-support

Patterns surfaced during the slice that warrant capture before close-out.

### Recon must scan `test/` as well as `src/` when classifying consumer vs non-consumer

**Shape.** During the project's research phase, the recon-specialist classified packages as "consumers" or "non-consumers" of `mongodb` based on `src/` imports alone. The classification was used to derive FR1 (peer-dep consumers) and FR2 (non-consumer packages drop the declaration). At implementation time, `@prisma-next/target-mongo` failed `pnpm typecheck` because three integration tests in `test/` import `MongoClient`, `Db`, and `MongoServerError` from `'mongodb'` — a real dependency the `src/`-only scan missed.

**Why it matters.** Classification drives both the FR shape and the verification mechanism (the structural-coherence checks). A wrong classification at the recon step propagates into the spec, into the plan, into the implementer's brief, and falsifies only at implementation time — the most expensive surface to discover it on. The slice still landed cleanly because the implementer halted-and-surfaced rather than silently rewriting the spec; but the cost of the falsification was real.

**Action.** When a recon-specialist is asked to classify packages by usage of a dependency, the brief should explicitly ask for both `src/` AND `test/` (and any other compilable directory the package owns) to be scanned. The classification matrix should distinguish between "imports at runtime," "imports in tests only," and "no imports at all" — the three distinctions matter for dependency-declaration shape (peerDeps vs devDeps vs absent).

### Slice-plan structural-coherence checks must use real JSON parsing, not line-oriented regex

**Shape.** The slice plan's third structural-coherence check used `rg '"mongodb":' "$pkg/package.json" | rg -q peer` to verify that mongodb was declared in `peerDependencies`. The regex never matches: JSON puts the section name (`"peerDependencies":`) and the entry (`"mongodb":`) on separate lines, so a line-level grep can never see both at once. The implementer manually verified the posture and worked around the broken script.

**Why it matters.** Structural-coherence checks are the slice plan's contract with the implementer: "if these commands all return OK, the posture is correct." A check that returns OK when it shouldn't is worse than no check at all — it gives false confidence. In this slice the implementer caught it because they were grounded in the actual posture; on a noisier slice the false-OK could escape.

**Action.** When writing structural-coherence checks that inspect structured files (JSON, YAML, TOML), use a structure-aware tool (`jq`, `yq`, `dasel`) rather than line-oriented `rg`. Reserve `rg` for unstructured matches (catalog version regex in YAML is acceptable; per-key shape checks in JSON are not). The amended slice plan at `slices/mongo-peer-dep-migration/plan.md § Validation gate` uses `jq` and is the reference shape.

### Slice-plan `Files in play` should distinguish dep-shape boundaries explicitly

**Shape.** FR2 read "declaration absent entirely from `target-mongo` and `family-mongo`'s `package.json`." That sweeps too broadly — it conflates "no runtime declaration" with "no declaration of any kind." The amended FR2 names three buckets (`dependencies`, `peerDependencies`, `devDependencies`) and what is permitted in each.

**Why it matters.** When the spec says "absent entirely" but the implementer's reality is "needed for tests," the spec gives the implementer no graceful path. Either they violate the spec (and surface for amendment, as happened here), or they thrash on rewriting the test imports (worst case). Specs that distinguish runtime declarations from build-time declarations head off this class of escapee.

**Action.** When a non-goal of a slice is "this package should not become a runtime consumer of X," express it as `dependencies` + `peerDependencies` constraints, not as a blanket package.json statement. Build-time dependencies (`devDependencies`) are a separate question that the slice usually has no opinion about.
