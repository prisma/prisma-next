Great question. My take: don't contort the SQL-first architecture to "also fit Mongo." Instead, treat SQL and Mongo as two separate target families that share a thin set of core conventions (contracts, hashing, program format, runner protocol), but have their own DSLs, planners, lowerers, and admin connections. Apps opt into one family at install-time and never mix.

Here’s a concrete way to do it without over-abstracting.

Guiding principles
	•	Single-target apps: the contract (contract.json) carries target: 'postgres' | 'mysql' | 'mongo' and the runtime enforces one target per app.
	•	Thin core, fat target: centralize only what can be identical across targets (file formats, hashing, CLI routing, plugin API shapes). All domain logic lives in target packages.
	•	No “lowest common denominator”: give Mongo its own query DSL (pipeline-first), IR, planner ops, and guardrails.

Workspace layout (split by target family)

packages/
  core/                      # zero-DB specifics: hashing, canonical JSON, program loader, CLI router
  runtime-core/              # hook/plugin interfaces, Plan shape, reports (no DB code)

  # SQL family
  relational-ir/             # current IR (tables, columns, PK/UK/FK/indexes, contractHash)
  sql/                       # SQL query DSL + AST + compiler (you already have)
  runtime-sql/               # DatabaseConnection, AdminConnection (pg), lint plugins, budgets
  migrate-sql/               # opset types for SQL, lowerer to DDL Script AST, runner adapter
  planner-sql/               # A→B planner for SQL (your MVP)
  ddl-script/                # (shared for SQL targets) Script AST + renderer for Postgres/MySQL dialects
  orm-sql/                   # optional layer for relations, include(), etc.

  # Mongo family
  document-ir/               # Mongo contract IR: collections, validator JSON Schema, indexes, shard keys, caps
  mongo/                     # Mongo query DSL: find(), aggregate() pipeline builder, codecs
  runtime-mongo/             # AdminConnection (Mongo), budgets (scan %, stage caps), guardrails
  migrate-mongo/             # opset types for Mongo (createCollection, collMod, createIndex, reshard, etc.)
  planner-mongo/             # A→B planner for Mongo (validator/index additive MVP)
  orm-mongo/                 # optional doc/relationship conveniences (refs, embeddings)

The CLI package (core) detects contract.target and dispatches to the correct {migrate-*, planner-*, runtime-*} at runtime. Type-level choice happens at import time (@prisma/sql vs @prisma/mongo).

What’s shared vs target-specific

Shared (core)
	•	Contract hash computation (stable canonicalization)
	•	Migration program format (meta.json, opset.json) & hashing
	•	Runner protocol (high-level): "load program → check applicability → lower ops → execute → write new contract hash"
	•	Plugin/hook interfaces (shape only; implementations live per target)
	•	CLI routing (inspects prisma/contract.json.target)

SQL-specific
	•	IR: tables/columns/constraints/indexes
	•	Query DSL: relational DSL, AST → SQL compiler
	•	Migrate + planner ops: addTable, addColumn, addIndex, addFK, …
	•	Lowerer: opset → DDL Script AST → SQL
	•	AdminConnection: pg driver + advisory locks
	•	Guardrails: “no SELECT *”, mutation-without-WHERE, EXPLAIN cost, row limits

Mongo-specific
	•	IR: collections, validator (JSON Schema), indexes, shard keys, capped, timeseries options
	•	Query DSL: find/aggregate pipeline builder with typed codecs ($match/$project/$lookup/$group/...)
	•	Migrate + planner ops (MVP, additive-only):
	•	createCollection, collMod (update validator), createIndex, dropIndex (optional later), shardCollection (later)
	•	Lowerer: opset → discrete admin commands (db.createCollection, db.runCommand({ collMod: … }), db.collection.createIndexes)
	•	AdminConnection: Node Mongo driver (MongoClient), session/txn handling (single-/multi-doc), feature probes
	•	Guardrails: full collection scan %, $lookup size, pipeline stage caps, no unbounded $group without $limit, index coverage checks

Developer experience (unchanged ergonomically)

SQL app

import { t, sql } from '@prisma/sql';
import { connect } from '@prisma/runtime-sql';
const db = connect({ ir: contract, driver: pgClient });

const q = sql.from(t.user).where(t.user.active.eq(true)).select({ id: t.user.id });
await db.execute(q);

Mongo app

import { coll, agg } from '@prisma/mongo';
import { connect } from '@prisma/runtime-mongo';
const db = connect({ ir: contract, client: mongoClient });

const pipeline = agg(coll.users)
  .match({ active: true })
  .project({ _id: 0, id: '$id', email: 1 })
  .limit(100);

await db.aggregate(pipeline);

Both use the same runner protocol (Plan, hooks) but different builders and executors.

Migration programs (same UX, different opset)

Shared program shape:

migrations/<id>/
  meta.json   # from → to with hashes; target: "postgres" | "mongo"
  opset.json  # target-specific ops

SQL opset.json (familiar):

{ "version":1, "operations":[
  { "kind":"addTable", "table":"user", "columns":{...}, "primaryKey":["id"] },
  { "kind":"addIndex", "table":"user", "columns":["email"] }
]}

Mongo opset.json (MVP):

{ "version":1, "operations":[
  { "kind":"createCollection", "name":"users", "options":{ "validator": { "$jsonSchema": {...} } } },
  { "kind":"collMod", "name":"users", "validator": { "$jsonSchema": {...} } },
  { "kind":"createIndex", "name":"users", "keys":{ "email": 1 }, "options":{ "unique": true } }
]}

Runner behavior is identical: resolve next applicable program → inject target lowerer → execute → write prisma_contract with the same to.hash scheme.

Type system & imports (make mixing impossible)
	•	Apps import either @prisma/sql or @prisma/mongo. No unified super-DSL.
	•	contract.json.target is checked at runtime, and program types enforce it at compile time:
	•	runtime-sql expects relational-ir contract
	•	runtime-mongo expects document-ir contract
	•	The CLI prevents cross-target operations (e.g., won’t try to apply SQL migrations against a Mongo DB).

How to add Mongo incrementally (low risk)
	1.	document-ir (MVP)
	•	Collections (name)
	•	Validator (JSON Schema; store canonicalized)
	•	Indexes (keys + options)
	•	(Optional later: timeseries/capped/sharding)
	2.	migrate-mongo (MVP)
	•	Ops: createCollection, collMod(validator only), createIndex
	•	Lowerer: produce admin commands
	•	Runner adapter: AdminConnection for Mongo
	3.	planner-mongo (MVP, additive-only)
	•	A={}, B with collections → createCollection
	•	Existing A + new fields in validator (non-required) → collMod
	•	New indexes → createIndex
	•	Out-of-scope: drops, renames, making fields required (needs data backfill)
	4.	mongo (query DSL) (MVP)
	•	Builder for aggregate() with typed $match/$project/$limit
	•	Codecs for _id, dates, decimals; result typing based on projection
	•	Guardrails plugin: block unbounded pipelines in dev by default
	5.	runtime-mongo
	•	Execute pipelines and commands
	•	Hook plugins compatible with the core: lint, budgets (different rules)

Drift & policies for Mongo (mirrors SQL, different checks)
	•	Contract hash table/collection (e.g., prisma_contract in a special DB like admin or app DB).
	•	Catalog fingerprint: listCollections, listIndexes, validator JSON → canonical hash.
	•	Policies: disallow $where, warn on full scans, cap $lookup fanout, require index for certain $match patterns.

Why not a grand unified IR?
	•	The moment you try to unify schema/ops across SQL/Mongo, you either lose expressiveness or explode complexity. Keeping relational-ir and document-ir separate avoids both while still sharing the productive parts (packages, hashing, runner protocol, CLI).

Summary decision
	•	Keep the core skeleton shared (hashing, packages, runner protocol, CLI router, plugin interfaces).
	•	Create parallel target stacks for SQL and Mongo with their own IRs, DSLs, planners, and runners.
	•	Let the contract’s target choose which stack is active—no runtime guessing, no cross-target abstraction penalty.

If you want, I can sketch document-ir types and a minimal Mongo opset + lowerer so you can land the first migration end-to-end quickly.
