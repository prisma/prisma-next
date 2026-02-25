# Round 1 Clarifying Questions -- Repository Model Client

Based on your idea for a **Model Client / Repository Pattern** and the extensive context of what already exists (working `Collection`, `Repository`, `orm()` factory, include stitching, custom repository subclasses, Kysely-based SQL compilation, and the integration tests in the demo app), I have some clarifying questions:

---

**1. Scope boundary -- read-only vs. mutations in this spec**

The current implementation covers the read path: `findMany()`, `findFirst()`, `where()`, `include()`, `orderBy()`, `take()`, `skip()`. The `new-api.md` sketches also show mutations (`.create()`, nested mutations like `.findUnique().comments.create(commentInput)`), and ADR 161 explicitly discusses CREATE without RETURNING and nested creates.

I am assuming this spec should focus on **solidifying and completing the read API** (including any gaps like `findUnique()`, `count()`, `exists()`, `select()` for field projection, and `distinct()`) and then separately tackle **basic single-model mutations** (`create`, `update`, `delete`). Is that correct, or should mutations be deferred entirely to a follow-up spec? Alternatively, should nested mutations (parent + children) also be in scope here?

---

**2. The `findFirst()` return type -- single item vs. array**

Currently `findFirst()` returns `AsyncIterableResult<Row>` (same as `findMany()`, just with `limit 1`). This means callers still call `.toArray()` and get an array. I am assuming `findFirst()` should be changed to return `Promise<Row | null>` (a single item or null) to match the typical ORM convention and Prisma ORM's behavior. Is that correct, or should `findFirst()` keep returning `AsyncIterableResult` for consistency with the streaming model?

Similarly, should there be a `findUnique()` variant that throws when no row is found (or returns `Row` without the null case)?

---

**3. The `where()` API -- compound filters (AND/OR/NOT)**

Currently `where()` only supports single-column comparisons via `ColumnAccessor` (eq, neq, gt, lt, gte, lte), and multiple `where()` calls are implicitly ANDed. The `new-api.md` sketches show `where({ id: postId })` (object syntax) and `where(u => u.posts.has(p => p.popular()))` (relation-level filtering).

I am assuming this spec should define at least:
- Compound logical operators: `and()`, `or()`, `not()` within a `where()` callback
- String-specific operators: `contains`, `startsWith`, `endsWith`
- List operators: `in`, `notIn`
- Null checks: `isNull`, `isNotNull`

Should we also include **relation-level filters** (filtering parent by child existence, like `u.posts.has(...)`) in this spec, or defer that to a follow-up?

---

**4. The `orderBy()` ergonomics**

Currently `orderBy()` takes a callback that returns `{ column: string; direction: 'asc' | 'desc' }`. The demo code uses it as `orderBy(() => ({ column: 'createdAt', direction: 'desc' }))`, which is not leveraging the typed column accessor. I am assuming `orderBy()` should be redesigned to use the same typed accessor pattern, something like:

```typescript
.orderBy(u => u.createdAt.asc())
// or
.orderBy(u => u.createdAt.desc())
```

Is that the desired direction? Should multi-column ordering be handled by chaining multiple `.orderBy()` calls (current approach) or via a single call with an array?

---

**5. Field selection / projection**

The current implementation always selects all scalar fields (`selectAll()`). The `new-api.md` sketches explored `.select()` with both a callback form and an object form (both were marked as "rejected for now").

I am assuming field projection (selecting a subset of columns) is **out of scope** for this spec and all queries will return the full model row type. Is that correct, or is `.select()` needed now?

---

**6. Custom repository pattern ergonomics**

The current pattern for custom repositories requires manually passing `ctx` and `modelName` to the constructor:

```typescript
class UserRepository extends Repository<Contract, 'User'> { ... }
new UserRepository({ contract, runtime }, 'User');
```

The `new-api.md` originally sketched `new PostRepository(executionContext)` (no model name). I am assuming we should improve this so the model name is inferred or statically set in the class definition, reducing boilerplate. For example:

```typescript
class UserRepository extends Repository<Contract, 'User'> {
  // modelName automatically set to 'User' from the generic parameter
}
```

Should the custom repository constructor be simplified in this spec, or is the current explicit pattern acceptable for now?

---

**7. Transaction support at the repository level**

ADR 161 mentions `transaction(fn)` as a runtime primitive the repository layer uses. The `RuntimeQueryable` interface already has `transaction?(): Promise<RuntimeTransaction>`. However, there is no user-facing transaction API on the `orm()` client yet (like `db.$transaction(async (tx) => { ... })`).

I am assuming this spec should at minimum define how users wrap multiple repository operations in a transaction. Is a `db.$transaction()` pattern the right approach, or should transaction scoping be handled differently (for example, passing a transaction context to individual repository methods)?

---

**8. Relation cardinality handling (1:1 vs. 1:N)**

Currently `include()` always returns an array for related records (`.posts: IncludedRow[]`). The contract defines cardinality (`1:N`), but the code does not distinguish between `1:1` (should return `IncludedRow | null`) and `1:N` (should return `IncludedRow[]`).

I am assuming this spec should address cardinality-aware return types for includes, so that a `belongsTo`/`hasOne` relation returns a single object (or null) instead of an array. Is that correct?

---

**9. Error handling strategy**

There is currently no explicit error handling in the repository layer beyond the basic `throw new Error(...)` for missing relations. Prisma ORM has well-known error codes (P2001, P2025, etc.).

I am assuming this spec should at least define how common error scenarios are surfaced:
- Record not found (for `findUnique` / `findUniqueOrThrow`)
- Constraint violations (unique, foreign key)
- Invalid filter values

Should we define a repository-specific error taxonomy, or defer error handling details to a separate spec?

---

**10. Is there anything that should explicitly be excluded from this spec?**

Based on the context, I am assuming the following are out of scope:
- Aggregations (`count`, `sum`, `avg`, `min`, `max`, `groupBy`)
- Raw SQL escape hatch at the repository level
- Cursor-based pagination
- Batch operations (`createMany`, `updateMany`, `deleteMany`)

Are there other features or concerns I should explicitly exclude, or should any of these actually be in scope?

---

**Existing Code Reuse:**

Are there existing features in your codebase with similar patterns we should reference? For example:
- The `sql-lane` package has a composable query DSL -- should the repository layer internally delegate to it for building Plans, or continue using Kysely directly as it does now?
- The `sql-orm-lane` package (`@prisma-next/sql-orm-lane`) appears to be the ORM lane that ADR 161 says will be superseded -- should we reference its patterns or deliberately diverge?
- The `RuntimeExecutor` plugin lifecycle (hooks like `beforeCompile`, `afterExecute`) -- should repository operations participate in these hooks at the operation level?

Please provide file/folder paths or names of these features if there are specific patterns to follow or avoid.

---

**Visual Assets Request:**

Do you have any design mockups, wireframes, screenshots, or API flow diagrams that could help guide the development?

If yes, please place them in: `/Users/aqrln/prisma/prisma-next/specs/2026-02-16-repository-model-client/planning/visuals/`

Use descriptive file names like:
- api-flow-diagram.png
- repository-class-hierarchy.png
- query-execution-flow.png
- include-stitching-sequence.png

---

Please answer the questions above and let me know if you have added any visual files or can point to similar existing features.
