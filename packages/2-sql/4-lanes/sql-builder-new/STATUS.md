# sql-builder-new — Status

## What exists

A type-level-only SQL query builder DSL with no runtime implementation. Validates the API shape and type inference of a fluent SQL query builder via TypeScript types and `expectTypeOf` tests.

### Covered

- **FROM** (table)
- **SELECT** (column names, aliased expressions, callback returning record)
- **WHERE**
- **JOIN** (INNER, LEFT OUTER, RIGHT OUTER, FULL OUTER, LATERAL, LATERAL LEFT)
- **ORDER BY** (with direction, nulls first/last)
- **GROUP BY**
- **HAVING**
- **LIMIT / OFFSET** (number or expression)
- **Subqueries as join sources** (via `.as()`)
- **Self-joins** (via `.as()`)
- **Aggregate functions**: `count`, `sum`, `avg`, `min`, `max`
- **Comparison operators**: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`
- **Logical operators**: `and`, `or`
- **Subquery predicates**: `exists`, `notExists`, `in` (subquery or array), `notIn` (subquery or array)

## What's missing

### Clauses

- **DISTINCT** / **DISTINCT ON (expr, ...)**
- **WITH** (common table expressions) / **WITH RECURSIVE**
- **UNION** / **INTERSECT** / **EXCEPT** (and their `ALL` variants)
- **FOR UPDATE / FOR SHARE / FOR NO KEY UPDATE / FOR KEY SHARE** (row locking)
- **FETCH FIRST n ROWS ONLY** (SQL-standard syntax — functionally LIMIT but with `WITH TIES`)
- **TABLESAMPLE**

### FROM sources

- **CROSS JOIN**
- **NATURAL JOIN** (all variants)
- **FROM subquery** as the initial source (currently only tables can be the root `.from()`)
- **Multiple FROM items** (implicit cross join: `FROM a, b`)
- **VALUES** as a row source
- **USING** join condition (shorthand for equi-join on same-named columns)
- **generate_series()** and other set-returning functions as FROM sources

### Expressions & operators

- **NOT** (boolean negation)
- **IS NULL / IS NOT NULL**
- **BETWEEN ... AND ...**
- **LIKE / ILIKE / SIMILAR TO**
- **ANY / ALL / SOME**
- **Arithmetic**: `+`, `-`, `*`, `/`, `%`
- **String concatenation**: `||`
- **CASE WHEN ... THEN ... ELSE ... END**
- **CAST(expr AS type)** / `expr::type`
- **COALESCE / NULLIF / GREATEST / LEAST**
- **Scalar subqueries** (subquery in SELECT list or WHERE)
- **Row constructors** / row-level comparisons
- **Array operators**: `@>`, `<@`, `&&`, indexing, slicing
- **JSON/JSONB operators**: `->`, `->>`, `#>`, `@>`, `?`, etc.

### Window functions

- **OVER (PARTITION BY ... ORDER BY ... frame)**
- **Named windows** (`WINDOW w AS (...)`)
- **Ranking**: `row_number()`, `rank()`, `dense_rank()`, `ntile()`
- **Offset**: `lag()`, `lead()`, `first_value()`, `last_value()`, `nth_value()`
- **Frame clauses**: `ROWS/RANGE/GROUPS BETWEEN ...`

### Advanced GROUP BY

- **GROUPING SETS**
- **CUBE**
- **ROLLUP**
- **FILTER (WHERE ...)** clause on aggregate calls

### Functions (beyond the 5 aggregates)

- **String**: `length`, `substring`, `trim`, `upper`, `lower`, `regexp_match`, ...
- **Math**: `abs`, `ceil`, `floor`, `round`, `power`, ...
- **Date/time**: `now()`, `date_trunc`, `extract`, interval arithmetic, ...
- **Array**: `array_agg`, `unnest`, `array_length`, `array_position`, ...
- **JSON**: `json_agg`, `jsonb_build_object`, `json_each`, ...
- **Conditional**: `coalesce`, `nullif`, `greatest`, `least`

## Priority gaps

The most impactful gaps for a practical query builder: **DISTINCT**, **CTEs**, **set operations** (UNION/INTERSECT/EXCEPT), **window functions**, **IS NULL**, **NOT**, **CASE**, **arithmetic**, and **COALESCE** — those cover the vast majority of real-world queries that the current types can't express.
