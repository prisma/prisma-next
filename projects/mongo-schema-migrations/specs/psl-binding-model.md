# PSL Binding Model

The PSL parser produces an untyped AST of blocks, members, attributes, and values. The **binding layer** sits between the parser and target-specific interpreters. It resolves identifiers, validates structure, and produces a validated AST that interpreters can consume without manual parsing.

This document defines the binding model: scopes, name resolution, block type definitions, and attribute definitions.

## Three layers

```
PSL text
  │
  ▼
┌──────────────────────┐
│  Parser (grammar)    │  Tokenize, parse blocks/members/attributes/values.
│                      │  No knowledge of what keywords or attributes mean.
│                      │  Produces untyped AST with typed values.
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Binding layer       │  Resolve identifiers against scopes.
│                      │  Validate structure against block/attribute definitions.
│                      │  Produce validated, resolved AST.
│                      │  Driven by a BindingContext provided by framework components.
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Interpreter         │  Target-specific semantics (Mongo, SQL).
│  (family-specific)   │  Receives resolved AST — no raw string parsing.
└──────────────────────┘
```

The parser is generic — it knows PSL syntax but not semantics. The binding layer is also generic — it resolves names and validates structure, but doesn't know what a "model" or "index" means. Meaning is assigned by the interpreter, which receives a clean, validated AST.

## Binding context

The binding context is the configuration that tells the binding layer what constructs are valid. It is assembled from framework component contributions — the core framework provides base block types and common attributes, and each family/extension adds its own.

```typescript
interface BindingContext {
  readonly blockTypes: ReadonlyArray<BlockTypeDefinition>;
  readonly contextDirectives: ReadonlyArray<ContextDirectiveDefinition>;
  readonly builtinTypes: ReadonlyArray<BuiltinTypeEntry>;
}
```

### Builtin types

The binding context declares what scalar type names are available in the document scope:

```typescript
interface BuiltinTypeEntry {
  readonly name: string;       // "String", "Int", "ObjectId", ...
  readonly category: "scalar"; // all builtins are scalars
}
```

The core framework provides `String`, `Int`, `Boolean`, `DateTime`, `Float`, `Decimal`, `Json`, `Bytes`, `BigInt`. Target families add their own (e.g. Mongo adds `ObjectId`).

### Block type definitions

A block type definition describes a kind of entity declaration — what keyword introduces it, what members look like, and what attributes are valid.

```typescript
interface BlockTypeDefinition {
  readonly keyword: string;
  readonly memberSchema: MemberSchema;
  readonly memberAttributes: ReadonlyArray<AttributeDefinition>;
  readonly blockAttributes: ReadonlyArray<AttributeDefinition>;
}
```

The framework registers block types. Different families can extend the same keyword's definition (e.g. both SQL and Mongo contribute block attributes to `model`).

#### Member schema

The member schema describes what members look like inside this block type:

```typescript
interface MemberSchema {
  readonly hasTypeExpression: boolean;    // fields have types; enum values don't
  readonly hasAssignment: boolean;        // types block uses `name = expr`; others don't
  readonly typeCategories: ReadonlyArray<string>;  // what categories of type names are valid
}
```

For example:
- `model`: members have type expressions, types can be scalars, models (relations), enums, composite types, or aliases
- `enum`: members have no type expression and no assignment — they're bare names
- `types` (context directive): members have assignments

### Context directive definitions

Context directives are simpler — they modify the interpretation environment rather than declaring entities:

```typescript
interface ContextDirectiveDefinition {
  readonly keyword: string;
  readonly memberSchema: MemberSchema;
  readonly memberAttributes: ReadonlyArray<AttributeDefinition>;
}
```

The `types` directive introduces type aliases into the document scope.

### Attribute definitions

An attribute definition describes a single attribute — its name, what arguments it accepts, and what functions are available within its argument scope.

```typescript
interface AttributeDefinition {
  readonly name: string;
  readonly arguments: ReadonlyArray<ArgumentDefinition>;
  readonly functions?: ReadonlyArray<FunctionDefinition>;
}

interface ArgumentDefinition {
  readonly name?: string;            // undefined = positional
  readonly type: ValueTypeConstraint;
  readonly required: boolean;
  readonly scope?: ScopeDirective;   // how to narrow the scope for this argument's values
}

interface FunctionDefinition {
  readonly name: string;
  readonly arguments: ReadonlyArray<ArgumentDefinition>;
}
```

Functions declared on an attribute are available only within that attribute's argument values. For example, `wildcard()` is scoped to `@@index`'s field list.

## Scopes and name resolution

### Core principle

The binding layer resolves identifiers by combining two inputs:

1. **What scope is active** — what names are visible at this point in the document
2. **What type is expected** — what kind of value is valid in this position

The combination narrows resolution. The binding layer doesn't need annotations telling it "this is a field reference" — it determines that from context: this position expects an identifier, and the active scope contains field names from the enclosing entity, so the identifier resolves as a field reference.

### Scope hierarchy

Scopes are nested containers of named entries. Each entry has a name and a category. Inner scopes see everything in their parent.

```
Document scope
├── String       : scalar
├── Int          : scalar
├── ObjectId     : scalar (target-provided)
├── User         : model (declared entity)
├── Post         : model (declared entity)
├── Role         : enum (declared entity)
├── Address      : compositeType (declared entity)
├── Email        : alias → String (from context directive)
│
└── Entity "User" scope (extends document scope)
    ├── id       : field(ObjectId)
    ├── email    : field(String)
    ├── role     : field(Role)
    └── posts    : field(Post[])
```

The document scope is populated from:
- Builtin types declared in the binding context
- Entity names introduced by entity declarations in the file
- Aliases introduced by context directives (e.g. `types` block)

Each entity block has its own scope extending the document scope, populated with its member names.

### How identifier resolution works

When the binding layer encounters an identifier, it looks it up in the active scope and checks whether the result is compatible with the expected type constraint:

**Field type position** — active scope: document scope, expected: type name (any category):

```prisma
model User {
  email String    // "String" found in document scope, category: scalar ✓
  role  Role      // "Role" found in document scope, category: enum ✓
  posts Post[]    // "Post" found in document scope, category: model ✓
}
```

**`@@index` field list** — active scope: narrowed to enclosing entity's members, expected: field name:

```prisma
@@index([email, name])
// "email" found in entity scope, category: field ✓
// "name" found in entity scope, category: field ✓
// "String" — found in document scope but category: scalar, not field → error
```

**Named argument value** — active scope: attribute argument scope (may include constants), expected: per argument definition:

```prisma
@@index([status], type: hashed)
// "hashed" resolved as a valid constant for this argument position
```

### Scope narrowing

Attribute argument definitions can specify a scope directive that narrows the active scope for their values. This is how `@@index` restricts its field list to field names rather than all document-scope identifiers:

```typescript
type ScopeDirective =
  | { kind: "enclosingEntity" }                  // field names of the current entity
  | { kind: "referencedEntity", via: string }    // field names of a related entity
  | { kind: "document" }                         // full document scope (default)
```

The `enclosingEntity` directive says: "for this argument, only names from the enclosing entity's member scope are visible." The binding layer doesn't know *why* — it just narrows the scope.

The `referencedEntity` directive handles the cross-entity case like `@relation(references: [id])`, where `id` must resolve against the related model's fields. The `via` field indicates which piece of context determines the target entity (e.g. the field's own type expression).

### Future: namespaced scopes

Today, the document scope is flat — all entity names live at the top level. When we add namespace support (Postgres schemas, MySQL databases), the scope hierarchy deepens:

```
Document scope
├── public (namespace)
│   ├── User  : model
│   └── Post  : model
└── analytics (namespace)
    ├── Event : model
    └── Metric : model
```

Qualified name resolution (`analytics.Event`) traverses namespace scopes. The binding layer's resolution algorithm stays the same — it just follows dotted paths through nested scopes.

## How framework components contribute

The binding context is assembled from contributions. Each framework component declares what it adds:

### Core framework

Provides the base block types and common attributes:

```
Block types:
  model   — members with type expressions, standard field/block attributes
  enum    — members are bare names, block attributes only
  type    — same member structure as model (composite types)

Context directives:
  types   — assignment members, introduces aliases into document scope

Builtin types:
  String, Int, Boolean, DateTime, Float, Decimal, Json, Bytes, BigInt

Common member attributes:
  @id         — no arguments
  @unique     — no arguments
  @map        — positional String argument
  @default    — positional Value argument, with functions: now(), autoincrement()
  @relation   — named arguments: fields (List<field ref>), references (List<related field ref>), etc.

Common block attributes:
  @@map       — positional String argument
  @@index     — positional List<field ref>, named arguments (map, etc.)
  @@unique    — positional List<field ref>, named arguments
```

### Mongo family

Extends `model` with additional block attributes and functions:

```
Additional block attributes for model:
  @@index     — extended with:
                  type: Identifier (hashed | 2dsphere | 2d)
                  sparse: Boolean
                  expireAfterSeconds: Number
                  filter: Object
                  collation: Object
                  include: List<field ref>
                  exclude: List<field ref>
                Functions: wildcard(field ref?)

  @@textIndex — positional List<field ref>, named arguments:
                  weights: Object
                  language: String
                  languageOverride: String

Additional builtin types:
  ObjectId
```

### SQL family

Extends `model` with different attributes and may add new block types:

```
Future block types:
  view    — same member structure as model

Additional block attributes for model:
  @@index — extended with: type (Hash | Gin | Gist | SpGist | Brin), etc.
```

## Example: binding `@@index` in Mongo

Given this PSL:

```prisma
model Events {
  id       ObjectId @id @map("_id")
  status   String
  tenantId String
  metadata Json

  @@index([tenantId, wildcard(metadata)], filter: { status: "active" }, sparse: true)
}
```

The binding layer processes `@@index` as follows:

1. **Locate the attribute definition** — `@@index` is a block attribute on the `model` block type. Found in the Mongo family's contribution.

2. **Resolve the first positional argument** — expected type: `List`, scope: `enclosingEntity`.
   - `tenantId` → look up in entity "Events" scope → found, category: field ✓
   - `wildcard(metadata)` → `wildcard` is a function declared on `@@index`. Resolve its argument: `metadata` → look up in entity "Events" scope → found, category: field ✓

3. **Resolve named arguments**:
   - `filter: { status: "active" }` → expected type: Object. No scope narrowing needed — object keys are not resolved as references.
   - `sparse: true` → expected type: Boolean. Value is Boolean(true) ✓

4. **Produce validated AST** — the interpreter receives:
   - fields: `[FieldRef("tenantId"), FunctionCall("wildcard", [FieldRef("metadata")])]`
   - filter: `Object({ "status": String("active") })`
   - sparse: `Boolean(true)`

The interpreter never parses raw strings. It receives typed, resolved values.

## Design decisions

### Why scopes, not reference-kind annotations

An earlier design annotated each argument definition with a `referenceKind` (e.g. `"fieldRef"`, `"typeRef"`). This was rejected because it duplicates information that's already implicit in the scope hierarchy. The binding layer determines what an identifier refers to by combining the active scope with the expected type — no additional annotations needed. This also scales better to future namespace support, where resolution rules become more complex.

### Why block types own their attributes

An earlier design had attribute definitions declare their own `target: "member" | "block"`. This was inverted — block type definitions own their attribute lists. This is more natural: a block type is the authority on what's valid within it. When registering a new block type (e.g. `view`), you specify everything about it in one place. Attributes don't need to know about the blocks they appear in.

### Why entity declarations vs context directives

An earlier design treated all top-level blocks uniformly. We split them into entity declarations (which introduce named things with identity) and context directives (which modify the interpretation environment). The `types` block is fundamentally different from `model` — it doesn't declare a domain entity, it configures type aliases. This distinction maps to familiar concepts in other languages (declarations vs imports/macros) and will accommodate future environment-modifying constructs.

### Why the parser doesn't special-case keywords

The parser could have separate AST node types for models, enums, etc. (and currently does). The target design uses a single generic block AST node where the keyword is a plain string. This means adding a new block type (e.g. `view`) requires no parser changes — just a new block type definition in the binding context. The parser's job is purely syntactic.
