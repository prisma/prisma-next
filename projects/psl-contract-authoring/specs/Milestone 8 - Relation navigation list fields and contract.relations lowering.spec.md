# Summary

Accept **relation navigation list fields** in PSL (for example `User.posts Post[]`) while continuing to **strictly reject scalar list fields** (for example `User.tags String[]`), and populate **`contract.relations`** deterministically so both sides of a 1:N relation (the N:1 FK side and the 1:N backrelation list side) are represented consistently.

# Description

Today the SQL PSL provider rejects all list fields (`[]`) as unsupported, including both scalar lists and relation navigation lists. This blocks common PSL schemas that include the 1:N “backrelation” list field.

Separately, the Prisma Next ORM include surface reads relation metadata from `contract.relations` (keyed by storage table name, then relation field name). TS-first authoring already produces this metadata; PSL-first interpretation currently lowers foreign keys but does not populate `contract.relations`, leaving relation includes under-specified.

Milestone 8 closes this gap by:

- loosening list handling to accept **relation navigation lists** (only when they correspond to an FK-side relation that PSL can already lower), while continuing to reject scalar lists, and
- emitting stable `contract.relations` entries for both sides of each lowered 1:N relation so that include/join tooling can reason about relations deterministically.

# Requirements

## Functional Requirements

### 1. List field handling (scalar lists remain unsupported)

- **Accept relation navigation list fields** when all of the following hold:
  - the field is a list (`[]`) and its element type resolves to a **model type** in the PSL document
  - the field is a **navigation-only backrelation** (it does not map to a storage column)
  - the field can be matched to an existing FK-side relation (see “Matching backrelation list fields” below)
- **Reject scalar lists** as strict errors:
  - any list field whose element type resolves to a scalar, enum, or named type instance (storage type) is rejected
  - diagnostics must remain span-based and actionable

**Assumption:** this milestone does not introduce a general-purpose “array column” storage representation; scalar lists remain out of scope by design for SQL contracts.

### 2. Matching backrelation list fields to FK-side relations

When a model contains a relation navigation list field (for example `User.posts Post[]`), the interpreter must match it to an existing FK-side relation on the target model (for example `Post.user User @relation(fields: [userId], references: [id])`).

- A relation navigation list field is accepted **only if** a matching FK-side relation exists.
- If no matching FK-side relation exists, fail with a targeted diagnostic that suggests:
  - adding the FK-side relation with `@relation(fields: [...], references: [...])`, or
  - modeling many-to-many as an explicit join model (if the intent was M:N).

**Determinism rule:** matching must be stable. If multiple FK-side candidate relations exist (ambiguous match), fail with a targeted diagnostic explaining the ambiguity and how to resolve it.

**Matching strategy (supports full PSL relation naming when present):**

- If the list field has `@relation(name: "...")` (or `@relation("...")`) then:
  - match only FK-side relations with the same relation name.
  - if there is not exactly one match, emit a targeted diagnostic (missing or ambiguous).
- Otherwise (no relation name present):
  - “Candidate relations” are FK-side relation fields on the target model where:
    - the relation field’s `typeName` matches the parent model name, and
    - the FK-side relation’s referenced columns are columns on the parent model’s table (after mapping).
  - If exactly one candidate exists, it is the match.
  - If more than one candidate exists, the match is ambiguous and must error.
  - If no candidate exists, the backrelation list field is orphaned and must error.

### 3. `contract.relations` emission (both sides, stable keys)

Emit relation metadata into the contract under `contract.relations` for:

- the FK-side relation field (`N:1` or `1:1` where applicable), and
- the backrelation list field (`1:N`).

`contract.relations` is structured as:

- first key: **storage table name** of the “declaring” model (the model that contains the relation field)
- second key: **relation field name** (the model field name, as written in PSL)

Each relation entry must include at least:

- `to`: target model name
- `cardinality`: one of `'N:1' | '1:N' | '1:1'` (this milestone focuses on 1:N + its inverse)
- `on`: join columns oriented from the declaring model to the related model:
  - `parentCols`: columns on the declaring model’s table
  - `childCols`: columns on the related model’s table

**Orientation examples (1:N):**

- For `Post.user` (declared on `post` table): `parentCols = [post.user_id]`, `childCols = [user.id]`, cardinality `'N:1'`.
- For `User.posts` (declared on `user` table): `parentCols = [user.id]`, `childCols = [post.user_id]`, cardinality `'1:N'`.

**Determinism requirements:**

- Entries are keyed by deterministic strings (table name + field name).
- For a given PSL input, the emitted `contract.relations` object must be stable under re-emission (no dependency on traversal order beyond deterministic sorting).

**Note:** Model-local `models.<Model>.relations` must remain present for compatibility, but `contract.relations` is the canonical include metadata used by the ORM include surface.

### 4. Existing strictness guarantees remain

- Implicit Prisma ORM many-to-many (list navigation on both sides without an explicit join model) remains unsupported and must fail with a strict diagnostic that recommends the explicit join model approach.
- This milestone does not introduce scalar list storage columns or any “array codec” mapping.

## Non-Functional Requirements

- **Parity with TS authoring**: for schemas representable in both surfaces, PSL-first emission must match the canonical meaning and produce compatible relation metadata to TS-first, including deterministic `contract.json`.
- **Diagnostics quality**: new failures (scalar lists, ambiguous backrelation matches, orphaned backrelation lists) must include precise spans and actionable messages.
- **Deterministic emission**: `contract.relations` must be emitted in a stable, deterministic way suitable for hashing/canonicalization.

## Non-goals

- Implicit many-to-many support (without an explicit join model).
- Scalar list column support.
- Runtime behavior changes in query lanes beyond consuming the newly populated `contract.relations` (the goal is metadata completeness, not new runtime semantics).

# Acceptance Criteria

- [ ] A PSL schema with a basic 1:N relation including a backrelation list field (for example `User.posts Post[]`) is accepted by the SQL PSL provider.
- [ ] Scalar list fields (for example `String[]`) still fail with a strict, span-based diagnostic.
- [ ] `contract.relations` is populated for both sides of a 1:N relation:
  - [ ] FK-side (`N:1`) entry exists under the declaring model’s table name and relation field name
  - [ ] backrelation (`1:N`) entry exists under the parent model’s table name and list field name
  - [ ] each entry uses the oriented `on.parentCols`/`on.childCols` convention described above
- [ ] A fixture-driven parity case exists that demonstrates canonical `contract.json` equality (and stable hash equality where applicable) between:
  - PSL schema with a 1:N relation including the backrelation list field, and
  - equivalent TS authoring fixture using `.relation(...)`.
- [ ] A diagnostics case exists for an orphaned backrelation list field (no matching FK-side relation), with an actionable message.
- [ ] A diagnostics case exists for ambiguous backrelation list field matching (multiple FK-side candidates), with an actionable message.
- [ ] Documentation is updated to reflect:
  - relation navigation list fields are supported (when backed by an FK-side relation), and
  - scalar lists remain unsupported, and
  - many-to-many guidance remains “explicit join model”.

# References

- Project spec: `projects/psl-contract-authoring/spec.md`
- Project plan: `projects/psl-contract-authoring/plans/plan.md` (Milestone 8)
- SQL PSL provider README: `packages/2-sql/2-authoring/contract-psl/README.md`
- ADR 121 (relation typing + `contract.relations`): `docs/architecture docs/adrs/ADR 121 - Contract.d.ts structure and relation typing.md`
- Linear: `https://linear.app/prisma-company/issue/TML-2038/psl-accept-relation-navigation-list-fields-and-emit-contractrelations`

# Open Questions

None.
