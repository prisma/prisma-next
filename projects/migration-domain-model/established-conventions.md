# Established Conventions in Migration Systems

> Synthesis of the six reference systems under [`references/`](./references/) — ActiveRecord, Liquibase, Django, Sqitch, Atlas, Prisma 5/6 — identifying accepted convention, the points where reference systems genuinely disagree, and how each maps to a graph-based migration model.
>
> The goal is to know, for every term we introduce, whether we're borrowing established vocabulary (cheap), deliberately diverging (must be justified), or coining something genuinely new (must be defended). The graph-based cut matters because our model is more permissive than every reference system surveyed: explicit DAG with cycles, ref-typed environment targets, invariant-typed correctness conditions, multi-owner contract spaces.

## Method

For each load-bearing concept, three questions:

1. **What do most surveyed systems call it?**
2. **Where do they disagree, and what's the design pressure behind each choice?**
3. **Does the established vocabulary fit a graph-based migration system? If yes, adopt. If no, name the divergence — and where helpful, propose the verb / noun we'd use instead.**

The synthesis is opinionated: a verdict per concept appears at the end of each section. Verdicts marked *(open)* are not yet settled and need user input.

---

## 1. The unit of change

### Convention

Five of six systems use **migration** as the atomic noun for a step in the schema's history. Only **Liquibase** and **Sqitch** deliberately depart:

- **Liquibase** chose **changeset** because it carries finer-grained operations *inside* a versioned **changelog**; "migration" was reserved for an entire deployment of a changelog, not the atomic unit.
- **Sqitch** chose **change** because the system is graph-shaped and "migration" connotes linear progression — the docs are explicit that `sqitch revert` is *"time travel, not VCS-style revert"* and that the noun choice supports the framing.

### Design pressure

The graph-shaped systems (Sqitch, Django) feel pressure to depart from "migration" because the word smuggles in linear ordering. Sqitch made the swap; Django kept "migration" because the dependency graph is mostly read as a *partial order on a still-fundamentally-sequential history* (per-app numbering, autodetector outputs).

### Fit to our model

We're graph-shaped with cycles — more graph-shaped than Sqitch's strict DAG. The same pressure that pushed Sqitch to "change" applies to us *more strongly*. But every other system uses "migration", and the term is overwhelmingly familiar.

### Verdict

**Adopt "migration" as the user-facing noun, with explicit single-sense definition.** *(open — Sqitch's case for "change" deserves a fair hearing.)* The synonymy between **migration** (the artifact) and **edge** (the graph view) should stay internal and not leak into user-facing CLI. The current overloading — migration as directory, edge, act of applying — must be killed: pick one canonical sense for the user-facing surface.

---

## 2. Identity of a migration

### Convention

**Every system uses two layers:** a human-facing version/name (usually a timestamped folder or filename) and a content-addressed hash that detects tampering.

| System | Human name | Content hash |
|---|---|---|
| ActiveRecord | `YYYYMMDDHHMMSS_name.rb` (numeric version) | none — file-based identity only |
| Liquibase | `author:id:filename` tuple, optional `logicalFilePath` | MD5SUM stored per applied changeset |
| Django | `(app_label, migration_name)` (e.g. `books.0003_auto`) | none on the migration itself — operations are autodetected and migration files are immutable on convention only |
| Sqitch | name + plan-context | full SHA-1 over canonical plan text (Merkle structure across the plan) + `script_hash` per deploy script in the registry |
| Atlas | `{{timestamp}}_{{name}}.sql` (version) | `atlas.sum` integrity manifest — per-file `h1:` hashes + rolled-up root hash |
| Prisma current | `YYYYMMDDHHMMSS_<name>` (folder name) | `checksum` stored in `_prisma_migrations` per applied row |

### Design pressure

The hash exists because **filenames lie**: ActiveRecord, the only system without a content hash, has a documented hazard around edited or deleted migrations producing schema drift. Every system that hash-tracks treats file edits to already-applied migrations as an actionable warning.

The choice of *what the hash covers* matters: Atlas's `atlas.sum` covers the entire directory (forcing VCS merge conflicts on parallel additions); Sqitch's hash covers the plan canonicalization (so file moves don't break identity); Liquibase's covers each changeset's content (with `logicalFilePath` as the escape hatch for renames).

### Fit to our model

Our `migrationHash = sha256((strippedManifest, ops))` is squarely in the Liquibase/Sqitch/Atlas tradition: **content hash over what matters for replay, not what surrounds it**. The "stripped" part — excluding `fromContract` / `toContract` / `hints` — is the same pressure Liquibase addresses with `logicalFilePath`: cosmetic context shouldn't perturb identity.

The two-layer split (human-facing version + content hash) is universal. The user-facing surface should show the human name; the hash is an integrity claim, surfaced when it matters (verification, drift, push).

### Verdict

**Adopt the two-layer identity model:** human-facing migration name + content-addressed hash. **Use `migrationHash` (we already do) and surface it as the integrity claim, not as the user-facing name.** The user types names; the system trusts hashes.

---

## 3. Database-side state tracking

### Convention

**Every system maintains a database-side ledger** of which migrations have been applied:

| System | Table / scheme |
|---|---|
| ActiveRecord | `schema_migrations` (column: `version`) |
| Liquibase | **DATABASECHANGELOG** (DBCL) — current applied set; optional **DATABASECHANGELOGHISTORY** (DBCLH) — append-only history including rollbacks |
| Django | `django_migrations` (`(app, name)` per row, `applied` timestamp) |
| Sqitch | **registry** — split: `changes` (currently deployed), `events` (full history with `deploy`/`revert`/`fail`/`merge` event types) |
| Atlas | `atlas_schema_revisions` |
| Prisma current | `_prisma_migrations` (with `checksum`, `logs`, `finished_at`, `rolled_back_at`, `applied_steps_count` columns) |

### Design pressure

**Sqitch's two-table split is unusual and load-bearing.** Most systems overload one table for "what's currently applied" and "what happened over time". Sqitch separates them deliberately: `changes` is queried for routing decisions, `events` is the audit log. Liquibase Secure follows the same pattern (DBCL vs DBCLH).

The split matters when **rollback removes rows**: in Liquibase, a successful `rollback` deletes the DBCL row but appends a DBCLH event. In Sqitch, `revert` deletes the `changes` row and writes a `revert` event. In most others (Rails, Django, Atlas, Prisma), reverting unrows the ledger without preserving the history — the only way to know it happened is application logs.

### Fit to our model

We already split: **marker** (per-space, framework-issued *guarantee record* of current state) + **ledger** (optional audit log, user-owned, never read for routing decisions). ADR 208 names the split principle: *"the marker is the truth-of-record; the ledger is an audit artifact"*. This is **directly homologous to the Sqitch / Liquibase Secure split**.

Our marker also carries information no other system tracks: `invariants[]` (per ADR 208) and per-space ownership (per ADR 212). That's a genuine extension of the marker concept, not a rename.

### Verdict

**Adopt "marker" and "ledger" as user-facing terms** — they're already what we use internally and they map cleanly to Sqitch's two-table split, which is the established convention for graph-shaped systems. Document the marker as *"the database's record of what state it's at right now"* and the ledger as *"the audit log of what was applied, when, by whom"*. Don't reuse "schema_migrations" / "_prisma_migrations" naming — it implies a single-purpose table our split deliberately rejects.

---

## 4. Ordering model

### Convention

| System | Model |
|---|---|
| ActiveRecord | Strict linear by timestamp filename |
| Liquibase | Strict linear by changelog inclusion order |
| Django | DAG (per-app + cross-app `dependencies` + `run_before` reverse edges); execution linearizes |
| Sqitch | DAG (`requires` / `conflicts`); execution linearizes |
| Atlas | Versioned mode: linear (Merkle-enforced); declarative mode: stateless |
| Prisma current | Strict linear |

**Linear is the dominant model.** Django and Sqitch are the only DAG-based reference systems, and even they linearize execution.

### Design pressure

Linear systems treat **VCS merge conflicts** as the team's serialization mechanism (Atlas's `atlas.sum` makes this explicit and load-bearing). DAG systems pay a vocabulary cost (`dependencies` edges, `requires` / `conflicts` declarations) to support out-of-order authoring; the payoff is that two developers can add migrations on separate branches without colliding *if* the dependency graph permits it.

**No surveyed system permits cycles.** Sqitch fails with a cycle detection error; Django raises `CircularDependencyError`. Cycles imply rollback paths (`C1 → C2 → C1`), which everyone else handles by `revert` / `rollback` *deleting* the C1→C2 ledger row — not by walking a cycle forward.

### Fit to our model

We're a **cyclic graph**. Per the [Migration System subsystem doc](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md): *"The graph tolerates cycles (e.g. rollback migrations like C1→C2→C1) — the pathfinder uses BFS with visited-node tracking to select the shortest path."*

This is a real divergence from every surveyed system. The vocabulary cost: "rollback" doesn't unrow the ledger; instead, the user applies a *forward* migration whose `to` happens to equal a prior state. Most users will arrive at this surface with "rollback" already meaning "undo the last forward step" (Rails / Liquibase) or "delete the row" (Django / Prisma). We owe a clear explanation that **our model has no `down` migration concept** — rollback is forward-applied to a destination of the user's choice.

### Verdict

**We must name the divergence explicitly.** The user-facing materials need a paragraph that says, in essence: *"unlike most migration systems, we don't have `up` and `down` migrations. Every migration is forward-applied; if you want to return to a prior state, you author a migration whose destination is that state, or `migrate --to <prior-ref>` to use existing graph paths."* Failing to name this will collide with every user's prior expectation.

**Verb for "go back to an earlier state": likely `migrate --to <earlier-ref>`** (matches Atlas / Django pattern: `migrate <app> <earlier_migration>`). **Avoid `rollback` and `revert` as user-facing verbs** — they import semantics we don't honor. **`undo` is also out** (same problem).

---

## 5. Source of truth for desired state

### Convention

The strong modern trend is **declarative source-of-truth**:

| System | Desired state lives in |
|---|---|
| ActiveRecord | Implicit (replay history → `schema.rb`) |
| Liquibase | The changelog itself — no separate schema file |
| Django | Python model files (`models.py`) |
| Sqitch | Implicit (replay scripts) |
| Atlas | HCL or SQL schema files — **explicit "desired state" / "current state" framing** |
| Prisma current | `schema.prisma` — explicit |

Atlas and Prisma make the split explicit in user-facing prose: there's an authoring surface (schema file), there's a generated path (migration files), there's a live database (current state). Everyone else treats the schema as a *derived* artifact of replaying migrations.

### Design pressure

Declarative source-of-truth lets the system **generate migrations from a diff** (`atlas migrate diff`, `prisma migrate dev`, `prisma db push`, `makemigrations` autodetector). Imperative-only systems (Liquibase, Sqitch, Rails) force the developer to author the operations themselves.

The trade-off: declarative systems own the schema lifecycle (which means they have to handle every DDL form their target supports); imperative systems delegate to the developer.

### Fit to our model

**`contract.json` (and its PSL/TS authoring surfaces) is our declarative source of truth.** We're firmly in the modern declarative camp. The contract emits to artifacts; the planner diffs prior and current contracts; the developer fills in placeholders for data transforms only.

### Verdict

**Adopt the explicit "desired state" / "current state" framing** from Atlas verbatim where useful — it makes the conversation clearer than alternatives. "Desired state = the state declared by the contract (plus the ref's required invariants)"; "Current state = what the marker reports". Every CI/CD diagnostic becomes phraseable in those terms.

---

## 6. Verb taxonomy

### Convention

The verbs that recur across systems:

| Concept | ActiveRecord | Liquibase | Django | Sqitch | Atlas | Prisma current |
|---|---|---|---|---|---|---|
| Apply forward | `db:migrate` | `update` | `migrate` | `deploy` | `migrate apply` / `schema apply` | `migrate deploy` |
| Undo step | `db:rollback` | `rollback` | `migrate <earlier>` | `revert` | `migrate down` | `migrate resolve --rolled-back` (bookkeeping only) |
| Author new | `generate migration` | (edit changelog) | `makemigrations` | `add` | `migrate diff` | `migrate dev --create-only` |
| Inspect status | `db:migrate:status` | `status` / `history` | `showmigrations` | `status` | `migrate status` | `migrate status` |
| Preview / dry-run | (implicit) | `update-sql` (preview) | `--plan` | (implicit) | `--dry-run` / `migrate diff` | `migrate diff --script` |
| Mark applied without running | (manual) | `changelog-sync` / `mark-next-changeset-ran` | `migrate --fake` | `--log-only` | `migrate set` / `--baseline` | `migrate resolve --applied` |
| Validate against live DB | (none) | `diff` | (none) | `verify` / `check` | `schema inspect` / `schema diff` | `migrate status` |
| Reset / drop & rebuild | `db:reset` / `db:migrate:reset` | `drop-all` | `migrate <app> zero` | (chain revert) | `schema clean` | `migrate reset` |

**Almost universal verbs:** apply / deploy / migrate / update; status; some form of undo; some form of dry-run; some form of mark-as-applied for adoption.

### Design pressure

The split between **apply forward** and **status** is universal — every system has both. The split between **author** and **apply** is universal too — but only Atlas and Prisma name them with distinct top-level verbs (`diff` vs `apply`). Most others entangle them (`db:migrate` runs the dev autodetector implicitly; Liquibase `update` reads the changelog mid-apply).

The split between **dev** and **deploy** semantics is a **Prisma-current innovation**: every other system uses the same verbs with different connection URLs. Our `db update` (dev) vs `migration apply` (deploy) follows the Prisma pattern, not the universal one.

### Fit to our model

**The user's proposed `prisma-next migrate --db URL --to <ref>` is excellent vocabulary.**

- `migrate` as a verb is **the most common forward-execution verb across the surveyed systems** (Rails, Django, Atlas, Prisma all use it).
- `--db URL` parameterizes the target, matching Atlas's URL-as-first-class-target convention.
- `--to <ref>` matches Django (`migrate <app> <migration>`) and Atlas (`--to`) directly.

Some additional verbs we'll need that are well-established:

- **`status`** — universal. Adopt.
- **`apply`** vs **`migrate`** — synonyms in most systems; we should pick *one* canonical user-facing verb. `migrate` is more common; `apply` is what we currently use.
- **`plan`** / **`diff`** — preview / authoring. Atlas uses `migrate diff` for "generate the next migration"; we use `migration plan` for the same thing. Both terms are established; ours is fine.
- **`show`** — universal for "show me this thing". Adopt.

### Verdict

**Adopt the user's proposed `migrate --db URL --to <ref>` as the canonical forward-execution verb.** Everything else aligns with established convention except possibly the dev/deploy split (which is Prisma-specific and worth preserving since our `db update` workflow is genuinely dev-only). *Open question: do we collapse `migration apply` and `migrate` into one verb? They differ today only in whether they take a `--to <ref>` argument or implicitly apply pending migrations.*

---

## 7. Dev vs Production split

### Convention

- **Most systems use the same verbs with different connection URLs.** Rails, Liquibase, Django, Sqitch, Atlas all do this.
- **Prisma current introduced an explicit verb-level split:** `migrate dev` (replays history through a shadow DB, detects drift, generates new migrations, applies, updates the ledger, runs the generator) vs `migrate deploy` (applies pending migrations and nothing else).
- **Atlas's `--dev-url`** is in this tradition but at the *flag* level — the dev database is a compilation sandbox, not a separate command surface.

### Design pressure

The dev/deploy split exists because **the safety nets that make a dev workflow ergonomic are dangerous in production**: shadow-replay drift detection requires the ability to drop and recreate a sibling database; autodetected migration generation requires writing to the project tree; reset / migrate-down assumes the data is safe to lose. Prisma's docs are explicit: *"`migrate deploy` does not detect drift, does not reset, does not use a shadow database"*.

The cost: two verbs for what users initially think is one operation. Atlas avoided this by parameterizing instead.

### Fit to our model

Our **`db update` (dev) vs `migration apply` (deploy)** is the Prisma pattern, by intent. The user confirmed `db update` is a first-class dev-only workflow.

The user's proposed `migrate --db URL --to <ref>` is closest to Atlas's parameterized-target model. **Combining both could read as `migrate --db URL --to <ref>` for the production verb (precise, ref-typed) and a separately-named convenience for dev (today: `db update`).**

### Verdict

**Preserve the dev/deploy split, but reconsider the vocabulary.** *(open — depends on how much we want to lean into Prisma-current's framing vs. Atlas's parameterized framing.)* The dev verb could be `db update` (today's name; clear; but `db` namespace is heterogeneous) or `migrate dev` (mirrors Prisma; explicit). The production verb is `migrate --to <ref>` (user's preference). The shadow-database concept may or may not surface as user-facing — today we don't use shadow DBs, but Atlas and Prisma both rely on them for diff safety; this is a real design space we haven't filled.

---

## 8. Adoption / baselining

### Convention

**Every system has a way to adopt an existing database** without running its history from scratch:

- ActiveRecord: `db:schema:load`.
- Liquibase: `changelog-sync` (marks all changesets as applied without running them); `changelog-sync-to-tag`.
- Django: `--fake` / `--fake-initial` (`--fake-initial` is the special-cased "check tables/columns exist, mark first migration applied").
- Sqitch: `--log-only` on `deploy` (writes registry rows without running scripts).
- Atlas: `--baseline <version>` (first apply marks that migration applied, continues with later) / `--allow-dirty` (first apply against non-empty DB).
- Prisma current: `migrate resolve --applied <migration>` ("pretend this migration ran").

**The common pattern:** a flag or verb that **writes a ledger row without executing the migration's SQL**, used during onboarding.

### Design pressure

Adoption is a different operation from forward execution, with different safety constraints — the database already has the structure; running CREATE TABLE again would fail. Atlas's split between **baseline** (mark a specific version as applied, then continue) and **allow-dirty** (apply normally against a non-empty DB) captures two distinct adoption shapes.

### Fit to our model

Our `db init` is the adoption / bootstrap entry point. ADR 122 names three adoption paths (greenfield, brownfield-conservative, brownfield-incremental). The vocabulary is already richer than most surveyed systems.

The user-facing question is what the *verb* should be. Today: `db init`. Alternative: `migrate --init` (parameterizes the same verb). Most surveyed systems use a distinct verb or flag for the adoption case — the operation is rare enough that a different name helps.

### Verdict

**Keep adoption as a distinct verb.** *(open — `db init` vs `migrate --init` vs something else.)* The three adoption paths from ADR 122 can stay internal; the user-facing experience is a single command. Don't import the word "baseline" wholesale — it has too many meanings across systems (Atlas's baseline ≠ Prisma's baseline ≠ Django's `--fake-initial`); if we use it, single-sense definition required.

---

## 9. Drift

### Convention

**Every system that does anything beyond pure replay has a concept of "drift"**:

- Liquibase: `diff` between live DB and changelog state.
- Atlas: schema drift between `--url` and `--dir` after the fact; `atlas migrate apply` blocks on unclean DB.
- Prisma current: shadow-replay-vs-dev-DB drift in `migrate dev`; checksum drift for tampered files; the docs distinguish "drift" (live ≠ history) from "tampered migration" (file ≠ original checksum).

ADR 123 (our own) is far more granular than any surveyed system: marker-level, schema-level, graph-level, capability, transactional, cache/freshness, canonicalization. **Most users will arrive with the simpler Prisma / Atlas mental model: drift = live DB diverges from history.**

### Design pressure

Drift is a runtime concept (the database can change underneath us); systems differ in how aggressively they police it. Prisma's `migrate deploy` *does not detect drift* — it trusts the operator. Atlas's `migrate apply` *does* (the revisions table is the source of truth).

### Fit to our model

We have the richest drift vocabulary of any surveyed system, but the user-facing surface should expose the simpler split: **marker drift** (the database's recorded state diverges from contract) vs **schema drift** (the recorded state matches contract but the live schema doesn't). Sub-classifications (orphan markers, hash mismatches, etc.) belong in the diagnostic envelope, not the user-facing vocabulary.

### Verdict

**Adopt "drift" as the user-facing umbrella term.** Distinguish at least **marker drift** and **schema drift** at the user-facing level; the full ADR 123 taxonomy belongs in the diagnostics, not the command names. Don't invent a parallel vocabulary.

---

## 10. Concepts genuinely unique to our model

These are the points where our domain genuinely extends or diverges from the surveyed systems' vocabulary. Each requires a justified term; established convention provides no direct analog.

### 10.1 Refs

**No surveyed system has refs as first-class.** Branching is universally a VCS concern; environments are connection URLs. Sqitch's `targets` are URL aliases, not state-bearing.

Our refs (`migrations/refs/<name>.json` carrying `{ hash, invariants }`) **are a real novelty.** The most direct analog is **Git's refs** — and the user explicitly anchored on Git.

**Verdict:** Keep "ref" as the term. Borrow Git's semantics where they fit: refs are file-based, version-controlled, named by the team, and movable via deliberate commands. Avoid analogies to "environment" — refs declare intent for an environment, but they aren't the environment itself.

### 10.2 Invariants

**No surveyed system has invariants as first-class.** Sqitch's `verify` scripts are the closest analog (postconditions checked after deploy), but they're per-change, not per-ref. Liquibase's `preconditions` are gates, not state assertions about *correctness after data work*.

Our data invariants are a real extension of the model. The term is technical but precise; no surveyed system has a clearly better word for the same thing.

**Verdict:** Keep "invariant" as the term. The vocabulary cost is real (users won't know it from prior tools) and the payoff is being able to talk about *"this ref requires the `backfill-user-phone` invariant to hold"* as a discrete, checkable claim. Sqitch's `verify` is a related but narrower concept — don't borrow the verb; it suggests "run a check" rather than "this property must be true".

### 10.3 Contract spaces

**Closest analog: Django's cross-app dependencies.** Django models multiple "apps" each owning a slice of the schema, with dependencies between them. Sqitch's foreign-project references (`otherproject:change`) are similar. No surveyed system has the *pinned-mirror on disk* pattern — extensions ship their own contract + migration graph, and the framework materializes them into the consuming application's repo.

**Verdict:** "Space" / "contract space" is novel vocabulary. The term is reasonable (it conveys "disjoint ownership boundary"), but it's load-bearing and the user-facing surface needs to introduce it carefully. The app/extension distinction maps cleanly to Django's app concept, but with stronger ownership boundaries: extensions cannot be edited by the consuming application.

### 10.4 Cycles in the graph

**No surveyed system permits cycles.** Sqitch and Django explicitly reject them with named errors.

Our cyclic graph enables "rollback" as a forward-applied migration to a destination of choice — but the word "rollback" carries the wrong baggage from every surveyed system. We need a different verb (see § 4 above).

**Verdict:** Don't expose cycles as a user-facing concept. The path-finding algorithm handles them; the user's mental model is *"every state I've been at is a destination I can migrate to"*. The vocabulary is `migrate --to <earlier-ref>` and the BFS picks the shortest path.

### 10.5 Emission

**Closest analog: Atlas's `migrate diff`** (generate a migration file from a desired-state input). Prisma's `migrate dev` does the same thing implicitly. No surveyed system has a separate verb for "compute the canonical artifacts from authoring sources" the way we do.

**Verdict:** "Emit" / "emission" is internally established and precise. For user-facing, `contract emit` is acceptable (Atlas / Prisma users will recognize the pattern from `migrate diff` / `migrate dev`). The dual emission paths — contract emission and migration self-emission — should be named consistently. `prisma-next migration plan` is the analog of `atlas migrate diff` and the right user-facing verb for *generating a migration package from a contract diff*.

---

## Summary: Adopt / Diverge / Avoid

The audit-against-CLI step (the ticket's stated final goal) walks this table for every existing command.

| Established convention | Verdict | Notes |
|---|---|---|
| **migration** (the unit of change) | **Adopt**, single-sense | Kill the directory / edge / act overload. *(open — Sqitch's "change" case)* |
| **two-layer identity** (name + content hash) | **Adopt** | Already do via `migrationHash`. Surface name to users, hash in integrity claims. |
| **marker** / **ledger** split | **Adopt** | Maps to Sqitch's `changes` / `events` and Liquibase Secure's DBCL / DBCLH. |
| **strict linear** ordering | **Diverge** | Our graph is cyclic. Name the divergence explicitly. |
| **`up` / `down` / `rollback` / `revert`** | **Avoid** | These import linear-undo semantics we don't honor. Use `migrate --to <earlier-ref>`. |
| **declarative source of truth** | **Adopt** | `contract.json` is our `schema.prisma` / `atlas.hcl`. |
| **"desired state" / "current state"** framing | **Adopt** verbatim from Atlas | Phrasable in user diagnostics; clearer than alternatives. |
| **`migrate` as forward-execution verb** | **Adopt** | User's `migrate --db URL --to <ref>` is excellent and matches Rails/Django/Atlas/Prisma. |
| **`status` for inspection** | **Adopt** | Universal. |
| **`plan` / `diff` for migration authoring** | **Adopt** | `migration plan` is the analog of `atlas migrate diff`. |
| **dev / deploy verb split** | *(open)* | Currently follow Prisma's pattern via `db update` (dev) vs `migration apply` (deploy). Atlas-style parameterization is an alternative. |
| **adoption as distinct verb** | **Adopt** | Today's `db init`. Don't import "baseline" wholesale. |
| **drift** | **Adopt** with two-level surface | Marker drift vs schema drift in user-facing prose; ADR 123's full taxonomy in diagnostics. |
| **refs** (named pointers to desired state) | **Novel — keep, anchor on Git** | No surveyed migration system has this. Borrow Git's mental model. |
| **invariants** | **Novel — keep** | Sqitch's `verify` is narrower; we want the broader correctness primitive. |
| **contract spaces** | **Novel — keep** | Django's apps + Sqitch's foreign-project refs are closest analogs; neither is sufficient. |
| **cyclic graph** | **Novel — don't expose** | Path-finding handles cycles internally; users see only refs and `migrate --to`. |
| **emission** (canonical artifacts from authoring source) | **Adopt the underlying concept; keep `emit` as the verb** | Atlas's `migrate diff` is the closest analog. Our `contract emit` and migration self-emission share the verb. |
| **shadow database** | *(open)* | Atlas and Prisma both rely on shadow DBs for diff safety. We don't today. Possibly a future addition. |
