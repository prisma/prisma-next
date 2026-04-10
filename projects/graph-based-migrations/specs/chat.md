This is a really interesting design problem. Let me think through it carefully.
The core tension
You have content-addressable schema states where the schema hash determines identity. Pure structural migrations are path-independent — any sequence of DDL operations that gets you from state A to state B is equivalent. But data migrations break this: the path matters because data was transformed along the way, and different paths may leave data in different shapes even if the schema ends up identical.
So the question is: how do you track "what happened to the data" in a system whose fundamental abstraction is path-independent?
Approach 1: Data invariants as post-conditions on states
Your instinct about invariants is good but I'd refine it. Rather than tracking invariants accumulated along a path, attach data post-conditions to each state node. A post-condition is a predicate about the data that must hold after arriving at that state. For example:

"All rows in users have a non-null email"
"orders.total equals the sum of order_items.price * quantity for that order"
"accounts.balance is denominated in cents (integer), not dollars (float)"

The key insight: when you arrive at a state via different paths, the post-conditions must all hold regardless of path. If a data migration is required to establish a post-condition, then every path to that state must include a migration that establishes it. This makes post-conditions a property of the state, not the path, which fits your content-addressable model better.
The downside: this doesn't capture how the data was transformed, only what's true afterward. You lose provenance.
Approach 2: Typed edges with migration semantics
Make edges in your graph carry typed migration descriptors rather than arbitrary code. Instead of "run this script," an edge says:
rename_column(users, name -> full_name)
backfill(users.email_verified, default: false)
split_column(users.name -> users.first_name, users.last_name, separator: " ")
merge_tables(user_addresses + user_contacts -> user_info, key: user_id)
transform_column(orders.total, multiply: 100, comment: "dollars to cents")
This is your "recipes" idea, and I think it's the strongest approach. Here's why it solves the path problem:
Commutativity analysis. If your recipe set is small and well-defined, you can reason about which operations commute. rename_column and backfill on different columns commute. split_column and merge_tables on overlapping columns don't. This lets you determine whether two paths are data-equivalent even though they traverse different edges — you check whether the sequence of typed operations on each path produces the same result up to reordering of commutative ops.
Invertibility. Many recipes have natural inverses: rename(a→b) inverts with rename(b→a), split inverts with concat, backfill(default: X) inverts with drop_column. This means you can compute the net data transformation for a path and compare paths by their net effect.
Composition. Two recipes can often be composed into one: rename(a→b) then rename(b→c) collapses to rename(a→c). This gives you a kind of algebra over data migrations.
Approach 3: Hybrid — recipes + escape hatch with content hashing
In practice you'll hit cases that don't fit recipes. My suggestion:

Recipes for the common 80%. Define a closed set of typed, invertible, composable data migration operations. These are first-class citizens in your graph edges.
Custom migrations as opaque transforms with declared invariants. When someone needs arbitrary code, they write a custom migration but must declare pre-conditions and post-conditions. The system can't reason about commutativity for these, so it treats them as barriers — any path containing a custom migration is incompatible with paths that don't contain it (or contain a different one) unless they arrive at a state whose post-conditions are satisfied.
Data state fingerprinting. For custom migrations, after execution, compute a fingerprint of the affected data (e.g., hash a sample or hash the column statistics). Store this on the state node. When two paths converge at a state, compare fingerprints. If they match, the paths were data-equivalent despite using different custom migrations.

Approach 4: Separate the data migration graph
Another option entirely: don't mix data migrations into the schema graph at all. Maintain two parallel structures:

Schema graph: content-addressable, path-independent, exactly as you have it.
Data migration log: a linear, append-only sequence of data transformations that have been applied to this specific database instance.

The data migration log is instance-specific, not universal. When you deploy schema state X to a database, you look at that database's migration log and determine which data migrations still need to run. The schema graph stays clean and the messiness of data migration history lives where it belongs — on the specific database that has specific data.
This is arguably the most pragmatic approach. It acknowledges that data migrations are fundamentally about this data in this database, not about abstract state transitions.
My recommendation
I'd combine approaches 2 and 4:

Keep your schema graph pure and content-addressable.
Define a recipe algebra for typed data migrations (rename, backfill, split, merge, transform, cast, etc.) with known commutativity and invertibility properties.
Attach recipes to edges in the schema graph as recommended data migrations, but track actual applied migrations per-database-instance in a separate log.
When computing a migration plan from state A to state B, find a path, collect the recipes along it, simplify/reorder using commutativity rules, and present a concrete plan.
For custom migrations, require declared post-conditions, treat them as barriers for path equivalence, and fingerprint the result.

This gives you the theoretical cleanliness of content-addressable schema states, the practical power of typed composable data operations, and the honest acknowledgment that what actually happened to a specific database's data is an instance-level concern.
Want me to dig deeper into any of these? The recipe algebra in particular has some interesting design decisions around what the minimal useful set of operations would be and how to formalize commutativity.Yes I wanted to talk about the recipe algebra. Is there not some academic literature on something like this?Mar 28Good instinct — yes, there's quite a bit of relevant work, though it's scattered across several fields. Let me map out what's out there.
Bidirectional transformations (BX)
This is probably the most directly relevant body of work. The BX community studies "lenses" — pairs of transformations (get/put) that maintain consistency between two data structures. The seminal paper is Foster et al.'s "Combinators for Bidirectional Tree Transformations" (2007) from the Penn PLT group (Boomerang language). The key idea: you define small, composable, invertible transformations and compose them into larger ones, with well-defined laws governing round-tripping.
The lens laws are essentially your commutativity/invertibility requirements formalized:

GetPut: if you read then write back, nothing changes.
PutGet: if you write then read, you get back what you wrote.

Bohannon, Pierce, and Vaughan extended this to relational lenses specifically for database schemas in "Relational Lenses: A Language for Updatable Views" (PODS 2006). This is very close to what you want — they define combinators like select, project, join, and rename over relational data with bidirectional semantics.
Algebraic approaches to schema evolution
Curino et al.'s PRISM system (SIGMOD 2008, "Schema Evolution in Wikipedia") defines a closed set of Schema Modification Operators (SMOs) that are essentially your recipes:

ADD COLUMN, DROP COLUMN, RENAME COLUMN
ADD TABLE, DROP TABLE, RENAME TABLE
MERGE TABLES, SPLIT TABLE
COPY COLUMN, MOVE COLUMN

They proved that this set is complete for relational schema evolution — any schema change can be expressed as a composition of SMOs. More importantly for you, they showed how to automatically derive data migration queries from SMO sequences and how to reason about equivalence of SMO sequences through rewrite rules. This is almost exactly your recipe algebra.
Categorical database theory
David Spivak's work on functorial data migration (2012 and onward) takes a category-theoretic approach. A schema is a category (objects = tables, morphisms = foreign keys), and a migration is a functor between categories. The three fundamental operations are:

Δ (pullback/restriction): analogous to projection, dropping structure
Σ (left pushforward): analogous to joining/merging, introducing unions
Π (right pushforward): analogous to product/pairing, introducing combinatorial products

These three operations, composed freely, can express any data migration between relational schemas. The categorical framework gives you commutativity and associativity for free via functorial composition laws. Spivak implemented this in a tool called FQL/CQL (Categorical Query Language).
This is the most theoretically satisfying framework but probably overkill for a practical ORM. Still, the decomposition into Δ/Σ/Π is useful as a mental model for classifying your recipes.
Patch theory (Darcs, Camp, Pijul)
The version control world has studied exactly this problem in a different domain. Darcs's patch theory defines a set of operations with explicit commutation rules: for patches A and B, either they commute (AB = B'A' for some transformed B', A') or they conflict. This gives you:

A formal framework for when reordering is safe
A way to compute "merge" when two branches of your graph reconverge
A theory of inverse patches

Pijul (and the associated academic work by Samuel Mimram and Cinzia Di Giusto on "A Categorical Theory of Patches") took this further with a category-theoretic foundation. The parallel to your problem is direct: schema states are like file states, migrations are patches, and you want to know when two sequences of patches are equivalent.
What I'd actually use
For a practical recipe algebra in an ORM, I'd draw most heavily from PRISM's SMO framework, borrowing the categorical intuition from Spivak for the type system and the commutation machinery from patch theory. Concretely:
Define your recipes as a small set of typed operations, each with a known inverse and known commutation relations with every other operation. Build a rewrite system that can normalize any sequence of recipes into a canonical form. Two paths are data-equivalent iff their canonical forms are identical.
The PRISM paper is the most practical starting point. Spivak's CQL papers give you the theoretical foundation if you want to prove properties. The Boomerang/lens papers give you the compositional semantics.
Want me to sketch out what a concrete minimal recipe set might look like with explicit commutation rules?Yes it doesn't feel like many of the smid actually have to do with data migrations. Maybe we can discuss or try to nearly exhaustively enumerate the possible scenarios in which a data migration is necessary due to a schema change?Mar 28You're right — most SMOs are pure structural changes where the data just moves mechanically. Let me think about when a schema change actually forces you to make decisions about data.
The key question is: when does a schema transition require information that isn't present in the old schema, the new schema, or the data itself? That's when you need a data migration — when there's an information gap that requires human intent.
Cases where data migration is necessary
1. Column added with a non-trivial default
New NOT NULL column where the value can't be a static default. Example: you add users.display_name and want it populated from first_name || ' ' || last_name. The schema change alone doesn't tell you how to derive the value. A static default ("" or "unknown") is mechanical, but a computed backfill is a data migration.
2. Column type change with lossy or ambiguous conversion
Changing price FLOAT to price INTEGER — do you truncate, round, or multiply by 100 (cents)? Changing VARCHAR to ENUM — what happens to values that don't match any variant? Changing timezone-naive to timezone-aware timestamps — what timezone do you assume for existing data? The schema diff says "type changed" but doesn't say how to map values.
3. Column split
One column becomes two or more. name → first_name + last_name. The schema says the old column is gone and new ones exist, but parsing/splitting logic requires intent. Where do you split? What about edge cases (mononyms, multiple spaces)?
4. Column merge
Two or more columns become one. first_name + last_name → full_name. Which goes first? What separator? What if one is null?
5. Table split (vertical or horizontal)
One table becomes two. Vertical: users → users + user_profiles (which columns go where is structural, but if any data transformation happens during the split, that's a migration). Horizontal: orders → active_orders + archived_orders — the partitioning predicate is a data migration decision.
6. Table merge
Two tables become one. Key conflicts, deduplication strategy, which record wins on conflict — these are all data decisions.
7. Semantic reinterpretation without structural change
This is the sneaky one. The schema hasn't changed at all (or barely), but the meaning of the data has changed. Example: price was in dollars, now it's in cents. status integer values meant {1: active, 2: inactive}, now they mean {1: pending, 2: active, 3: inactive}. Same column, same type, different semantics. Your content-addressable schema might not even detect this as a state change.
8. Denormalization / materialization
Adding a derived column that needs to be backfilled from a computation over related data. orders.item_count computed from COUNT(order_items). accounts.balance computed from SUM(transactions.amount). The schema says "new column," the data migration is the aggregation query.
9. Normalization / extraction
Pulling repeated data out into a new table. orders.customer_name, orders.customer_email → customers table + orders.customer_id FK. You need deduplication logic: what constitutes "same customer"? Match on email? Name? Both?
10. Key/identity changes
Changing a natural key to a surrogate key or vice versa. Changing a primary key column. Composite key → single key. This requires generating new identifiers and updating all references — the mapping from old identity to new identity is a data decision.
11. Encoding/format changes
Stored JSON blob restructuring. Changing text encoding. Changing date format strings. Changing how NULLs are represented in a domain sense (empty string vs NULL vs sentinel value).
12. Data-dependent constraint enforcement
Adding a UNIQUE constraint when duplicates exist — which duplicate do you keep? Adding a NOT NULL constraint when nulls exist — what value replaces them? Adding a CHECK constraint when violations exist — how do you fix violating rows?
What's NOT a data migration
For contrast, these are pure structural operations with no information gap:

Adding a nullable column (NULL is the default, no decision needed)
Dropping a column (data is just discarded, no ambiguity)
Renaming a column (mechanical — though you might argue the mapping is information, it's typically inferred from the diff)
Adding/dropping an index (no data change)
Adding a FK constraint when data already satisfies it
Lossless type widening (INT → BIGINT, VARCHAR(50) → VARCHAR(100))

Patterns in the list
Looking at this, the cases cluster around a few fundamental information gaps:

Value derivation: where does new data come from? (cases 1, 8)
Value mapping: how do old values map to new representations? (cases 2, 7, 11)
Structural decomposition: how does one thing become many? (cases 3, 5)
Structural composition: how do many things become one, and what about conflicts? (cases 4, 6, 9)
Identity transformation: how do old identities map to new ones? (case 10)
Constraint reconciliation: how do you fix data that violates new rules? (case 12)

If your recipe set covers these six categories, I think you'd capture nearly everything. Want to work through what the concrete recipes for each category would look like?Sure, but we should aim to think in tiny generic operators that have useful propertiesMar 28Right. Let me think about what the minimal set of atomic operators would be, where each one does exactly one thing and has clear algebraic properties.
The goal is: each operator captures exactly one decision about data, is as small as possible, and composes into the complex scenarios above.
The atoms
backfill(table, column, expression)
Populates a column's values from an expression over the same row. This is the most fundamental operator — it's the one that introduces new information. The expression could reference other columns in the same row.

Inverse: none in general (it's a lossy overwrite of whatever was there before, typically NULLs)
Commutes with: any backfill on a different column, any operator on a different table
Doesn't commute with: another backfill on the same column (last write wins)

map(table, column, mapping)
Transforms existing values in a column according to a mapping function. This is distinct from backfill because the input is the column's own current value, not other columns.

Examples: multiply(100), cast(int, round), lookup({1: "active", 2: "inactive"}), regex_replace(...)
Inverse: only if the mapping is bijective. multiply(100) inverts with divide(100). lookup inverts if the map is bijective. Lossy mappings (like round) have no inverse.
Commutes with: map/backfill on different columns, operators on different tables
Doesn't commute with: another map on the same column (composition order matters unless both are linear)

copy(source_table, source_column, target_table, target_column, join_condition)
Copies data from one table/column to another via a join. This is the cross-table version of backfill.

Covers: denormalization, materialization, moving data during table splits
Inverse: copy in the other direction (if data still exists)
Commutes with: copies involving disjoint target columns

deduplicate(table, match_columns, strategy)
Reduces multiple rows to one based on a match key, with a strategy for which row wins (first, latest, max(column), etc.).

Covers: normalization/extraction, table merges with conflicts, unique constraint enforcement
Inverse: none (information is destroyed)
Commutes with: operators on different tables

filter(table, predicate, action)
Handles rows that match a predicate. Action is either delete or move(target_table).

Covers: horizontal table splits, constraint reconciliation (delete violating rows), archival
Inverse: move is invertible if you track where rows went. delete is not.
Commutes with: filters on different tables, filters on same table with disjoint predicates

generate(table, column, strategy)
Produces new values that don't derive from existing data. Strategy is something like uuid, sequence, hash(columns...).

Covers: surrogate key introduction, identity changes
Inverse: none (generated values are arbitrary)
Commutes with: almost everything (it's self-contained)

That might be it
Let me check against the scenarios:
ScenarioDecompositionComputed backfillbackfillLossy type changemapColumn splitbackfill(t, new1, expr1) + backfill(t, new2, expr2)Column mergebackfill(t, merged, expr_over_old_cols)Table split (vertical)copy source→target for moved columnsTable split (horizontal)filter(t, predicate, move(t2))Table mergecopy + deduplicate if conflictsSemantic reinterpretationmapDenormalizationcopy with joinNormalization/extractioncopy + deduplicateKey changegenerate + copy (to update FKs)Encoding changemapConstraint reconciliationfilter(delete) or map to fix values or backfill to fill nulls
Six operators, covers everything I could enumerate. Notably missing from most schema migration tools: deduplicate and filter are rarely first-class, but they capture real decisions people make.
Commutativity matrix
The short version: two operators commute if they touch disjoint (table, column) pairs. When they overlap:

backfill then map on same column ≠ map then backfill (backfill overwrites what map produced, vs map transforms what backfill produced)
map then map on same column = function composition (order matters, m2 ∘ m1 ≠ m1 ∘ m2 in general)
filter(delete) then backfill ≠ backfill then filter(delete) (you might backfill rows that get deleted, or delete rows before backfill — different work but same result if the filter predicate doesn't reference the backfilled column)

So the precise rule would be: two operators commute iff their read sets and write sets are disjoint. An operator's read set is every (table, column) it reads; write set is every (table, column) it modifies. This is exactly the Bernstein conditions from concurrency theory, which is a nice property — it means you get canonical forms via topological sort of the dependency graph.
What this gives you
With these six operators, you can:

Normalize any migration path into a canonical sequence by sorting commutative operators into a fixed order
Compare paths by checking if their canonical forms are identical
Detect conflicts at graph merge points by checking if non-commutative operators appear in different orders
Partially invert a migration by inverting the invertible subset and flagging the rest as lossy

The expression language inside backfill and map is where most of the real complexity hides. You could keep that as opaque SQL/code initially and still get useful algebraic reasoning from the operator structure alone. Or you could define a small expression DSL and get deeper analysis — but that's a separable decision.
What's your reaction? Does this feel like the right granularity?Let's walk through a real complicated example with made up tables and see what would happenMar 28Let's do it. I'll construct something messy enough to be realistic.
Starting schema
An e-commerce system that grew organically:
orders (
  id SERIAL PRIMARY KEY,
  customer_name VARCHAR,
  customer_email VARCHAR,
  customer_phone VARCHAR,
  shipping_street VARCHAR,
  shipping_city VARCHAR,
  shipping_zip VARCHAR,
  shipping_country VARCHAR(2),
  total FLOAT,            -- dollars, like 29.99
  status INTEGER,         -- 1=pending, 2=paid, 3=shipped, 4=delivered, 5=cancelled
  notes TEXT,             -- free text, sometimes contains JSON, sometimes plain text
  created_at TIMESTAMP,   -- timezone-naive, was always stored in US Eastern
  updated_at TIMESTAMP
)

order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders,
  product_name VARCHAR,
  product_sku VARCHAR,
  unit_price FLOAT,
  quantity INTEGER
)
Target schema
Someone got their act together:
customers (
  id UUID PRIMARY KEY,
  name VARCHAR NOT NULL,
  email VARCHAR NOT NULL UNIQUE,
  phone VARCHAR
)

addresses (
  id UUID PRIMARY KEY,
  customer_id UUID REFERENCES customers,
  street VARCHAR NOT NULL,
  city VARCHAR NOT NULL,
  zip VARCHAR NOT NULL,
  country VARCHAR(2) NOT NULL,
  label VARCHAR  -- 'shipping', 'billing', etc.
)

products (
  id UUID PRIMARY KEY,
  name VARCHAR NOT NULL,
  sku VARCHAR NOT NULL UNIQUE
)

orders (
  id UUID PRIMARY KEY,
  legacy_id INTEGER UNIQUE,
  customer_id UUID REFERENCES customers NOT NULL,
  shipping_address_id UUID REFERENCES addresses NOT NULL,
  total_cents BIGINT NOT NULL,
  status VARCHAR NOT NULL CHECK (status IN ('pending','paid','shipped','delivered','cancelled')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
)

order_items (
  id UUID PRIMARY KEY,
  order_id UUID REFERENCES orders NOT NULL,
  product_id UUID REFERENCES products NOT NULL,
  unit_price_cents BIGINT NOT NULL,
  quantity INTEGER NOT NULL
)

order_notes (
  id UUID PRIMARY KEY,
  order_id UUID REFERENCES orders NOT NULL,
  content TEXT NOT NULL,
  is_structured BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL
)
Now let's decompose
The structural diff is huge — new tables, dropped columns, type changes everywhere. But the data migration decisions are the interesting part. Let me walk through each operator needed:
Step 1: Generate surrogate keys
generate(orders, _new_uuid, uuid)
generate(order_items, _new_uuid, uuid)
We need UUIDs for every existing row before we can rewire references. These are pure generation — no decision, no data dependency.
Step 2: Extract customers
This is the hardest part. Multiple orders might be from the "same" customer but with inconsistent data. First we need to decide what "same" means:
deduplicate(orders, [email], strategy: latest(updated_at))
  → produces: customers_staging(name, email, phone)
This is one operator but it encodes a big decision: we're matching on email and taking the most recent name/phone when there are conflicts. Someone might reasonably want match on email+name or keep all phone numbers. The choice of match columns and strategy is the data migration.
Then generate identities for the new entities:
generate(customers_staging, id, uuid)
Step 3: Extract addresses
Similar problem — deduplicate and extract:
deduplicate(orders, [shipping_street, shipping_city, shipping_zip, shipping_country], strategy: first)
  → produces: addresses_staging(street, city, zip, country)
generate(addresses_staging, id, uuid)
backfill(addresses_staging, customer_id, 
  lookup via orders.customer_email → customers_staging.email → customers_staging.id)
backfill(addresses_staging, label, literal("shipping"))
That backfill of customer_id is a copy really — it's a cross-table join:
copy(customers_staging, id, addresses_staging, customer_id, 
  join: addresses_staging._source_email = customers_staging.email)
Step 4: Extract products
deduplicate(order_items, [product_sku], strategy: latest)
  → produces: products_staging(name, sku)
generate(products_staging, id, uuid)
Decision here: when the same SKU has different product names across orders, which name wins?
Step 5: Rewire orders
copy(customers_staging, id, orders, customer_id,
  join: orders.customer_email = customers_staging.email)
copy(addresses_staging, id, orders, shipping_address_id,
  join: orders.shipping_* = addresses_staging.*)
Step 6: Rewire order_items
copy(products_staging, id, order_items, product_id,
  join: order_items.product_sku = products_staging.sku)
copy(orders, _new_uuid, order_items, _new_order_id,
  join: order_items.order_id = orders.id)
Step 7: Transform values
Now the type/semantic changes:
map(orders, total, multiply(100))           -- dollars → cents
map(order_items, unit_price, multiply(100)) -- dollars → cents
map(orders, status, lookup({
  1: "pending", 2: "paid", 3: "shipped", 
  4: "delivered", 5: "cancelled"
}))
map(orders, created_at, assume_tz("America/New_York"))
map(orders, updated_at, assume_tz("America/New_York"))
Every one of these is a decision. The multiply(100) assumes prices were in whole dollars and cents, not fractional cents. The timezone assumption could be wrong for some records.
Step 8: Handle the notes column
This is messy — sometimes JSON, sometimes plain text, going into a separate table:
copy(orders, notes, order_notes, content,
  join: order_notes.order_id = orders._new_uuid)
backfill(order_notes, is_structured, expr: is_valid_json(content))
backfill(order_notes, created_at, expr: source.orders.created_at)
filter(order_notes, predicate: content IS NULL, action: delete)
Full operator sequence
-- identity generation (all commute with each other)
generate(orders, _new_uuid, uuid)
generate(order_items, _new_uuid, uuid)

-- extraction (deduplicate → generate → copy pattern)
deduplicate(orders, [email], latest(updated_at)) → customers_staging
generate(customers_staging, id, uuid)
deduplicate(orders, [shipping_street, shipping_city, shipping_zip, shipping_country], first) → addresses_staging
generate(addresses_staging, id, uuid)
deduplicate(order_items, [product_sku], latest) → products_staging
generate(products_staging, id, uuid)

-- cross-references (copies, order matters within a table)
copy(customers_staging, id, addresses_staging, customer_id, ...)
backfill(addresses_staging, label, "shipping")
copy(customers_staging, id, orders, customer_id, ...)
copy(addresses_staging, id, orders, shipping_address_id, ...)
copy(products_staging, id, order_items, product_id, ...)
copy(orders, _new_uuid, order_items, _new_order_id, ...)

-- value transforms (commute with each other, different columns)
map(orders, total, multiply(100))
map(order_items, unit_price, multiply(100))
map(orders, status, lookup({1:"pending", ...}))
map(orders, created_at, assume_tz("America/New_York"))
map(orders, updated_at, assume_tz("America/New_York"))

-- notes extraction
copy(orders, notes, order_notes, content, ...)
backfill(order_notes, is_structured, is_valid_json(content))
filter(order_notes, content IS NULL, delete)
What we can see now
The dependency graph has clear phases. The generate ops have no dependencies. The deduplicate ops depend only on source data. The copy ops depend on generate and deduplicate having run. The map ops on orders are independent of the extraction ops (they touch different columns). So there's significant parallelism and the canonical ordering is a partial order, not a total one.
If someone took a different path through the schema graph — say, an intermediate state where they extracted customers first, then later did the price conversion in a separate migration — the canonical form would be the same, because deduplicate(orders, [email], ...) commutes with map(orders, total, multiply(100)) (disjoint read/write sets).
But if one path used deduplicate(orders, [email], latest) and another used deduplicate(orders, [name, email], first), those are genuinely different migrations and the system should flag them as incompatible.
What jumps out at you? I'm noticing that deduplicate is doing a lot of heavy lifting and might want to be decomposed further.Perhaps. But I'm wondering whether we can realistically generate these from a diff. We know the before and after state of the database, but withoutnst least asking the user questions like "did you create this column or did you rename from another" and so on, there's no way for us to know. But even just asking the user the right questions IOW knowing the set of possible operations that can transform one database to the other seems hardMar 28You're hitting the fundamental problem. The structural diff between two schemas is ambiguous — it's a set of column additions and removals, and you can't tell whether a removed column and an added column are actually a rename, a split, a semantic reinterpretation, or genuinely unrelated.
Let me think about what the diff actually gives us and where the ambiguity lives.
What a structural diff produces
Given before and after schemas, you can mechanically determine:

Tables added
Tables removed
Columns added (within a surviving table)
Columns removed (within a surviving table)
Type changes (same table, same column name, different type)
Constraint changes (nullability, uniqueness, checks, FKs)

That's it. Everything else is interpretation.
The ambiguity space
When you see a removed column and an added column, the possible explanations are:

Unrelated: old column was dropped, new column is genuinely new
Rename: same data, new name
Rename + transform: same data, new name, values changed (rename + map)
Split: old column became multiple new columns
Merge: multiple old columns became one new column

When you see a removed table and an added table:

Unrelated: old table dropped, new table is fresh
Rename: same table, new name
Split: one table became two
Merge: two tables became one
Normalization/extraction: data pulled out into new table with FK back

And you literally cannot distinguish these from the diff alone. A rename looks exactly like a drop + add.
But we can narrow it down with heuristics
Here's what I think is actually tractable. You score candidate interpretations:
Column-level signals:

Same name, different type → almost certainly a type change, ask about conversion strategy
Removed column + added column with same type in same table → likely rename, ask to confirm
Removed column + multiple added columns of compatible types → possible split
Multiple removed columns + one added column → possible merge
Added NOT NULL column with no default → definitely needs a backfill decision
New FK column pointing at a new table, old table had denormalized columns matching the new table's shape → almost certainly normalization/extraction

Table-level signals:

Removed table + new table with subset of same columns → likely rename or evolution
Removed table + new table + new FK from existing table to new table → extraction
Two removed tables + one new table with union of columns → merge
One removed table + two new tables that partition its columns → vertical split

Name similarity:

Levenshtein or token overlap between removed and added names (customer_name → name on a new customers table is a strong signal)

The question tree
Rather than generating the migration, you generate a set of questions from the diff. Each question resolves one ambiguity. Something like:
Diff shows: orders.customer_name removed, customers.name added

Possible interpretations:
  a) orders.customer_name was extracted to customers.name (confidence: high)
     → implies: deduplicate + copy
  b) orders.customer_name was dropped, customers.name is unrelated (confidence: low)
     → implies: backfill(customers, name, ???)

Question: "Was customers.name extracted from orders.customer_name?"
  If yes → follow-up: "How should duplicate customer names be resolved?"
    Options: [keep latest, keep first, manual review]
So the system would:

Compute the structural diff
Generate candidate interpretations ranked by heuristic confidence
For each ambiguity, produce a question
User answers collapse the ambiguity into concrete operators
Any remaining "added NOT NULL column" without a source gets a backfill question

What questions are actually needed
Let me enumerate the question types:
"Is this a rename?" — shown whenever a column/table disappears and a plausibly similar one appears. This is the most common question. If yes, no data migration needed (just structural). If no, you might need a backfill or a copy.
"What's the source?" — for any new NOT NULL column that doesn't match a removed column. "Where does this data come from?" Options: static default, expression over existing columns, external source (implies manual migration).
"How to convert?" — for type changes that aren't lossless. FLOAT → BIGINT: multiply by what? TIMESTAMP → TIMESTAMPTZ: assume what timezone? INTEGER → VARCHAR with a CHECK constraint: what's the mapping?
"How to deduplicate?" — whenever an extraction is detected (denormalized data → new table). "Multiple orders have different values for customer_name with the same email. Which wins?"
"What about violations?" — when a new constraint is added. "47 rows have NULL in a now-NOT-NULL column. What value should they get?" Or "12 rows violate the new UNIQUE constraint. How to resolve?"
"How to partition?" — if a table split is detected. "What determines which rows go to which table?"
The realistic workflow
I think the honest design is:

User defines before and after contracts (your content-addressable states)
System computes structural diff
System runs heuristics to generate a draft migration plan with high-confidence interpretations pre-filled and low-confidence ones as questions
User answers questions and confirms/overrides the draft
System emits a concrete sequence of your six operators
That operator sequence is stored on the edge in the graph

The recipe algebra isn't what the user interacts with directly — it's the compilation target. The user interacts with questions and answers. The system compiles those answers into operators. The operators are what get stored, compared, and reasoned about algebraically.
This also means you can re-derive the questions from the diff at any time, and you can validate that a stored operator sequence is consistent with the diff it claims to implement.
The hard part isn't really the algebra — it's making the heuristics good enough that users typically only need to answer 2-3 questions rather than 15. Does that feel right to you?I think the hard part is actually the algebra tbh. I'm not convinced it covers all scenariosMar 28Fair. Let me try to break it. Let me think about what scenarios might not decompose cleanly into the six operators.
Trying to break the algebra
Multi-row aggregation backfill
You add orders.item_count and want it populated from COUNT(order_items WHERE order_items.order_id = orders.id). This isn't backfill because backfill is defined as an expression over the same row. It's not copy because copy moves a value from one place to another — there's no single source value, there's an aggregation.
We need something like aggregate(source_table, target_table, target_column, join, agg_function). Or we stretch copy to include aggregation, but then copy is doing two things.
Conditional transformation
map(orders, status, lookup({1: "pending", ...})) works when the mapping is total. But what if you need: "if created_at is before 2020, the status values meant something different"? The mapping depends on another column. map as defined takes one column's value as input. A conditional map is really backfill with a CASE expression, but then backfill and map blur together.
Actually — is map just a special case of backfill where the expression only references the column itself? If so maybe we should collapse them.
Row-level splitting
One row becomes multiple rows. A tags VARCHAR column containing "red,blue,green" gets normalized into a tags junction table with three rows. None of our operators create new rows from existing data. deduplicate reduces rows, filter removes rows, copy copies values but the row count in the target is determined by the join. Actually maybe copy with the right join does handle this — if order_tags is pre-populated with one row per tag value, then copy fills in the FK. But who creates those rows? The unpacking of "red,blue,green" into three rows is a new operation.
Call it expand(source_table, source_column, target_table, split_strategy) maybe. Or unnest.
Cross-row data dependency
"Set each employee's manager_name based on looking up employees.name where employees.id = employees.manager_id." This is a self-join copy. copy handles this if we allow source and target to be the same table, but it's worth noting as a case.
Ordered/positional operations
"Split the address text field into street (everything before the first newline) and city_state_zip (everything after)." This is positional parsing. It's a backfill with a complex expression, which is fine, but it means the expression language inside backfill needs to be pretty powerful — regex, string splitting, array indexing.
External data enrichment
"Look up country codes from an external geocoding API to populate addresses.country." No operator handles this because the data source is outside the database. This might be out of scope — you could say "custom migration" — but it does happen.
Revised operator set
I think the honest minimal set is:
derive(table, column, expression) — collapses backfill and map into one. The expression can reference any column in the same row, including the target column itself. map is just derive where the expression only reads the column being written. This is cleaner.
derive_across(target_table, target_column, source_table, join, expression) — the cross-table version. Expression can include aggregates. This collapses copy and handles the aggregation case. The join determines row matching, the expression determines the value.
deduplicate(table, match_columns, strategy) — unchanged.
expand(source_table, source_column, target_table, strategy) — one row becomes many. Strategy is something like split(delimiter), unnest_json_array, regex_matches. Produces rows in the target with an FK back to the source.
filter(table, predicate, action) — unchanged.
generate(table, column, strategy) — unchanged.
So: derive, derive_across, deduplicate, expand, filter, generate.
Still six, but different six. The big change is derive absorbing backfill and map, derive_across absorbing copy and adding aggregation, and expand being new.
What's still missing
The expression language inside derive and derive_across is doing a ton of work. derive(orders, total, self * 100) and derive(orders, status, CASE WHEN created_at < '2020' THEN ... END) are wildly different in complexity. If we leave the expression language as "arbitrary SQL" we get completeness but lose the ability to reason about commutativity at the expression level.
There might also be cases I haven't thought of. What does your intuition say — does anything come to mind that doesn't fit these six?
