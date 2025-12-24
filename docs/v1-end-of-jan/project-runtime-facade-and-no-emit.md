## Project D — Runtime Client Façade & No-Emit / Vite

### Purpose

Provide a **single, ergonomic client surface** for application code and a **no-emit developer workflow** (including a minimal Vite integration) so that:

- Most users never have to think about adapters, runtimes, or registries directly.
- Using Prisma Next with PPg feels straightforward and familiar.
- Type-safe, TS-first contract authoring is practical in day-to-day development.

This project owns the app-facing runtime entrypoints and basic tooling integration; it does **not** own the underlying runtime kernel or DSLs, but it shapes how they are presented and configured.

---

### v1 (end-of-Jan) goals

- **Client façade API defined and implemented**
  - A factory (name TBD, e.g. `createPrismaNextClient`) that:
    - Accepts configuration such as:
      - Connection information (PPg/@prisma/dev),
      - Contract/contract path,
      - Extensions and lint configuration.
    - Constructs and wires:
      - Adapter and driver,
      - Runtime context and executor,
      - Linting hooks (from the linting project).
    - Exposes lanes in a simple, discoverable way, e.g.:
      - `client.sql` (SQL lane),
      - `client.orm` (ORM/relational lane),
      - `client.raw` or similar for raw lane if needed for v1.

- **No-emit developer workflow**
  - Support a TS-first authoring mode where:
    - Developers can work against the contract builder surface in TypeScript without manually running `emit` on every change in dev.
    - The façade (or related tooling) ensures the contract is validated and in sync where needed (e.g. for runtime).
  - Clearly document:
    - Where `emit` is still required (e.g. CI, type generation),
    - How no-emit mode relates to the canonical contract artifacts.

- **Minimal Vite integration**
  - A simple Vite plugin (or configuration pattern) that:
    - Ensures contract emit/validation is run at appropriate times during `vite dev` and `vite build`.
    - Avoids an explicit “generate” step in the common dev loop for apps using Vite.
  - Documented usage in the example app or a small focused example.

- **Demo integration**
  - `examples/prisma-next-demo`:
    - Uses the client façade instead of wiring adapters/runtimes directly.
    - Demonstrates both:
      - A no-emit dev experience,
      - And the “artifact-driven” path (emit + CLI + runtime) as needed.

---

### Non-goals (post-Jan)

- Full suite of integrations for all bundlers and frameworks (Webpack, Next.js, etc.); v1 can focus on Vite and a clear pattern others can adapt.
- Rich configuration and plugin system for the client itself; v1 can use simple options objects.
- Deep environment-specific configuration orchestration (multiple DBs, multi-tenant routing) beyond what the hero example needs.

---

### Early milestones (Pass 0 / early Pass 1)

- **DX inventory & façade sketch**
  - Walk `examples/prisma-next-demo` and identify:
    - All places where adapter/runtime/context wiring is currently manual or awkward.
    - The minimal set of operations app code actually needs to perform.
  - Draft the façade API:
    - Construction function signature,
    - How lanes and lint configuration are exposed,
    - Example snippets that feel good to write.

- **No-emit + Vite feasibility**
  - Inventory current no-emit support and identify:
    - What is already in place for TS-first contract authoring,
    - What glue is missing to hook it into Vite.
  - Prototype a tiny Vite plugin or config that:
    - Runs emit/validation for a small test app,
    - Demonstrates a working no-emit dev loop.

---

### Dependencies and collaboration

- **Project A — Query DSLs & Relational Lane**
  - Façade must surface DSLs in a way that matches the intended usage patterns and keeps APIs discoverable.

- **Project B — Query Linting & Static Analysis**
  - Façade should provide a straightforward way to:
    - Configure lint rules/severity for an app,
    - Expose lint results (e.g. via hooks or loggers).

- **Project C — Migrations & DB Init**
  - Dev workflows need a clear story for when to run `emit`, `db init`, and `db push`:
    - CLI entrypoints vs. TS APIs,
    - How these integrate into local dev, test, and CI flows.

- **Project E — Example App & Testing Story**
  - Example app is the primary consumer of the façade and no-emit workflows.
  - Testing patterns should exercise the façade in both no-emit and artifact-driven modes where appropriate.

---

### Open questions / to be refined by the project lead

- Exact naming and ergonomics of the client factory and lane accessors (`db`, `client`, `pn`, etc.).
- How much lint configuration to expose in v1 versus hard-coding sensible defaults.
- How strongly to couple the Vite plugin to Prisma Next specifics versus keeping it a thin wrapper around generic emit/validation hooks.



