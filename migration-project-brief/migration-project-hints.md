# Migration Project Hints

An inline, strongly-typed PSL attribute is the cleanest "edit PSL, get migrations" UX—without a separate hints file or brittle comment syntax.

Here's a concrete proposal you can ship:

## PSL-embedded migration hints: @hint(...)

### Design goals
- **Inline & local**: intent sits next to the thing you're changing.
- **Typed & validated**: parser enforces shape; low chance to "screw up".
- **Deterministic**: hints guide planning but do not affect the contract hash.
- **One-shot**: hints are scoped to a specific "from" contract (optional) and become no-ops afterward.

---

## Attribute shape (MVP)

You can attach `@hint(...)` to models and fields.

### Common fields
- `for?: "sha256:<A>"` — (optional) only apply when planning from contract A.
- `was?: string` — previous identifier (model or field rename).
- `drop?: boolean` — explicitly allow dropping this model/field.
- `notes?: string` — carried into notes.md for reviewers.

### Field-only extras
- `castTo?: ColumnType` — allow type change; optional `using?: string` for SQL USING.
- `notNullBackfill?: { kind: "literal"|"now", value?: string }` — how to backfill before SET NOT NULL.

`ColumnType` = your IR's type union, e.g. "int4"|"text"|"bool"|....

### Examples (your sketch, with slight tweaks)

```prisma
/// Renaming model `user` → `People`
@hint(was: "user")
model People {
  id       Int     @id @default(autoincrement())

  /// This used to be `name`; keep the unique, too.
  email    String  @unique @hint(was: "name")

  name     String

  /// Tighten to NOT NULL; backfill false for existing NULLs.
  active   Boolean @default(false)
                     @hint(notNullBackfill: { kind: "literal", value: "false" })
}
```

More cases:

```prisma
/// Rename + narrow index name (optional)
@hint(was: "orders")
model Purchase {
  total String
  /// Cast text → float8 with explicit USING
  amount Float @hint(castTo: "float8", using: "amount::double precision")

  legacy_id Int? @hint(drop: true, notes: "Safe to drop after 2025-10-01")
}
```

---

## Parsing & hashing rules
- The PSL emitter must capture `@hint` separately from the contract.
- Hints go into a side-channel: `contract.hints: { models: {...}, fields: {...} }`.
- When computing contractHash, ignore hints entirely.
- The planner loads:
  - contractA (from DB or last migration),
  - contractB (from current PSL),
  - hints (from current PSL).
- Hints are canonicalized (sorted keys, normalized literals) and folded into opSetHash context so planning remains reproducible:

```
opSetHash = sha256(canonical(opset) + canonical(hintsUsed) + rulesVersion)
```

---

## Planner semantics (deterministic)

1. **Scope check**
   If a hint has `for` and it ≠ contractA.hash, ignore it (log: "hint skipped: for=X, from=Y").

2. **Apply renames first**
   - Model: `@hint(was: "users")` on model People → emit renameTable(users→people) and align graphs.
   - Field: `@hint(was: "name")` on email → emit renameColumn.

3. **Diff & emit ops**
   - `castTo` (with optional using) permits otherwise "unsafe" type change → emit alterColumn(setType, using?).
   - `notNullBackfill` → emit backfill op, then setNotNull.
   - `drop: true` → allow dropColumn/dropTable (else blocked by default).

4. **Validation**
   - `was` must point to an existing thing in A; if not, fail with a precise message.
   - `castTo` must be a known type; if narrowing and no hint, fail with "add @hint(castTo: ...) or widen".
   - `notNullBackfill` required if tightening nullability and B has no default covering existing NULLs.

5. **After planning**
   - Hints are not written into meta.json/opset.json. They're only recorded in notes.md and diff.json for audit.

---

## Why this is hard to mess up
- It's a single attribute name (`@hint`), with a fixed schema you validate at parse time:
  - Unknown keys → error.
  - Wrong value types → error.
- It's attached to the exact thing you're changing (no path strings to typos).
- Optional `for` prevents stale hints from silently doing the wrong thing later.
- Even if users forget `for`, a rename is still safe: if "was: X" doesn't exist in A, you fail loudly.

---

## Edge behavior & defaults
- **Renaming indices/FKs**: you can infer new names deterministically (e.g., people_email_key). If teams really want name continuity, you can later add indexNameWas/fkNameWas keys, but not needed for MVP.
- **Dropping**: defaults to forbidden; `@hint(drop: true)` is the explicit opt-in. You may also support a global CLI `--allow-drop` for dev only.
- **NOT NULL without backfill**:
  - If B has a default value, planner can backfill using that by default.
  - If no default, require notNullBackfill hint (good ergonomics).
- **Multiple renames to the same target** → fail with a targeted message.

---

## Tooling notes
- **PSL emitter**:
  - Keep your current AST walk; detect `@hint` attributes and build a Hints object alongside contract.json.
  - Exclude `@hint` from the contract's JSON; or include it under a reserved key that the hasher explicitly ignores.
  - TypeScript types (sketch):

```typescript
type HintCommon = { for?: `sha256:${string}`; notes?: string };
type ModelHint = HintCommon & { was?: string; drop?: boolean };
type FieldHint = HintCommon & {
  was?: string;
  drop?: boolean;
  castTo?: ColumnType;
  using?: string;
  notNullBackfill?: { kind: 'literal'|'now'; value?: string };
};

type Hints = {
  models: Record<string /*modelB*/, ModelHint>;
  fields: Record<string /*modelB.fieldB*/, FieldHint>;
};
```

- **Planner**:
  - Load Hints.
  - Build rename maps:
    - renameTables[Aname] = Bname when model B @hint(was:Aname).
    - renameColumns[table][Acol] = Bcol when field B @hint(was:Acol).
  - Apply maps, then diff.

---

## A few end-to-end examples

### 1) Pure rename

```prisma
@hint(was: "users")
model People { id Int @id }
```

→ ops:

```json
[{ "kind":"renameTable", "from":"users", "to":"people" }]
```

### 2) Tighten nullability with backfill

```prisma
model People {
  active Boolean? @hint(notNullBackfill: { kind: "literal", value: "false" })
}
```

→ ops:

```json
[
  { "kind":"backfill", "table":"people", "column":"active", "value":{"kind":"literal","value":"false"} },
  { "kind":"alterColumn", "table":"people", "column":"active", "alter":[{"setNotNull":true}] }
]
```

### 3) Cast with USING

```prisma
model Orders {
  total String @hint(castTo: "float8", using: "total::double precision")
}
```

→ ops:

```json
[{ "kind":"alterColumn", "table":"orders", "column":"total",
   "alter":[{ "setType":"float8", "using":"total::double precision" }] }]
```

### 4) Safe drop

```prisma
model People {
  legacy_id Int? @hint(drop: true)
}
```

→ ops:

```json
[{ "kind":"alterTable", "name":"people", "alters":[{ "kind":"dropColumn", "name":"legacy_id" }] }]
```

---

## Why this meets the UX bar
- Devs edit PSL only.
- The attribute is discoverable and hard to typo (compiler validates).
- Determinism & safety are preserved (hints excluded from contract hash; included in op-hash context).
- Hints are transient—they can stay, or you can clean them up; either way they don't pollute runtime mapping.
