# ADR — The schema differ walks two derived schema IRs

Status: **Accepted**.

Related: [design — generic schema differ](design-generic-schema-differ.md), [ADR 195 — Planner IR with two renderers](../../../docs/architecture%20docs/adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md).

## Decision

A schema diff is computed between two schema IRs of the same shape — an *expected* IR and an *actual* IR. Both are produced by **derivation**: the expected IR from a contract, the actual IR by introspecting a live database. The differ compares the two IRs and reads nothing else — no contract, no database catalog — so it does not depend on which source produced either side.

The differ **walks the two IRs as a tree.** From the roots down, it pairs up children, descends into each matched pair, and records a difference wherever the two sides disagree. Every node it visits answers three methods:

```ts
interface DiffableNode {
  coord(): EntityCoordinate;                 // the node's coordinate; the differ pairs peers by it
  isEqualTo(other: DiffableNode): boolean; // compares a matched pair
  children(): readonly DiffableNode[];     // the node's children; empty for a leaf
}
```

It pairs the children of a matched node by `coord()`, recurses, and emits one issue per disagreement:

```ts
const issues: readonly SchemaDiffIssue[] = diffSchemas(expected, actual);
// SchemaDiffIssue = { coordinate, outcome }   outcome: 'missing' | 'extra' | 'mismatch'
```

`coord()` must be unique among the sibling nodes aligned at a level: the differ keys on it and treats a collision as the same entity (now enforced by a duplicate-key throw). A node kind whose natural key is unique only within its parent — a column, unique only within its table — must fold its parent into the coordinate.

- **missing** — in expected, not in actual.
- **extra** — in actual, not in expected.
- **mismatch** — the two pair by coordinate, but `isEqualTo` is false.

For instance, an RLS policy present in the expected IR but absent from the database produces one `missing` issue at that policy's coordinate, which the planner turns into a `CREATE POLICY`. The coordinate is the node's path from the root, so every issue says where in the schema it sits.

The differ is generic: it calls only those three methods, so its code never names a policy, a role, or a table. Each node supplies its own `coord` / `isEqualTo` / `children` from the package that defines it.

## The two sides are derived IRs of one shape

A *derivation* turns a source into a schema IR. There are two of them:

- **project-from-contract** reads a contract into a schema IR.
- **project-from-database** introspects a live database into a schema IR.

They are peers and emit the same IR shape. A command wires one derivation to each side of the diff:

| Command | expected | actual |
| --- | --- | --- |
| apply a contract to a database | contract | database |
| verify a database against a contract | contract | database |
| generate a migration with no database in reach | contract | contract |

Because both sides are one shape no matter which derivation built them, a single comparison serves every command, and the planner that consumes the diff reads outcomes without asking where either side came from. A side's provenance lives in the command's choice of derivation — not in the differ, and not in the planner.

One guarantee falls out of this and the differ relies on it: a node is only ever paired against a node of its own type. Both derivations build the IR in the same shape, so two nodes that share a coordinate are the same type, and `isEqualTo` can compare them as such.

## The schema IR's tree structure determines the order of migration operations

The diff feeds the **planner** — the stage that turns a set of differences into the ordered list of operations a migration runs: the `CREATE POLICY` / `DROP` / `ALTER` statements and their kin. The planner's ordering is the reason the diff keeps its structure.

The planner sequences operations by how nodes depend on one another: a role exists before the policy that names it, a table before the policies attached to it. It folds a paired drop-and-create of one logical object into a single rename. It lets a change to a parent stand in for changes to its children.

Each of those is a relationship between nodes. The walk keeps those relationships in its output — every issue carries its coordinate path, and the nodes it hands back are the IR nodes with their references intact — so the planner reads each one straight from the diff.

## Responsibilities

- **The framework** owns the walk, the pairing, the `missing | extra | mismatch` vocabulary, and the coordinate paths. It names no node type.
- **A node** implements `coord()`, `isEqualTo()`, and `children()` in the package that defines it. A target-only node — an RLS policy, a role — implements them in the target package, the one place its type is named.
- **A derivation** builds one side's IR, populating every node that side carries in canonical form, so `isEqualTo` is a plain structural comparison rather than a normalizing one. A target's two derivations live with the target, written directly — not registered through a shared surface.

For a **content-addressed** node — an RLS policy — `coord()` settles equality on its own: the wire name encodes the body, so two policies that pair by coordinate are equal by construction. `isEqualTo` carries the nodes whose coordinate does not capture their whole content.

## Consequences

### Positive

- Adding a node type to the differ is local: implement the three methods on the node and have the derivations populate it. The framework does not change.
- The walk handles a tree of any depth, so a nested node — a column within a table — needs no change to the differ.

### Negative

- A comparison of flat, independent entities would need neither a recursive walk nor a child interface; the differ carries both so that nested and dependent nodes cost nothing at its core.

## Alternatives considered

**Flatten both IRs to a node list, then diff the lists.** Collect every node from each IR into one flat list per side and pair the lists. Simple to write, and enough when the entities compared are flat and independent. Rejected because the input then has no structure at all: the planner's ordering, rename-coalescing, and parent-stands-for-child reasoning each need a relationship between nodes, and a flat diff would force every one of them to rebuild relationships the diff had thrown away.

**Diff a derived IR against a raw contract.** Build only the introspected side into a schema IR and compare it against the contract object directly. Rejected because the two are different shapes, so the comparison must special-case which side is which — and a command that has no live database to introspect, such as generating a migration offline, then has no IR on that side at all, and that node type is absent from that command entirely. Deriving both sides to one shape makes every command uniform.

**Register the derivations through a generic contribution surface.** Add a registry where a target contributes a node type's project-from-contract and project-from-database pair, dispatched generically. Rejected as scope: a registration surface designed around a single node type on a single target is designed against one example, which is guesswork. A target writes its derivations directly until a second consumer makes the shared shape concrete.

**Port every node type onto the differ at once.** Move the relational node types — tables, columns, indexes, constraints — onto the walk in the same step that establishes it. Rejected as scope: each relational node type carries non-structural equality (type aliases, default normalization) and cross-sibling synthesis that are work in their own right. The walk handles a tree of any depth already, so which node types populate the tree can grow on its own schedule.
