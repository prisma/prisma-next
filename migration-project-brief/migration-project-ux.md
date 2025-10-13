# Prisma Next Migrations — Final UX Spec

This describes the end-to-end user experience for Prisma Next's deterministic, replayable migration system. It's file-first, contract-driven, and portable across environments (dev/staging/prod/colleagues).

---

## Core Concepts (mental model)
- **schema.prisma**: the desired state of your data model (source of truth).
- **contract.json**: generated IR of the schema with a contractHash.
- **Migration program**: a folder with:
  - meta.json — when this migration applies and where it lands.
  - opset.json — how to get there (deterministic, idempotent ops).
  - notes.md — optional human context.
- **Database contract**: a row in prisma_contract table storing the DB's current contract_hash.

A migration "applies" if the DB's current contract matches the migration's from predicate. A baseline is just a migration whose from is "empty" or "unknown"—no separate concept.

---

## On-disk Layout

```
prisma/
  schema.prisma         # desired model
  contract.json         # generated IR with contractHash
  migrate.config.json   # optional: environment URLs & defaults

migrations/
  2025-10-13T0912_add-user-active/
    meta.json
    opset.json
    notes.md            # optional

.env                    # DATABASE_URL
.env.staging
.env.production
```

### meta.json (uniform for all migrations)

```json
{
  "id": "2025-10-13T0912_add-user-active",
  "target": "postgres",
  "from": { "kind": "contract", "hash": "sha256:<A>" },  // or { "kind": "empty" } | { "kind": "unknown" }
  "to":   { "kind": "contract", "hash": "sha256:<B>" },
  "opSetHash": "sha256:<ops>",
  "mode": "strict",              // "strict" | "tolerant"
  "supersedes": [],              // optional; populated by squash
  "notes": "Add user.active and unique email"
}
```

### opset.json (canonical)
- Deterministic operations (addTable, addColumn, alterColumn, unique, fk, index, …).
- No strings of SQL; the apply tool lowers to SQL for the target dialect.

---

## Day-to-day Workflow

### 0) Initialize a project

```bash
$ pn prisma-next init
> prisma/schema.prisma created
> prisma/migrate.config.json created
```

### 1) Edit your model

```prisma
model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  active    Boolean  @default(false)
  createdAt DateTime @default(now())
}
```

### 2) Emit the contract

```bash
$ pn prisma-next psl emit
✔ Generated prisma/contract.json (contractHash sha256:abc123)
```

### 3) Plan a migration

```bash
$ pn prisma-next migrate plan
✔ Detected desired → sha256:def456
✔ Latest applied → sha256:abc123
✔ Planned migration: migrations/2025-10-13T0912_add-user-active
  - columns: + user.active (bool, default false)
  - unique:   user.email

Next: review notes.md / plan.sql (optional), then apply.
```

This writes:

```
migrations/2025-10-13T0912_add-user-active/
  meta.json   # from sha256:abc123 → to sha256:def456
  opset.json  # deterministic ops
  notes.md    # human summary (optional)
```

### 4) Apply (dev)

```bash
$ pn prisma-next migrate apply --env development
DB contract: sha256:abc123
Applying: 2025-10-13T0912_add-user-active → sha256:def456
  • add column user.active bool default false
  • add unique user(email)
✔ Applied in 245ms
✔ DB contract updated to sha256:def456
```

### 5) Commit and push
- Commit the migration folder & updated schema.prisma and contract.json.
- CI can run `migrate plan --check` (see CI section) and `migrate apply --env staging`.

---

## Status & Diagnostics

### Status

```bash
$ pn prisma-next migrate status --env production
Desired   : sha256:def456 (from prisma/contract.json)
DB        : sha256:abc123
Pending   : 1
  - 2025-10-13T0912_add-user-active (abc123 → def456)

Actions:
  pn prisma-next migrate plan
  pn prisma-next migrate apply --env production
```

### Preview SQL

```bash
$ pn prisma-next migrate preview
-- BEGIN
ALTER TABLE "user" ADD COLUMN "active" boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "user_email_key" ON "user" ("email");
-- COMMIT
```

---

## Environments

prisma/migrate.config.json (optional convenience):

```json
{
  "defaultEnv": "development",
  "envs": {
    "development": { "urlFrom": ".env", "urlKey": "DATABASE_URL" },
    "staging":     { "urlFrom": ".env.staging", "urlKey": "DATABASE_URL" },
    "production":  { "urlFrom": ".env.production", "urlKey": "DATABASE_URL" }
  },
  "applyDefaultPolicy": "strict"
}
```

If omitted, --url can be passed explicitly:

```bash
$ pn prisma-next migrate apply --url postgres://...
```

---

## Applicability & Modes
- **Applicability**: A migration is applied if DB's current contract matches meta.from:
  - `{ "kind": "contract", "hash": "sha256:<A>" }` → only when DB hash equals <A>.
  - `{ "kind": "empty" }` → applies on a fresh DB (no marker table).
  - `{ "kind": "unknown" }` → applies if marker missing (legacy DB).
  - `{ "kind": "anyOf", "hashes": [...] }` → tolerant baseline(s).
- **Mode**:
  - strict: refuse if DB hash ≠ from.
  - tolerant: allow DB hash that's already ahead; skip no-op ops at runtime (safe for dev/staging).

---

## Squashing (same structure, no "baseline" type)

Squash multiple migrations into one new program:

```bash
$ pn prisma-next migrate squash --range 2025-10-01..2025-10-13
✔ Wrote migrations/2025-11-01T1000_squash-A-to-Z/
  - meta.json (from sha256:<A> to sha256:<Z>, supersedes [...])
  - opset.json (composed)
```

- The new program has the same { meta.json, opset.json } shape.
- Old folders listed in supersedes can be archived.
- For brand-new dev DBs, you may also generate a "from empty" installer:

```json
"from": { "kind": "empty" }, "to": { "hash": "sha256:<Z>" }
```

(still the same migration shape).

---

## Errors & Guidance (UX)

### DB hash mismatch (strict)

```
✖ Cannot apply 2025-10-13T0912_add-user-active
  Expected DB contract sha256:abc123, found sha256:aa00bb…
  Try:
    - pn prisma-next migrate status
    - use tolerant mode, or re-plan from your current DB state
```

### Nothing to apply

```
✔ Up to date. DB contract sha256:def456 matches desired.
```

### Unknown DB

```
✖ Database has no prisma_contract marker.
  Options:
    - Apply a baseline migration (from.kind === "empty" or "unknown").
    - Or import an existing contract hash: pn prisma-next migrate mark --hash sha256:<H>
```

### Plan conflicts / ambiguous rename
The planner includes a clear TODO in notes.md and refuses to create opset.json until the ambiguity is resolved (or generates a draft with explicit warnings).

---

## CI & Automation
- **Check drift vs code**

```bash
pn prisma-next psl emit
pn prisma-next migrate plan --check
```

Fails if desired contract changed but no migration was planned.

- **Apply in staging**

```bash
pn prisma-next migrate apply --env staging --noninteractive
```

- **Artifacts**
Attach migrations/*/{meta.json,opset.json} and optional plan.sql to build artifacts for easy review.

---

## IDE / Agent Experience
- The whole state is on disk: schema.prisma, contract.json, migration programs.
- Agents can:
  - Read contract.json to understand tables & types.
  - Propose migrate plan, surface notes.md, and open PRs with the new migration folder.
  - Run migrate preview to inline SQL in code review.
  - Apply in dev via migrate apply --env development.

---

## Command Reference (final UX)
- **psl emit**
  Generate prisma/contract.json from schema.prisma.
- **migrate plan [--message "…"] [--from <hash>] [--to <hash>]**
  Diff contracts and write a new migration program; by default from "latest applied" (or previous program to) to contract.json.
- **migrate apply [--env <name> | --url <dsn>] [--noninteractive]**
  Apply the next applicable migration(s) to the target DB, updating prisma_contract.
- **migrate status [--env <name>]**
  Show desired hash, DB hash, and pending migrations.
- **migrate preview**
  Print SQL for pending migration(s) without running.
- **migrate squash --range <idStart>..(idEnd|HEAD)**
  Compose a set into one new program with supersedes.
- **migrate mark --hash <sha256:…>**
  (Advanced) Set the DB's prisma_contract hash manually (e.g., adopting an existing DB).

---

## Design Guarantees (what users can rely on)
- **Deterministic**: same PSL A→B yields byte-identical opset.json.
- **Portable**: programs replay anywhere; no dependence on a specific DB instance.
- **Safe by default**: strict mode protects prod; tolerant mode helps dev/staging.
- **Minimal cognitive load**: one migration shape; baselines are just migrations with from:"empty"/"unknown".
- **Auditable**: every apply updates the DB's contract_hash and can be recorded in a small ledger (optional future).

---

## Example: First-time init on a fresh DB

```bash
$ pn prisma-next psl emit
$ pn prisma-next migrate plan
# creates 2025-10-13T… with from:{kind:"empty"} → to:{hash:"sha256:abc123"}

$ pn prisma-next migrate apply
DB contract: <empty>
Applying: 2025-10-13T… → sha256:abc123
✔ Applied
✔ DB contract updated to sha256:abc123
```

---

This UX keeps migrations predictable, file-based, and easy to automate—while remaining faithful to the contract-first vision and ready to scale into richer features later.
