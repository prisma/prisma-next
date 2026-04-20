# PSL Language Specification

This document specifies the Prisma Schema Language (PSL) grammar, value model, and document structure. It describes both the current implementation in `@prisma-next/psl-parser` and the target design we are evolving toward. Sections marked **(current)** describe what exists today; sections marked **(target)** describe the design direction.

## Lexical elements

The tokenizer produces the following token kinds:

| Token kind | Pattern | Examples |
|-----------|---------|---------|
| `Ident` | Unicode letter or `_`, then letters, digits, or `-` | `email`, `my-pack`, `_id` |
| `StringLiteral` | `"` ... `"` with `\` escapes | `"hello"`, `"C:\\\\"` |
| `NumberLiteral` | Optional `-`, digits, optional `.` + digits | `42`, `-1`, `3.14` |
| `At` | `@` | `@` |
| `DoubleAt` | `@@` | `@@` |
| `LBrace` / `RBrace` | `{` / `}` | |
| `LParen` / `RParen` | `(` / `)` | |
| `LBracket` / `RBracket` | `[` / `]` | |
| `Equals` | `=` | |
| `Question` | `?` | |
| `Dot` | `.` | |
| `Comma` | `,` | |
| `Colon` | `:` | |
| `Whitespace` | Spaces and tabs (not newlines) | |
| `Newline` | `\n` or `\r\n` | |
| `Comment` | `//` to end of line | `// a comment` |
| `Invalid` | Any unrecognized character | `$`, `*`, `#` |

Key observations:
- Identifiers support Unicode letters and hyphens (`my-pack`), but not `$` or `*`.
- Only double-quoted strings are supported.
- There is no boolean literal token — `true` and `false` are `Ident` tokens distinguished by the value model (see below).

## Document structure

A PSL document contains an ordered sequence of top-level constructs. These fall into two categories:

### Entity declarations

An entity declaration introduces a named thing with identity — a data model, an enum, an embedded type, a view. It has a keyword, a name, and a body containing members and block-level attributes.

```
EntityDeclaration = Keyword Ident "{" (Member | BlockAttribute)* "}"
```

```prisma
model User {
  id    Int    @id
  email String @unique
  @@map("users")
}

enum Role {
  USER
  ADMIN
  @@map("user_role")
}

type Address {
  street String
  city   String
}
```

Entity declarations introduce a type name into the document scope. The keyword determines the entity's *category* (model, enum, compositeType, etc.), but the parser treats them uniformly — it does not assign special structure to any keyword. What members look like, what attributes are valid, and what the entity means are all determined by the binding layer (see [PSL Binding Model](psl-binding-model.md)).

### Context directives

A context directive modifies the interpretation environment. Unlike entity declarations, it does not introduce a named entity — it changes how the rest of the file is interpreted.

```
ContextDirective = Keyword "{" ... "}"
```

The `types` block is a context directive. It introduces type aliases that affect how field type expressions are resolved:

```prisma
types {
  Email = String
  ShortName = sql.String(length: 35)
}
```

Context directives are analogous to `import` or `using` in other languages. They exist to configure the interpretation context, not to declare domain entities.

### Current vs target (current)

The current parser hardcodes four block types with distinct AST nodes (`PslModel`, `PslEnum`, `PslCompositeType`, `PslTypesBlock`). The target design replaces these with a single generic block AST node, where the keyword is a plain string and the binding layer determines what's valid.

## Members

Members are the declarations inside entity blocks. A member has a name and optional components depending on the entity's kind.

```
Member = Ident TypeExpression? ("=" ValueExpression)? MemberAttribute*
```

The three observed member shapes:

| Shape | Example | Used by |
|-------|---------|---------|
| Field | `email String @unique` | model, compositeType, view |
| Value | `USER` | enum |
| Assignment | `Email = String` | types (context directive) |

These are syntactic variations of the same member grammar. A field has a name and a type expression. An enum value has only a name (implicit type, no attributes). A type alias has a name and an assignment. The parser can treat all three as members with optional components; the binding layer validates that the member shape matches what the entity's block type expects.

### Type expressions

A type expression specifies a member's type, with optional modifiers:

```
TypeExpression = TypeBase ("?" | "[]")?
TypeBase       = Ident | TypeConstructorCall
```

| Form | Meaning |
|------|---------|
| `String` | Required scalar |
| `String?` | Optional (nullable) |
| `String[]` | List (array) |
| `pgvector.Vector(1536)` | Type constructor call |
| `pgvector.Vector(1536)?` | Optional type constructor |

Modifiers `?` (optional) and `[]` (list) are mutually exclusive.

### Type constructor calls

```
TypeConstructorCall = DottedIdent "(" ArgumentList ")"
DottedIdent         = Ident ("." Ident)*
```

A type constructor call is a namespaced identifier with arguments. It appears as a field type or a named type alias RHS.

```prisma
embedding pgvector.Vector(1536)
```

## Attributes

Attributes are annotations on members and blocks. They have a prefix (`@` for member-level, `@@` for block-level), a dotted name, and an optional argument list.

```
MemberAttribute = "@" DottedIdent ("(" ArgumentList ")")?
BlockAttribute  = "@@" DottedIdent ("(" ArgumentList ")")?
```

```prisma
id    Int    @id @default(42)
email String @unique @map("email_address")
data  Bytes  @vendor.column(length: 1536)

@@map("users")
@@index(email)
@@index(title, userId)
@@unique(title, userId)
```

### Attribute names

Attribute names are dotted identifiers: `Ident ("." Ident)*`. Each segment can contain letters, digits, underscores, and hyphens.

| Form | Example |
|------|---------|
| Simple | `@id`, `@@map`, `@unique` |
| Namespaced | `@db.VarChar`, `@vendor.column`, `@my-pack.column` |

The parser does not validate attribute names — it accepts any dotted identifier. The binding layer determines which attributes are valid in which context.

## Arguments

Arguments appear inside `(` `)` delimiters on attributes and type constructors.

```
ArgumentList = (Argument ("," Argument)*)?
Argument     = PositionalArgument | NamedArgument
PositionalArgument = Value
NamedArgument      = Ident ":" Value
```

### Varargs sugar (target)

When an attribute's argument definition declares a varargs positional parameter, multiple positional arguments are collected into a list without requiring explicit `[` `]` brackets:

```prisma
// These are equivalent — the binding layer normalizes both to a list:
@@index(email, name, sparse: true)
@@index([email, name], sparse: true)
```

All positional arguments before the first named argument are collected. The grammar itself does not change — the parser already accepts multiple positional arguments. The varargs normalization happens in the binding layer based on the attribute's argument definition. See [PSL Binding Model](psl-binding-model.md) for details.

## Value model (target)

PSL has nine value types. These are the building blocks for all attribute and type constructor arguments.

### Simple values

| Type | Surface syntax | Examples |
|------|---------------|----------|
| **Boolean** | `true` \| `false` | `true`, `false` |
| **Number** | Digits, optional `-`, optional `.` | `42`, `-1`, `3.14` |
| **String** | `"..."` with `\` escapes | `"hello"`, `"en"` |
| **Identifier** | Bare word (not `true`/`false`) | `Cascade`, `Desc`, `hashed` |

### Compound values

| Type | Surface syntax | Examples |
|------|---------------|----------|
| **List** | `[` Value (`,` Value)* `]` | `[email, name]`, `[1, 2]` |
| **Object** | `{` (Ident `:` Value (`,` ...)* )? `}` | `{ status: "active" }` |
| **FunctionCall** | DottedIdent `(` ArgumentList `)` | `now()`, `wildcard(metadata)` |

### Extension values

| Type | Surface syntax | Examples |
|------|---------------|----------|
| **TypeConstructor** | DottedIdent `(` ArgumentList `)` | `pgvector.zero(1536)` |
| **TaggedLiteral** | DottedIdent `` ` `` ... `` ` `` | `` pg.sql`SELECT 1` `` |

### Grammar

```
Value           = Boolean | Number | String | Identifier
                | List | Object | FunctionCall
                | TypeConstructor | TaggedLiteral

Boolean         = "true" | "false"
Number          = "-"? Digit+ ("." Digit+)?
String          = '"' (EscapeSeq | [^"\\])* '"'
Identifier      = Ident  (where Ident ∉ { "true", "false" })
List            = "[" (Value ("," Value)*)? "]"
Object          = "{" (Ident ":" Value ("," Ident ":" Value)*)? "}"
FunctionCall    = DottedIdent "(" (Argument ("," Argument)*)? ")"
TypeConstructor = DottedIdent "(" (Argument ("," Argument)*)? ")"
TaggedLiteral   = DottedIdent "`" Body "`"
```

### FunctionCall vs TypeConstructor

`FunctionCall` and `TypeConstructor` have the same surface syntax: `Name(args)`. The parser produces them identically. The binding layer distinguishes them based on what the name resolves to in the active scope — if it resolves to a declared function, it's a `FunctionCall`; if it resolves to a type constructor, it's a `TypeConstructor`. This parallels how the same identifier `Role` could be a type name or something else depending on context.

A `FunctionCall` invokes a function declared in the binding context (e.g. `now()`, `autoincrement()`, `wildcard(metadata)`). Functions are scoped to specific attributes — `wildcard` is available in `@@index`'s field list, `now` and `autoincrement` are available in `@default`.

A `TypeConstructor` constructs a value of a non-primitive type. Where type constructor calls in type positions declare the *type* of a field (e.g. `embedding pgvector.Vector(1536)`), a `TypeConstructor` in value position constructs an *instance* of that type (e.g. `@default(pgvector.zero(1536))`). The binding layer resolves the name against available type constructors contributed by extension packs.

### TaggedLiteral

A tagged literal is an opaque, domain-specific text payload owned by an extension pack. It consists of a dotted identifier (the tag) followed by a backtick-delimited body:

```prisma
@@policy(pg.predicate`status = 'active' AND role = 'admin'`)

view ActiveUsers {
  definition pg.sql`
    SELECT id, email FROM "User" WHERE status = 'active'
  `
}
```

The tag is a qualified identifier (`pack.flavor`) that the binding layer routes to the owning pack. The body is opaque to the parser and binding layer — the pack validates and normalizes it. No interpolation is allowed (`${` is a hard error).

Tagged literals serve as an escape hatch for domain-specific sub-languages that PSL's value model cannot express natively: SQL expressions, query predicates, aggregation pipelines, policy definitions. Rather than embedding a sub-language into PSL's grammar, the tagged literal delegates ownership to the pack while preserving precise source spans for diagnostics.

Canonicalization rules, contract encoding, and the full AST node type are defined in [ADR 129 — Template-Tagged Literals for Extensions](../../docs/architecture%20docs/adrs/ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md).

### Type recursion

Values are recursive — Lists and Objects contain Values, and FunctionCall/TypeConstructor arguments are Values:

```prisma
@@index(tenantId, wildcard(metadata))
//      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//      Varargs positional arguments, normalized to List:
//        Identifier("tenantId")
//        FunctionCall("wildcard", [Identifier("metadata")])

@@index(status, filter: { age: { "$gte": 18 } })
//                       ^^^^^^^^^^^^^^^^^^^^^^^
//                       Object containing:
//                         "age" → Object { "$gte" → Number(18) }

@@policy(pg.predicate`status = 'active'`)
//       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//       TaggedLiteral(tag: "pg.predicate", body: "status = 'active'")
```

### What identifiers mean

An `Identifier` value is a bare word that isn't `true` or `false`. What it *refers to* depends on where it appears — this is determined by the binding layer, not the parser. The same identifier `email` could be:

- A type name in a field declaration: `email String` (the field name is `email`)
- A field reference in an index: `@@index([email])` (refers to the `email` field)
- A symbolic constant: `type: hashed` (a fixed domain value)

The parser produces the identifier; the binding layer resolves it against the active scope.

### Current implementation (current)

The current parser stores all argument values as raw strings. The target value model described above is not yet implemented — interpreters manually parse raw strings using `parseBooleanArg`, `parseNumericArg`, `parseFieldList`, `parseJsonArg`, etc. Additionally, the parser special-cases `@default` to produce typed `PslDefaultFunctionValue` and `PslDefaultLiteralValue` nodes for `now()`, `autoincrement()`, `true`, `42`, and `"hello"`. Under the target value model, `@default` becomes a regular attribute — function calls (`now()`, `autoincrement()`) are just `FunctionCall` values, and literals (`true`, `42`) are just `Boolean` and `Number` values. No special case is needed. `TypeConstructor` and `TaggedLiteral` are new value types not present in the current parser.

## Comments

Line comments start with `//` and extend to the end of the line. They are stripped during parsing and do not appear in the AST.

```prisma
model User {
  id Int @id // primary key
}
```

Comments within quoted strings are not treated as comments.

## Summary of language constructs

| Construct | Description | Context |
|-----------|------------|---------|
| Document | Root container | — |
| Entity declaration | Named block (`model`, `enum`, `type`, `view`, ...) | Top-level |
| Context directive | Environment modifier (`types`, future imports) | Top-level |
| Member | Named declaration within a block | Inside entity/directive |
| Type expression | Type reference with optional `?`/`[]` | Field type position |
| Type constructor call | Namespaced parameterized type | Type expression or alias RHS |
| Member attribute | `@`-prefixed annotation | On a member |
| Block attribute | `@@`-prefixed annotation | Inside an entity block |
| Positional argument | Unnamed value in an argument list | Inside `(` `)` |
| Named argument | `name: value` pair in an argument list | Inside `(` `)` |
| Value | Boolean, Number, String, Identifier, List, Object, FunctionCall, TypeConstructor, TaggedLiteral | Argument positions |
