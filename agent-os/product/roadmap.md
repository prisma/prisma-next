# Product Roadmap

This roadmap is informational for contributors and agents working in the repo. It captures the **themes and slices** we care about for the first public release and near‑term follow‑ups, not a locked‑in project plan.

---

## Phase 1 — Dec–Jan: Initial Public Release

### 1. Query API and Extensions

- **Relational query API**
  - Flesh out the SQL query lane and ORM APIs so they are pleasant to use and easy to extend.
  - Close remaining gaps and stubs in the query planner and AST builders.
  - Ensure **relationship traversal is rock solid** (joins, includes, relation filters).
  - Evaluate a higher‑level DSL that keeps Prisma’s “GraphQL‑ish” feel while still mapping transparently to plans.
- **Transactions**
  - Provide a clear story for wrapping multiple plans in a transaction using the runtime.
- **pgvector extension**
  - Complete the pgvector extension pack:
    - Parameterized vector types wired through contract and type system.
    - Proper index support and lowering.
    - Example queries (similarity search) that showcase the full workflow.

### 2. Migrations v1 — `db init` and Contract‑Driven Update

- **Migration IR and planner**
  - Implement family‑owned migration IR (operations + edges) for the SQL family.
  - Build the **additive‑only planner** and runner for `prisma-next db init` (see `packages/1-framework/3-tooling/cli/README.md`).
  - Use `db init` to bootstrap databases from contracts and to support the testing story (spin up fresh DBs from contract).
- **Zero‑migrations workflow**
  - Prototype `prisma-next db update` and CI/CD flows that treat migrations as **contract graph edges**, not hand‑written scripts (per Contract‑Driven DB Update).
  - Validate whether the graph model is understandable and helpful for users in practice.

### 3. Developer Experience and Tooling

- **Project bootstrap**
  - Ship a simple `prisma-next init` (or equivalent) that:
    - Sets up a new or existing project end‑to‑end.
    - Leaves users with a working contract, runtime, and example queries without extra manual steps.
    - Hides most of the composable internals behind a friendly getting‑started experience.
- **Build and CI**
  - Vite (or bundler) plugin to **auto‑emit `contract.json` / `contract.d.ts`** in dev and CI.
  - TypeScript API for CLI commands so example apps and tools can call them programmatically.
- **Testing story**
  - Helpers to create **test databases from contracts** (leveraging `db init`) and execute plans in tests.
- **PSL support**
  - Implement a proper PSL parser and refactor the language server to use it so PSL and TS contract authoring stay in sync.

### 4. Agentic Workflows and Linting

- **Query linting**
  - Define a first set of **base query lint rules** (like an eslint “recommended” preset) that operate over plans and contracts.
  - Wire lint results into the CLI and runtime so they are consumable by agents (structured output, clear locations).
- **Static analysis PoC**
  - Explore whether we can drive some linting and guidance via **static analysis of TS/PSL**, not just runtime plans.
  - Prototype workflows where agents can round‑trip between lint output, tests, and suggested fixes.

### 5. Ecosystem and Adapters

- **Extension ecosystem**
  - Start working with community authors of existing Prisma 6/7 generators and extensions:
    - Identify candidates that can be ported or reimagined on top of Prisma Next’s contract‑driven model.
    - Capture patterns and pain points that should influence our extension APIs.
- **MongoDB PoC**
  - Build a **minimal Mongo target/query builder** to validate that the contract + lane architecture generalizes beyond SQL.

---

## Phase 2 — Prisma ORM v7 Compatibility & Prisma 8

The major theme for Phase 2 is **compatibility with Prisma ORM v7** and delivering a sane upgrade path so teams do not have to rewrite their applications to adopt Prisma Next.

- **Compatibility layer and upgrade path**
  - Design and implement a compatibility layer (or set of shims) that lets existing Prisma 7 applications migrate incrementally:
    - Support a familiar client surface where it makes sense, backed by Prisma Next contracts and plans.
    - Provide codemods and guides to map common Prisma 7 patterns to Prisma Next equivalents.
    - Ensure key features (relations, includes, transactions, basic middlewares) have clear, well‑documented counterparts.
  - Offer migration tooling and documentation that walks teams from:
    - “Pure Prisma 7” → “Prisma 7 + Prisma Next side‑by‑side” → “Prisma Next‑only”.
- **Experience and behavior parity**
  - Identify the subset of Prisma 7 behavior we commit to preserving (query semantics, error shapes where feasible, config patterns).
  - Tighten the higher‑level DSL and ORM APIs to make the transition feel natural for Prisma 7 users while keeping contracts/plans explicit.
- **Ecosystem alignment**
  - Work with extension and generator authors to validate that their Prisma 7 ecosystem stories have a path into Prisma Next.
  - Where full parity isn’t possible, document trade‑offs and recommended alternatives.
- **Rebranding to Prisma 8**
  - Once the compatibility story is solid, **rebrand Prisma Next as Prisma 8**:
    - Communicate that Prisma 8 is the continuation of the Prisma line, not a separate product.
    - Clearly document supported upgrade paths from Prisma 7 → Prisma 8, including example repos and CI templates.

This roadmap should evolve as we validate DX, migrations, agent workflows, and Prisma 7 compatibility. The key near‑term goal remains a **confident first public release**, followed by a clear, low‑friction path for existing Prisma users to adopt Prisma 8.
