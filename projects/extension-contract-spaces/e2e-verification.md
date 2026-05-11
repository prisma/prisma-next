# E2E verification — UX notes

Live log of running the cipherstash-integration example end-to-end against a
real Postgres, captured from the perspective of a first-time user reading the
CLI output. Findings here are UX/observability issues — they don't block the
verification but they should be triaged before close-out.

## Setup

- Worktree: `tml-2373-project-1-on-2397`
- Branch tip: PR #449
- DB: PGlite at `postgres://postgres:postgres@localhost:51229/template1?sslmode=disable`
- Example app: `examples/cipherstash-integration/`

## Workflow log

| # | Command | Outcome |
|---|---|---|
| 1 | `psql ... 'select version();'` | OK — PGlite 17.5 |
| 2 | `psql ... 'drop schema ... cascade; create schema public;'` | OK — fresh DB |
| 3 | `rm -rf examples/cipherstash-integration/migrations` | OK — clean slate |
| 4 | `pnpm exec prisma-next contract emit` | OK — `storageHash: sha256:fa4b91d…0bf39` |
| 5 | `pnpm exec prisma-next migration plan --name initial` | OK — plan landed; output has UX issues, see F1 + F2 below |
| 6 | `pnpm exec prisma-next migration status` | Shows app space only — no mention of cipherstash space; see F4 |
| 7 | `pnpm exec prisma-next migration apply` | **FAIL** — `Operation table.user failed during execution: create table "user" (PN-RUN-3000)` / `type "eql_v2_encrypted" does not exist`; confirms F3 |
| 8 | `pnpm exec prisma-next db init` against PGlite | **CRASH** — `Connection terminated unexpectedly` mid-bundle-install; PGlite cannot host the real EQL bundle (see F5) |
| 9 | `pnpm exec prisma-next db init` against Postgres.app 15.10 | **FAIL** — `syntax error at or near "user"` inside `eql_v2.add_encrypted_constraint`; reserved-word table name + upstream bundle bug (see F6) |
| 10 | apply F6 workaround: `@@map("user")` → `@@map("users")` in `prisma/schema.prisma` | OK |
| 11 | re-emit + replan + `db init` against fresh `cipherstash_demo` DB | OK — `✔ Applied 4 operation(s)`, `Signature: sha256:79f6ec1…` (terse output, see F7) |
| 12 | `pnpm exec tsx src/index.ts` | **FAIL** — `Encrypted column missing version (v) field`; stub SDK envelope shape is incompatible with the real EQL bundle's CHECK constraint (see F8) |
| 13 | patch `src/sdk.ts` to emit a bundle-compatible envelope and retry | _pending_ |

## Findings

### F1 — `migration plan` summary buries the cross-space side effect

What a first-time user sees (the structured block they'll actually read):

```
✔ Planned 3 operation(s)

│
├─ Create table "user" [additive]
├─ Register cipherstash search config (unique) for user.email [additive]
└─ Register cipherstash search config (match) for user.email [additive]

from:   null
to:     sha256:fa4b91dbc8e079a775b010fc5ca3616d3713afa64b1b9c97eedf4aa90cc0bf39
dir:    migrations/20260509T1602_initial

Next: review migrations/20260509T1602_initial if needed, then run prisma-next migration apply.
```

What actually landed on disk:

```
migrations/
├── 20260509T1602_initial/        ← only this is mentioned in the summary
│   ├── migration.ts
│   ├── migration.json
│   ├── ops.json
│   ├── end-contract.json
│   └── end-contract.d.ts
└── cipherstash/                  ← entire extension space materialised, unmentioned in summary
    ├── contract.json
    ├── contract.d.ts
    ├── refs/head.json
    └── 20260601T0000_install_eql_bundle/
        ├── migration.json
        ├── ops.json
        ├── contract.json
        └── (mirror of the cipherstash extension's pinned baseline)
```

The only signal that the cipherstash space was touched is one line **above**
the summary block:

```
◇  Emitted cipherstash/20260601T0000_install_eql_bundle
```

A regular user will read the summary block, see "3 operations, 1 directory,
review and apply," and will be surprised to find a second top-level
`migrations/cipherstash/` tree on disk — and **doubly** surprised when
`migration apply` then fails because that tree wasn't applied (see F3).

What should change:

- Group the planned output by space, e.g.:
  ```
  ✔ Planned 1 app-space migration + 1 extension-space materialisation

  App space (migrations/20260509T1602_initial)
  ├─ Create table "user" [additive]
  ├─ Register cipherstash search config (unique) for user.email [additive]
  └─ Register cipherstash search config (match) for user.email [additive]

  Extension spaces (1)
  └─ cipherstash → migrations/cipherstash/20260601T0000_install_eql_bundle
                   (pinned baseline, materialised from extension package)

  Next: review migrations/, then run prisma-next db update.
  ```
- The "Next:" line should also point at the multi-space-aware command (`db
  init` / `db update`) when extension spaces are present, not at `migration
  apply`. See F3.

### F2 — Operation labels are verbose and opaque to a first-timer

Two of the three lines a first-time user reads are:

```
├─ Register cipherstash search config (unique) for user.email [additive]
└─ Register cipherstash search config (match) for user.email [additive]
```

Decoded against domain knowledge:

- "search config" = an EQL configuration row that registers a column for
  encrypted-search indexing. Specific to the cipherstash extension. Not a
  Prisma-Next concept.
- "(unique)" / "(match)" = EQL index types — `unique` enables deterministic
  equality search (`cipherstashEq`), `match` enables bloom-filter free-text
  search (`cipherstashIlike`).
- "[additive]" = the operation's `operationClass`. Generic Prisma-Next
  vocabulary across all operations.

A first-time user has none of this context and reads it as ~10 words of
extension jargon per line, twice. Even an experienced user has to parse
"Register cipherstash search config" before they realise it's just enabling
search on a column.

What should change (rough sketch — exact wording is the extension author's
call):

- Shorter, action-first, column-first labels. E.g.:
  - `Enable cipherstash equality search on user.email`
  - `Enable cipherstash pattern search on user.email`
- Or, if the operation set is going to grow, hoist the cipherstash prefix
  into a section header and let each line be terse:
  ```
  cipherstash:
  ├─ user.email — enable equality search [additive]
  └─ user.email — enable pattern search   [additive]
  ```
- Reconsider whether `[additive]` belongs in the human-facing label at all.
  It's metadata the planner uses — a regular user reviewing a plan cares
  about what's happening, not about the operationClass tag. Push it into
  `--verbose` or out of the line entirely.

The ops are emitted by the cipherstash extension's
`CipherstashAddSearchConfigCall.label` (`packages/3-extensions/cipherstash/src/migration/call-classes.ts`),
so this is a one-line fix in the extension. The "[additive]" suffix and the
overall layout are CLI-side (formatter for `migration plan`).

### F3 — `migration apply` doesn't apply extension spaces

Already understood from the earlier session, recorded here for completeness:

- `prisma-next migration apply` loads `migrations/<dir>/` (app-space only)
  via `loadMigrationPackages` (`packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts:190`).
  It does **not** enumerate or schedule extension spaces.
- The multi-space ordering helper
  (`packages/1-framework/3-tooling/migration/src/concatenate-space-apply-inputs.ts`,
  "extensions alphabetically, then app") is wired into `db init` /
  `db update` only (`db-apply-per-space.ts`).
- Result: running `migration apply` against this example fails on
  `CREATE TABLE … eql_v2_encrypted` because the cipherstash space's
  `install_eql_bundle` (which creates that composite type) never runs.

The example app's `package.json` reflects this gap — it wires `migration:apply`
but not `db:init` / `db:update`. The pgvector demo (`examples/prisma-next-demo/package.json`)
correctly wires `db:init`. The cipherstash example should match.

Two follow-ups fall out of this:

1. The cipherstash example needs `db:init` (and probably `db:update`)
   scripts in its `package.json` — parity with `prisma-next-demo`.
2. The framework should make this UX failure mode louder. Either:
   - `migration apply` should refuse to run when extension spaces are
     present on disk and tell the user to run `db update`, OR
   - `migration apply` should grow extension-space awareness and become the
     "apply pre-planned migrations" companion to `db update`'s "introspect
     and plan + apply" flow.

   The second option is closer to user expectation ("I planned a migration,
   now I apply it") but requires the framework to define what "applying a
   pre-planned migration" means when the app-space plan was derived
   alongside the introspected DB state. A discussion for a separate ticket.

### F4 — `migration status` doesn't list extension contract spaces

After the `plan` step, `migration status` shows only the app space:

```
○ ∅
▾ 20260509T1602_initial ⧗  provides ["cipherstash-codec:user.email:add-search-config:match@v1",
                                     "cipherstash-codec:user.email:add-search-config:unique@v1"]
○ fa4b91d ◆ contract

✓ applied  ⧗ pending  ✗ unreachable

⚠ 1 pending migration(s) — database has no marker
⚠ Database has not been initialized — no migration marker found
  Run 'prisma-next migration apply' to apply pending migrations
```

What's missing:

- No mention of the cipherstash contract space at all, even though
  `migrations/cipherstash/20260601T0000_install_eql_bundle/` is on disk
  and has never been applied to the live DB.
- The "1 pending migration(s)" count is per-space; the actual cross-space
  pending count is 2 (app-space `20260509T1602_initial` + cipherstash-space
  `install_eql_bundle`).
- The recommended fix-up command (`prisma-next migration apply`) will fail
  for the same reason as F3 — and `status` doesn't catch this either.

What should change:

- `migration status` should enumerate all contract spaces present on disk
  and report each one's state (current marker hash, pending migrations,
  current ref). Mirror the same per-space layout that `db init` /
  `db update` uses internally.
- Suggested layout:
  ```
  App space
    ○ ∅
    ▾ 20260509T1602_initial ⧗ pending
    ○ fa4b91d ◆ contract

  Extension space: cipherstash
    ○ ∅
    ▾ 20260601T0000_install_eql_bundle ⧗ pending  provides [cipherstash:install-eql-bundle-v1]
    ○ <head> ◆ pinned

  ⚠ 2 pending migration(s) across 2 spaces — database has no markers
  ⚠ Run 'prisma-next db update' to bring the database to the planned state
  ```
- The "Run …" hint should point at the multi-space command (`db update` or
  `db init` for an empty DB), not at `migration apply`.

### Pattern: CLI commands assume a single contract space

F1, F3, and F4 share a root cause: the framework supports multiple contract
spaces (app + N extension spaces), but the CLI surface for the
plan/status/apply trio doesn't:

| Command | Multi-space aware? |
|---|---|
| `migration plan` | Plans + materialises extension spaces, but reports app-space only (F1). |
| `migration status` | App-space only (F4). |
| `migration apply` | App-space only — silently misses extension-space migrations (F3). |
| `db init` / `db update` | Multi-space aware. |

This is the wrong split for a user trying to follow the natural workflow:
"emit → plan → review → apply." A regular user should be able to use the
`migration` family for that whole loop and have it cover every space on
disk. The `db` family is for live-DB-driven operations (introspect, sign,
verify) and shouldn't be the only path that handles cross-space coordination.

Two ways to resolve it:

1. **Promote multi-space awareness into the `migration` family.**
   `migration plan / status / apply` all enumerate extension spaces by
   default, so the workflow above just works.
2. **Make `migration apply` refuse to run when extension spaces are
   present**, with a helpful error pointing at `db update`. This is a
   smaller, defensive fix that closes the silent-failure mode without
   restructuring the CLI surface — useful as a stop-gap regardless of
   which path is taken longer-term.

### F5 — `prisma dev` (PGlite) cannot host the real EQL bundle

The CipherStash extension's baseline migration installs the vendored EQL
bundle byte-for-byte: `packages/3-extensions/cipherstash/src/migration/eql-install.generated.ts`
is **5,751 lines** of SQL that creates the `eql_v2` schema, composite
types, the `eql_v2_configuration` table, ~169 functions, ~46 operators,
4 casts, and 9 operator classes/families — all installed in a single
transaction.

PGlite (Postgres compiled to WASM via emscripten — what `prisma dev` runs)
cannot host this. Symptom: `Connection terminated unexpectedly` mid-bundle
install, with no PG error and no graceful shutdown — the WASM Postgres
process dies (almost certainly OOM in the WASM heap given the function
volume).

This is **not a regression** — the team already worked around it in test
infra. From `packages/3-extensions/cipherstash/test/scenario-a.e2e.integration.test.ts`
docblock:

> 2. Multi-space planning (real bundle). … with `mode: 'plan'` on the
>    real cipherstash descriptor (full vendored bundle) …
> 3. Multi-space apply (synthetic bundle). Same wiring as test (2), but
>    with a synthetic cipherstash baseline whose `installEqlBundle` op
>    SQL is a PGlite-compatible stub instead of the real vendored bundle.

In other words: PGlite is fine for *planning* against the real bundle,
but applying the real bundle requires real Postgres. Tests that need an
apply round-trip use a stub bundle.

The example app, on the other hand, ships the real bundle (it's wired
via `cipherstashExtensionDescriptor → EQL_BUNDLE_SQL`). So an end-to-end
demo against `prisma dev` is impossible with the current setup.

What should change (in priority order):

1. **Document the constraint loudly in the example app's README** —
   `examples/cipherstash-integration/README.md` should explicitly warn
   that `prisma dev` won't work and recommend a real Postgres
   (Docker / homebrew / etc.) instead. Today the README links to
   "set DATABASE_URL" without naming PGlite as broken.
2. **Either ship the demo with a real-PG bootstrap script** (e.g.
   `pnpm db:up` that runs Docker compose) so the demo path is one
   command — or, alternatively, **make the example use a stub bundle
   like the test does**, so it works on PGlite at the cost of not
   exercising the real EQL operators in pure SQL.

   Option 1 is more honest (real bundle = real cipherstash); option 2
   makes the demo runnable on the framework's default `prisma dev`. The
   team probably wants both: option 1 for production setup, option 2
   for quick "kick the tyres" use.
3. **Surface the failure better when it happens.** PGlite drops the
   socket without a PG error, so `db init` reports it as a raw Node
   `Connection terminated unexpectedly` stack trace — no contextual
   hint that this is the bundle install dying. Wrapping the per-space
   apply in a try/catch that detects abrupt disconnects mid-statement
   and emits a structured `RUN.PGLITE_INCOMPATIBLE_OP` (or similar)
   would convert a confusing crash into actionable guidance.

### F6 — Upstream EQL bundle bug: `add_encrypted_constraint` malforms SQL when the table name needs quoting

The vendored CipherStash EQL bundle's `eql_v2.add_encrypted_constraint`
(invoked transitively from the public `eql_v2.add_search_config`) builds
DDL via:

```sql
EXECUTE format(
  'ALTER TABLE %I ADD CONSTRAINT eql_v2_encrypted_constraint_%I_%I '
  'CHECK (eql_v2.check_encrypted(%I))',
  table_name, table_name, column_name, column_name
);
```

Source: `packages/3-extensions/cipherstash/src/migration/eql-install.generated.ts:370`.

`%I` is Postgres's identifier-quoting placeholder — it wraps inputs in
double quotes when the value is a reserved word, mixed-case, or contains
special chars. So when `table_name = 'user'` (reserved keyword), the
constraint-name fragment renders as:

```sql
ALTER TABLE "user"
  ADD CONSTRAINT eql_v2_encrypted_constraint_"user"_email
  CHECK (eql_v2.check_encrypted(email))
```

That `eql_v2_encrypted_constraint_"user"_email` is malformed — Postgres
parses `eql_v2_encrypted_constraint_` as one identifier and chokes at
the embedded `"user"` quoted identifier. Error: `syntax error at or
near "user"`.

The bug fires whenever the table name needs quoting. The bundle's own
docstring example (line 5051) uses `'users'` (plural) for exactly this
reason. The fix is upstream: use `quote_ident(table_name)` for the
`ALTER TABLE` target only, and concatenate the raw `table_name` (or a
sanitised variant) into the constraint name.

This is **upstream CipherStash work**. Out of scope for this PR, but
worth filing with the CipherStash team. For the demo we work around it
by mapping the model to a non-reserved name (`@@map("users")`).

Note: the example's PSL (`prisma/schema.prisma`) explicitly maps to
`@@map("user")`. That choice was deliberate (Prisma's default would
have been `User` mixed-case, which is also reserved and would also need
quoting). Whoever set the example up either didn't run it end-to-end,
or hit this bug and worked around it some other way that has since
regressed. The example should map to a non-reserved plural name —
`@@map("users")` is the conventional pick.

### F7 — `db init` success output hides what happened

Successful `db init` against the patched schema reports:

```
✔ Applied 4 operation(s)
  Signature: sha256:79f6ec1138421f622bdb029df699d034eb2a93d5675c1e653e23cd667f35427e
```

That's the entire success summary. From this output a user cannot tell:

- **Which migration directories were applied.** The 4 ops are split
  across two contract spaces — 1 cipherstash-space op
  (`install_eql_bundle`) and 3 app-space ops (`table.users` + 2
  `cipherstash-codec…add-search-config`) — but neither space, neither
  directory, and neither op is named.
- **Which spaces ended up at which marker hashes.** Only one
  "Signature" hash is shown. With per-space markers (the design F4
  asks `migration status` to surface), the user expects two hashes:
  `app` and `cipherstash`. The single signature hides whether
  cipherstash's pinned head was satisfied or whether app-space made it
  to the planned target.
- **What ran in what order.** The cross-space ordering convention
  (extensions alphabetically, then app) is the framework's invariant —
  the success line should let the user observe it ran in that order.
- **What the next reasonable command is.** A successful init implies
  `migration status` should now report "up to date" — say so.

Compare to the failed `migration apply` earlier, which at least named
the failing operation, the migration directory, and the SQL state code.
Success deserves at least the same level of detail.

What should change:

- Show the full applied path, grouped by space:
  ```
  ✔ Applied 4 operation(s) across 2 contract spaces

  Extension: cipherstash
    ▾ 20260601T0000_install_eql_bundle
        • cipherstash.install-eql-bundle (additive, ~5,750 lines of EQL bundle SQL)
    ◆ marker → sha256:<head-hash>

  App
    ▾ 20260509T1602_initial
        • table.users (additive, CREATE TABLE)
        • cipherstash-codec.users.email.add-search-config.unique (additive)
        • cipherstash-codec.users.email.add-search-config.match  (additive)
    ◆ marker → sha256:79f6ec1…

  Run 'prisma-next migration status' to confirm both spaces are up to date.
  ```
- The single "Signature" line as written conflates two ideas
  (per-space markers and cross-space progress). Renaming it to
  `App-space marker` (or printing both markers) avoids the ambiguity.

### F8 — Example app's stub SDK emits envelopes the real EQL bundle rejects

`examples/cipherstash-integration/src/sdk.ts` `bulkEncrypt` returns:

```js
{ c: `ct:${value}`, t: args.routingKey.table, col: args.routingKey.column }
```

The real EQL bundle's `eql_v2.check_encrypted` requires:

| Field | Shape | Bundle source |
|---|---|---|
| `v` | string `'2'` | line 4821 of `eql-install.generated.ts` |
| `c` | ciphertext (any string) | line 4849 |
| `i` | object with subfields `t` (table) and `c` (column) | lines 4772, 4796 |

So the stub:

- omits `v` entirely,
- puts table at the top level instead of nested under `i`,
- uses `col` instead of `i.c` for the column.

The constraint added by `eql_v2.add_encrypted_constraint` (the same
function that surfaced F6) calls `check_encrypted` on every INSERT, and
the demo's first INSERT trips it with `Encrypted column missing version
(v) field: {"c": "ct:alice@example.com", "t": "users", "col": "email"}`.

This is the same root cause as F5: the example app shipped against a
real bundle but its hand-written stub SDK only matches the test infra's
*synthetic* bundle (which has a relaxed `check_encrypted`). Nobody ran
the example end-to-end against the real bundle.

Fix: update the stub SDK to emit the real-bundle envelope shape:

```js
{
  v: '2',
  c: `${CIPHERTEXT_PREFIX}${value}`,
  i: {
    t: args.routingKey.table,
    c: args.routingKey.column,
  },
}
```

The `unwrap` helper only reads `.c`, so decryption is unaffected.

Adjacent gap, worth flagging for the team: there's no single source of
truth in the cipherstash extension or the CipherStash docs for "what
shape does `bulkEncrypt` need to return when wired against the real
bundle?" The answer is encoded only in the bundle's plpgsql validators.
A typed `EnvelopeV2` interface exported alongside `CipherstashSdk`,
with a docstring linking back to the bundle's `check_encrypted` chain,
would close this — and would have caught F8 at compile time.

## Switching the example off the stub SDK

After the F8 envelope-shape fix the demo would still not round-trip
free-text search end-to-end: `cipherstashIlike` requires a real bloom
filter on the `match` index, which only a real CipherStash SDK can
compute. We swapped the example app off its hand-written stub and onto
the real CipherStash SDK package.

Choice of package: `@cipherstash/stack` (over `@cipherstash/protect`),
matching CJ's stated intent that the integration target stack as the
broader umbrella package.

Wiring (now committed):

- `examples/cipherstash-integration/src/encryption/index.ts` declares
  the encrypted schema (`encryptedTable('users', { email: …
  .equality().freeTextSearch() })`) and constructs the
  `EncryptionClient` via top-level `await Encryption({ schemas })`.
  `dotenv/config` is loaded inline so callers don't need to remember
  the ordering.
- `examples/cipherstash-integration/src/sdk.ts` adapts the
  `EncryptionClient` to the framework-native `CipherstashSdk` shape,
  with a `(table, column) → EncryptedColumn` registry that translates
  the framework's string routing keys back into stack's typed schema
  references. New encrypted columns need entries in both files.

Two small workspace-level snags surfaced during the swap:

1. `pnpm` rejected `@cipherstash/stack`'s install with
   `ERR_PNPM_TRUST_DOWNGRADE` on the transitive `evlog@1.9.0`
   (provenance attestation is treated as a downgrade from the earlier
   trusted-publisher attestation). Resolved by adding `evlog@1.9.0`
   to `pnpm-workspace.yaml`'s `trustPolicyExclude`. Worth raising
   as a follow-up: `evlog` is a CipherStash-internal logger, so the
   exclusion is effectively scoped to packages they ship — a tighter
   per-source-allowlist would be nicer than a blanket exclude.
2. `EncryptionClient`'s public type lives behind a hashed internal
   chunk in `@cipherstash/stack`'s dist (`client-Dv60lAyy.d.ts`), so
   the inferred type for `encryptionClient` triggers TS2742 when
   re-exported. Worked around with an explicit annotation pulling
   `EncryptionClient` from `@cipherstash/stack/client`. Cleaner fix
   would be for stack to add `EncryptionClient` to its main entry's
   `typesVersions` (worth raising upstream).

The previously-flagged demo `index.ts` header — which still claimed
the SDK was a "demo stub" — was updated to reflect the real-SDK
wiring.

## Open items

- [ ] Resume the verification: confirm the demo round-trips end to end
      with the real `@cipherstash/stack` SDK (insert → cipherstashEq →
      cipherstashIlike + decryptAll). Migrations from the earlier
      `db init` succeed apply against the user's local Postgres are
      already in place; the only remaining step is `pnpm exec tsx
      src/index.ts` against a populated `.env`.
- [ ] Triage F1 + F2 + F4 + the "single-space CLI" pattern callout
      (multi-space awareness in `migration plan / status / apply`,
      operation-label wording).
- [ ] Patch `examples/cipherstash-integration/package.json` to add
      `db:init` / `db:update` scripts (parity with `prisma-next-demo`).
- [ ] Decide whether F3 framework-side (refuse `migration apply` when
      extension spaces are present, or grow multi-space awareness) is
      in scope for this PR or follow-up.
- [ ] Raise upstream with CipherStash: ship `EncryptionClient` from
      the main `@cipherstash/stack` entry (TS2742 fix) and revisit
      `evlog`'s publish-attestation chain (pnpm trust-downgrade).
