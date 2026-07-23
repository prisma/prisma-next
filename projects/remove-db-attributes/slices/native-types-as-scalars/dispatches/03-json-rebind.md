# D3 — JSON re-bind: `Json` → pg/json@1, new `Jsonb` → pg/jsonb@1

**Slice plan:** `projects/remove-db-attributes/slices/native-types-as-scalars/plan.md` · **Tier:** mid · **Branch:** `tml-2986-native-types-as-scalars`

## Task

Execute the settled JSON decision on the postgres target: the `Json` scalar contribution changes from `{ pg/jsonb@1, jsonb }` to `{ pg/json@1, json }`; a new `Jsonb` contribution carries `{ pg/jsonb@1, jsonb }`. Then sweep the repo green: every in-repo schema/test/fixture that used `Json` *meaning jsonb* migrates to `Jsonb`; assertions for which the re-bind is the point now expect `json`.

## Outcome (property statement)

On the postgres target `Json` always means native `json` and `Jsonb` always means `jsonb`, **such that** the semantic change is confined to the `Json` name's binding (no other scalar's emission moves), the legacy `@db.Json` path remains byte-stable (`NATIVE_TYPE_SPECS` untouched — it independently produces `pg/json@1`; its `baseType: 'Json'` acceptance must keep working against the re-bound scalar map, test-proven), and TS↔PSL parity holds by pairing `field.json()` (jsonb, unchanged — TS surface is a project non-goal) with PSL `Jsonb`.

## In

- Postgres adapter `postgresScalarAuthoringTypes`: `Json` → `pg/json@1`/`json`; add `Jsonb` → `pg/jsonb@1`/`jsonb`. Sqlite/mongo untouched (their `Json` bindings are their own).
- Binding tests: `Json`/`Jsonb` in both positions; `@db.Json` byte-stability test.
- Repo sweep: `rg -l '\bJson\b'` over packages' postgres-relevant tests/fixtures + `test/integration`; migrate jsonb-intent usages to `Jsonb`; TS↔PSL parity fixtures pair `field.json()` with `Jsonb`. `pnpm fixtures:check` regeneration IS in scope if emitted fixtures carry Json columns — regenerate and commit; **any drift outside JSON-bearing columns = halt**.
- **Upgrade-instructions entry** (per `.agents/skills/record-upgrade-instructions/SKILL.md`): if this dispatch's sweep touches `examples/` or `packages/3-extensions/`, append a `changes[]` entry (id `postgres-json-rebound-to-native-json`) to the matching `upgrades/0.14-to-0.15/instructions.md` file(s): postgres schemas using `Json` for jsonb storage must switch to `Jsonb`; detection glob `**/*.prisma`, contains `Json`. Author it in whichever skill package(s) the substrate diff demands; verify `pnpm check:upgrade-coverage` exits 0.

## Out

- `field.json()` re-binding (forbidden — TS non-goal; if parity cannot be satisfied by pairing with `Jsonb`, HALT and escalate per I12). Example/extension-contract *syntax* migration beyond what the sweep's green requires (slice 3 owns consumer migration; only touch `examples/`/`packages/3-extensions/` where the re-bind forces it). psl-infer printing (slice 3).

## Edge cases

| Case | Disposition |
| --- | --- |
| Mongo/sqlite `Json` | Untouched — assert one test per target still pins their existing binding. |
| `@db.Json` on `Json` base (`Json @db.Json`) | Legacy validation reads the scalar map for base `Json` — now `pg/json@1`. `resolveDbNativeTypeAttribute` only checks the base *name*, but verify with a test that `Json @db.Json` still resolves identically to before. |
| LSP semantic-token test using `metadata Json @db.Json` | Stays green (name-level); adjust only if an assertion pins jsonb. |
| Emitted-fixture regeneration | JSON-bearing columns only; anything else = halt. |
| Destructive git ops / stash | Forbidden; `git commit -s`. |

## Completed when

1. Binding + byte-stability tests green; sweep leaves `pnpm test:packages` green (env skips exempt); TS↔PSL parity green with `Jsonb` pairing.
2. `pnpm fixtures:check` clean post-regeneration; `pnpm lint:deps` clean; `pnpm check:upgrade-coverage` exit 0; `pnpm typecheck` green.

## Report back

Binding diff; sweep inventory (files, jsonb→Jsonb vs expect-json classification); upgrade-entry disposition; gates + results; F1/F3/F12/F13/F14 checked; commit SHA.
