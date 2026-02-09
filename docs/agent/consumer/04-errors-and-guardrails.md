## Skill: handle Prisma Next errors and guardrails (lints, budgets, drift, packs)

### When to use

Use this when you need to:

- debug runtime failures in an app (or while an agent is generating code)
- respond to guardrail blocks (lints/budgets) with an actionable fix
- fix contract/runtime wiring problems (missing packs, target mismatch, codec gaps)

### Prime directive for agents

**Do not “work around” failures by disabling verification or guardrails.**

Prisma Next is contract-first; the correct fix is almost always to change one of:

- the query plan (add `limit`, add `where`, change lane)
- the contract (capabilities / codecs / types)
- the composed stack (target/adapter/driver/extension packs)
- the database state (marker drift, migrations not applied)

### Common failure classes and typical fixes

#### 1) Missing extension packs

Symptoms:

- error like `RUNTIME.MISSING_EXTENSION_PACK` when creating the execution context

Fix:

- include the required runtime descriptor(s) in `createSqlExecutionStack({ extensionPacks: [...] })`
- ensure the contract was emitted with the same pack set

#### 2) Target/family mismatch

Symptoms:

- `RUNTIME.CONTRACT_FAMILY_MISMATCH` or `RUNTIME.CONTRACT_TARGET_MISMATCH`

Fix:

- verify you’re using the correct target + adapter for the contract (`contract.targetFamily`, `contract.target`)
- do not branch on target strings inside business logic; fix wiring at the boundary

#### 3) Codec registry completeness (decode/encode failures)

What Prisma Next enforces:

- if the contract declares codec IDs for columns/types, the runtime’s composed registry must cover them
- runtime validates completeness at startup (if `verify.mode === 'startup'`) or on first execute

Symptoms:

- startup/first-query failure pointing at a missing codec ID

Fix:

- add the extension pack / adapter that contributes that codec
- or stop declaring that codec/typeId in the contract if you don’t want to rely on it

#### 4) Guardrails: lints and budgets

Typical lint/budget codes (stable, policy-controlled):

- **`LINT.NO_LIMIT`**: add `limit()` (or justify streaming with an explicit policy)
- **`LINT.NO_WHERE_MUTATION`**: add a `.where(...)` for updates/deletes
- **`LINT.SELECT_STAR`**: project explicit columns
- **`BUDGET.ROWS_EXCEEDED`**: add limit, tighten predicate, or change workflow to streaming/batching
- **`BUDGET.TIME_EXCEEDED`**: tighten query, add indexes, reduce payload, or adjust policy if appropriate

Agent workflow for guardrails:

- treat lint/budget violations as **design feedback**
- apply the smallest code change that makes the plan bounded and explicit
- keep the plan single-statement (one call → one statement) unless you are intentionally composing multiple Plans

#### 5) Contract marker drift

Symptoms (stable codes from the error envelope taxonomy):

- **`CONTRACT.MARKER_MISSING`**: DB was never stamped/verified
- **`CONTRACT.MARKER_MISMATCH`**: runtime contract hashes don’t match DB marker

Fix:

- apply the migration / verification workflow that stamps marker hashes for the contract you’re running
- avoid shipping a runtime that points at a DB with an old marker

### Agent playbook: fastest debugging loop

- **Identify the boundary** where it failed:
  - context creation (static): pack/target mismatch, typeParams invalid
  - runtime creation: driver wiring, startup verification
  - execute: guardrails, codec decode, adapter/driver errors
- **Match on stable code**, not string parsing.
- **Fix the cause** (query/contract/stack/db), then re-run the same scenario.

