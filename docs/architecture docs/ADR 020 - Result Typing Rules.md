ADR 020 — Result typing and projection inference rules

Status: Accepted
Date: 2025-10-18
Owners: Prisma Next team
Related: ADR 005 thin core fat targets, ADR 007 types-only emission, ADR 011 unified Plan model, ADR 015 ORM optional extension, ADR 016 adapter SPI

Context
	•	Users and agents rely on predictable TypeScript result types from the SQL DSL and the optional ORM layer
	•	Inference must be stable across lanes, dialects, and adapter updates to keep DX, CI snapshots, and agent prompts trustworthy
	•	Ambiguity usually stems from joins, aggregates, and adapter-specific lowerings for nested results

Decision
	•	Standardize how the SQL DSL and ORM compute result types from projections and joins
	•	Define nullability propagation rules for LEFT JOIN, RIGHT JOIN, FULL OUTER JOIN, and common aggregates
	•	Push dialect-specific edge cases behind adapter capabilities so the type rules remain stable while allowing adapters to refine details

Scope

In scope
	•	SELECT results for SQL DSL and ORM-lowered single-statement queries
	•	Projections, joins, simple expressions, and common aggregates
	•	Nested results produced by ORM lowerers using single-statement strategies

Out of scope
	•	Multi-statement orchestration and unit-of-work semantics
	•	Driver-specific runtime result decoding beyond codecs already configured

Sources of type information

Order of precedence
	1.	Projection alias types when explicitly annotated in the builder API or via codecs
	2.	Column types from the data contract for t.table.column references
	3.	Expression typing rules defined below
	4.	Adapter refinements where the adapter declares more precise behaviors via capabilities

If multiple sources disagree, the more specific one wins and the less specific is widened

Projection rules
	•	select({ alias: t.user.id }) yields { alias: number } based on contract column type
	•	select({ alias: sql.fn.countStar() }) yields { alias: number }
	•	select({ alias: exprA.add(exprB) }) yields the arithmetic result type per numeric promotion rules
	•	Duplicate aliases are a compile-time error in strict mode and produce a warning in permissive mode
	•	SELECT * is allowed by the core but strongly discouraged and typically linted as error
when used, the result is the intersection of all visible table fields with join-based nullability applied, breaking ties by last-projected table in deterministic order

Join nullability rules

Given FROM A and a selected field sourced from table T:
	•	INNER JOIN T leaves nullability unchanged
A.col as in contract, T.col as in contract
	•	LEFT JOIN T makes all T.* nullable
T.col becomes Nullable<ColType> regardless of original nullability
A.* unchanged
	•	RIGHT JOIN T makes all A.* nullable and leaves T.* unchanged
not all adapters implement RIGHT JOIN; if adapter lowers to LEFT JOIN by swapping sides, the same rule applies relative to the rewritten sides
	•	FULL OUTER JOIN makes both A.* and T.* nullable
	•	Self-joins follow the same rules per logical side, disambiguated by table alias
	•	CROSS JOIN leaves nullability unchanged for both sides

Notes
	•	Nullability from JOIN combines with column-level nullability via union
a nullable column on the preserved side remains nullable
a non-nullable column on the non-preserved side becomes nullable
	•	Adapter profiles can refine nullability only when they provably enforce filtering that restores inner semantics
such refinements must be covered by golden tests

Expression typing rules
	•	Boolean predicates like eq, gt, lt, in type to boolean for projection purposes
three-valued SQL logic is not encoded in result types; in WHERE, unknown behaves as false
	•	CASE WHEN unions branch types and propagates nullability if any branch can be null
CASE WHEN cond THEN number ELSE NULL END yields number | null
	•	COALESCE(a, b, ...) yields the first non-nullable type in order or the union of all types if none is non-nullable
	•	Arithmetic on numerics promotes to the widest participating numeric type declared by the contract
mixing int4 and float8 yields number
	•	String concatenation yields string
	•	JSON construction functions yield unknown by default and T when paired with an explicit codec or typed builder helper

Aggregate typing rules

Assume no FILTER and no DISTINCT unless specified
	•	COUNT(*) yields number and is non-null
	•	COUNT(expr) yields number and is non-null
	•	SUM(int*) yields number | null
null when the group contains zero rows or all expr are null
	•	SUM(float*) yields number | null with the same semantics
	•	AVG(*) yields number | null
	•	MIN(expr) and MAX(expr) yield T | null where T is the expression type
	•	ARRAY_AGG(T) yields T[] | null by default
adapters may flip to T[] if they guarantee COALESCE(array_agg(...), '{}') and must advertise arrayAggCoalescesEmpty capability
	•	JSON_AGG(T) yields unknown[] | null by default
with a typed child projection and jsonAggTypedChildren capability, adapters may refine to ChildRow[] | null
adapters may coalesce to ChildRow[] if they lower with COALESCE(json_agg(...), '[]'::json) and declare jsonAggCoalescesEmpty

Grouping
	•	With GROUP BY, any projected non-aggregate field must appear in the grouping set or compilation fails
	•	Result nullability from aggregates ignores join preservation because aggregates collapse the group
join-induced nullability only matters for inputs to aggregates, not the aggregate’s own nullability except as defined above

ORM nesting rules

When ORM lowers 1:N includes using single-statement strategies:
	•	Lateral subquery with json_agg
child collection type is ChildRow[] | null by default
if the adapter declares jsonAggCoalescesEmpty, the type is ChildRow[]
	•	Flat LEFT JOIN with prefixed columns
child fields become Nullable<ChildCol> on the projection
ORM may provide a post-projection combiner to produce { parent: ParentRow, child: ChildRow[] } at the typing layer only if the adapter declares the combining strategy and it stays single-statement

For N:1 includes lowered via LEFT JOIN:
	•	Child fields are Nullable<ChildCol>
	•	If the include is marked as required and lowered with an INNER JOIN, child fields retain original nullability

Aliasing and collisions
	•	Projection alias names must be unique within a query
	•	When selecting the same column under multiple aliases, each alias gets its own type copy
	•	Table aliasing does not affect the result field name unless explicitly used as the projection alias

Adapter refinements

Adapters can narrow types only when they guarantee a specific lowering behavior
	•	Coalesced aggregates may drop | null
	•	Known scalar function result widths may be refined to narrower branded types via codecs
	•	Explicit capabilities must be documented and covered by golden tests

Examples

Left join nullability

// FROM user INNER JOIN post
select({ uid: t.user.id, pid: t.post.id })
// { uid: number, pid: number }

// FROM user LEFT JOIN post
select({ uid: t.user.id, pid: t.post.id })
// { uid: number, pid: number | null }

Aggregates

// Count is never null
select({ c: fn.countStar() })
// { c: number }

// Sum may be null when no rows
select({ s: fn.sum(t.order.amount) })
// { s: number | null }

ORM 1:N nested via json_agg

// With adapter not coalescing
// { id: number, posts: Array<{ id: number, title: string }> | null }

// With adapter coalescing
// { id: number, posts: Array<{ id: number, title: string }> }

Testing
	•	Golden typing tests mapping representative projections and joins to expected TS types
	•	Adapter conformance tests asserting capability-driven refinements do not widen types unexpectedly
	•	Cross-lane equivalence tests ensuring ORM-lowered plans produce the same result types as hand-written DSL with equivalent SQL
	•	Regression tests for LEFT/RIGHT/FULL join nullability and aggregate nullability

Backwards compatibility and evolution
	•	These rules define typing v1 for result inference
	•	Adapters may add refinements behind explicit capabilities without breaking v1
	•	Any change that widens a type must be considered breaking at the typing level and coordinated with a major adapter version bump or a new typing profile

Rationale
	•	Users and agents need a small set of stable rules to predict shapes without reading adapter internals
	•	Join and aggregate nullability are the primary sources of confusion; codifying them reduces surprises
	•	Keeping refinements behind capabilities preserves a thin core while allowing high-fidelity adapters to improve precision

Open questions
	•	Whether to surface a user-level option to always coalesce collection aggregates for ergonomics, trading some SQL strictness for simpler types
	•	Strategy for typing window functions beyond row_number() and rank() defaults
	•	Standard branded numeric types for COUNT, SUM, and AVG to help downstream budget rules
