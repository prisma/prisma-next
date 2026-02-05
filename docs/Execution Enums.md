## Execution enums (design note)

### Context
We recently added support for **native database enums** (starting with Postgres). In Postgres, “enum” is a real database type, so it’s straightforward to describe in the contract: the contract can literally say “this type exists” and schema verification can check for it.

The harder part is supporting “enum-equivalent” behavior on:

- SQL databases that **do not** have native enums, and
- Postgres projects that **choose not to** use native enums (because of Postgres enum caveats).

In other words: we want developers to say “this column is an enum with these values”, while still keeping the contract **explicit** about what the database schema is (and not letting Prisma Next reinterpret the same enum definition differently depending on target support).

### The critical distinction
In Prisma ORM and competitors, enum-like features are often *authored* as “a property of a column”, because that’s ergonomic.

But under the hood, we’re really dealing with two different things:

- **A set of allowed values** (domain meaning): a fixed set of values (strings, numbers, …) that are valid.
- **A storage enforcement mechanism** (database meaning): how the database schema enforces that only those values can be stored.

The reason this matters is that “enum” is not a single portable storage primitive across SQL targets. If the contract stores one ambiguous “enum” object that Prisma Next interprets as native-or-emulated depending on the target, the contract stops being explicit and predictable.

So the guiding rule is:

- The contract must explicitly encode the **storage enforcement mechanism**. Capabilities can gate validity (“is this mechanism supported?”), but they must not change the meaning of the contract.

### Desired behavior
We want three layers to line up:

- **Storage (database schema)**:
  - The contract describes exactly what objects/constraints exist in the database.
  - Schema verification can check them directly.

- **Execution plane (query lanes + execution context)**:
  - The execution plane can treat an enum as “here is the finite set of allowed values for this column”.
  - Multiple query DSLs can reuse the same logic, derived from the contract, instead of each implementing enum validation differently.

- **Authoring (DX)**:
  - Users can write “enum with these values” ergonomically.
  - The authoring/emission step chooses an explicit storage strategy and emits it into the contract (no target-dependent interpretation later).

### Storage: make enforcement explicit
For Postgres native enums, we already have an explicit representation (a storage type instance using the Postgres enum codec and a native enum type name).

To support other databases, we need additional explicit storage mechanisms. The most important one to call out is:

- **CHECK constraints** that restrict a column to a fixed set of values.

That implies a missing piece in the current core storage shape: we need a contract representation for **sets** (the allowed values) and **check constraints** (the enforcement).

Those storage primitives are defined in ADR 156:

- `storage.sets`: named sets of allowed values
- `tables.*.checks[]`: explicit check constraints that can reference a set

See: `docs/architecture docs/adrs/ADR 156 - Storage sets and check constraints.md`.

### Execution plane: derive a set from the contract
Just like mutation defaults, we want the execution plane to provide a reusable concept derived from the contract:

- “for `(table, column)`, what are the allowed values?”
- “is this value a member of that set?”

This should be exposed via the execution context so that multiple query lanes can share the same behavior:

- model-centric lanes can validate inputs
- SQL lanes can validate values being bound to columns
- (optionally) runtime plugins can provide consistent enforcement for raw SQL paths too

The key point is that we do **not** want each lane to independently implement enum validation and drift over time.

### Contract shape (proposed)
We want one source of truth for the set, and we want storage enforcement to be explicit.

The big design constraint here is that an “allowed-values set” is *not* a database type. It is a simple, universal piece of data that multiple storage strategies can reference (native enum types, check constraints, lookup tables, etc.).

So instead of encoding the set as a `storage.types` instance with codec-owned meaning, we should model it explicitly as a core storage concept, for example:

- `storage.sets`: a registry of named sets of allowed values.

Then we make enforcement explicit by referencing that set:

- **Native strategy**: the column’s type is the native enum type (DB enforces via the type), and the enum type definition references the set.
- **Check strategy**: the column is a normal scalar type (text/int), and the table contains an explicit check constraint that references the set.

The execution plane derives sets for columns by following stable references from storage enforcement (for example, via `checks[].setRef`).

This keeps the contract explicit and avoids target-dependent reinterpretation.

### Concrete examples (simplified)
The concrete storage shapes for sets and check constraints (including how set members are encoded) are defined in ADR 156.

### Where logic lives
- **Authoring/emission**:
  - Users author “enum with values” ergonomically.
  - The emitter chooses a storage strategy (native vs check) based on the selected target and user preferences and emits the explicit schema representation into the contract.
  - After emission, the contract does not require interpretation to know what schema is expected.

- **Control plane**:
  - Plans and verifies the explicit storage schema:
    - creates native enum types when the contract calls for them
    - creates check constraints when the contract calls for them

- **Execution plane**:
  - Derives a set for enum-tagged columns (by following references to `storage.sets`).
  - Exposes helpers on the execution context so multiple query lanes can validate and/or surface allowed values consistently.

### Hashing and verification implications
Enum definitions affect what the database must satisfy (either the native enum values, or the check constraint’s allowed set).

Under the `storageHash` / `executionHash` model:

- Changing set members is a **storage change** and must change `storageHash` (and therefore DB marker verification expectations).
- Execution-plane helpers are derived from `storage`, so we do not need to duplicate sets under `execution` just to make them available to query lanes.

### Summary
- “Enum” is not one portable storage primitive; it is **a set** plus an explicit **storage enforcement mechanism**.
- The contract must encode enforcement explicitly (native enum type vs check constraint), not reinterpret a single enum blob based on target support.
- Sets store members as canonical strings plus a `codecId` (see ADR 156).
- The execution plane should derive reusable “allowed values” behavior from the contract via the execution context, so multiple query lanes share one implementation.
- To support emulated enums broadly, we need a minimal, structured representation of check constraints in `storage` (starting with “column IN set”).

