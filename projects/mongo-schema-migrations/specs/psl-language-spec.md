# PSL Language Specification

This document describes the Prisma Schema Language (PSL) as implemented by `@prisma-next/psl-parser`. It names every language construct, defines the grammar, and describes the current value model. This is a descriptive spec of the language as it exists today — future extensions are noted explicitly.

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
- Only double-quoted strings are supported (no single quotes at the tokenizer level, though the parser's `splitTopLevelSegments` tracks single quotes for argument parsing).
- There is no boolean literal token — `true` and `false` are `Ident` tokens.

## Document structure

A PSL document contains an ordered sequence of **top-level blocks**:

```
Document = (ModelBlock | EnumBlock | CompositeTypeBlock | TypesBlock)*
```

Unsupported top-level blocks (e.g. `datasource`, `generator`) produce diagnostics.

### Model block

```
ModelBlock = "model" Ident "{" (Field | ModelAttribute)* "}"
```

A model declares a named data entity with fields and model-level attributes.

```prisma
model User {
  id    Int    @id
  email String @unique
  @@map("users")
}
```

### Enum block

```
EnumBlock = "enum" Ident "{" (EnumValue | EnumAttribute)* "}"
```

Enum values are bare identifiers. The only supported enum attribute is `@@map`.

```prisma
enum Role {
  USER
  ADMIN
  @@map("user_role")
}
```

### Composite type block

```
CompositeTypeBlock = "type" Ident "{" (Field | ModelAttribute)* "}"
```

Structurally identical to a model block. Used for embedded/value-object types.

```prisma
type Address {
  street String
  city   String
}
```

### Types block

```
TypesBlock = "types" "{" NamedTypeDeclaration* "}"
```

A single `types` block defines named type aliases.

```prisma
types {
  Email = String
  ShortName = sql.String(length: 35)
  Embedding = pgvector.Vector(1536) @db.VarChar(191)
}
```

## Fields

```
Field = Ident TypeExpression FieldAttribute*
```

A field has a name, a type expression, and zero or more field-level attributes.

```prisma
email     String          @unique @map("email_address")
profile   Json?
tags      String[]
embedding pgvector.Vector(1536)?
```

### Type expressions

A type expression specifies the field's type, with optional modifiers:

```
TypeExpression = TypeBase ("?" | "[]")?
TypeBase       = Ident | TypeConstructorCall
```

| Form | Meaning |
|------|---------|
| `String` | Required scalar |
| `String?` | Optional (nullable) |
| `String[]` | List (array) |
| `pgvector.Vector(1536)` | Type constructor call (see below) |
| `pgvector.Vector(1536)?` | Optional type constructor |

Modifiers `?` (optional) and `[]` (list) are mutually exclusive.

### Type constructor calls

```
TypeConstructorCall = DottedIdent "(" ArgumentList ")"
DottedIdent         = Ident ("." Ident)*
```

A type constructor call is a namespaced identifier with arguments. It can appear as:
- A field type: `embedding pgvector.Vector(1536)`
- A named type declaration: `Embedding = pgvector.Vector(1536)`

## Attributes

Attributes are annotations on fields, models, enums, and named types.

### Field attributes

```
FieldAttribute = "@" DottedIdent ("(" ArgumentList ")")?
```

Prefixed with a single `@`. Attached to the field on the same line.

```prisma
id    Int    @id @default(autoincrement())
email String @unique @map("email_address")
data  Bytes  @vendor.column(length: 1536)
```

### Model attributes

```
ModelAttribute = "@@" DottedIdent ("(" ArgumentList ")")?
```

Prefixed with `@@`. Appear on their own line within a model block.

```prisma
@@map("users")
@@index([email])
@@unique([title, userId])
```

### Enum attributes

Same syntax as model attributes (`@@`). Only `@@map` is currently valid.

### Named type attributes

Same syntax as field attributes (`@`). Attached after the type expression in a `types` block.

```prisma
types {
  ShortName = sql.String(length: 35) @db.VarChar(191)
}
```

### Attribute names

Attribute names are dotted identifiers: `Ident ("." Ident)*`. Each segment can contain letters, digits, underscores, and hyphens.

| Form | Example |
|------|---------|
| Simple | `@id`, `@@map`, `@unique` |
| Namespaced | `@db.VarChar`, `@vendor.column`, `@my-pack.column` |

## Named type declarations

```
NamedTypeDeclaration = Ident "=" (TypeBase) Attribute*
```

A named type is either a simple alias or a type constructor call, optionally followed by attributes.

```prisma
types {
  Email         = String                               // simple alias
  ShortName     = sql.String(length: 35)               // constructor call
  Embedding1536 = pgvector.Vector(1536) @db.VarChar(191) // constructor + attribute
}
```

## Arguments

Arguments appear inside `(` `)` delimiters on attributes and type constructors.

```
ArgumentList = (Argument ("," Argument)*)?
Argument     = PositionalArgument | NamedArgument
PositionalArgument = Value
NamedArgument      = Ident ":" Value
```

### Values

**This is where the current language has a gap.**

The parser does not have a typed value model. All argument values — whether they look like numbers, booleans, identifiers, arrays, or object literals — are captured as **raw strings**. The parser tracks bracket/brace/paren depth and quoted strings to find argument boundaries, but it does not interpret the content.

The current value forms that the parser can *delimit* (but not type) are:

| Surface form | Example | Stored as |
|-------------|---------|-----------|
| Bare identifier | `true`, `Cascade`, `Desc` | `"true"`, `"Cascade"`, `"Desc"` |
| Number | `42`, `3.14`, `-1` | `"42"`, `"3.14"`, `"-1"` |
| Quoted string | `"hello"`, `"C:\\\\"` | `"\"hello\""`, `"\"C:\\\\\\\\\""` |
| Bracket list | `[email, name]` | `"[email, name]"` |
| Braced expression | `{ length: 35 }` | `"{ length: 35 }"` |
| Function call | `autoincrement()`, `now()` | `"autoincrement()"`, `"now()"` |
| Nested structure | `[userId(sort: Desc)]` | `"[userId(sort: Desc)]"` |

All of these are stored as `string` in the AST's `PslAttributeArgument.value` field. **Interpretation is entirely the responsibility of downstream interpreters** (e.g. the Mongo PSL interpreter calls `parseFieldList`, `parseJsonArg`, `parseBooleanArg`, `parseNumericArg`, etc.).

### Delimiter tracking

The parser tracks three levels of nesting when splitting argument values:
- `()` parentheses
- `[]` brackets
- `{}` braces

A `,` or `:` only acts as a separator at the top level (depth 0 for all three). This means complex nested structures are preserved intact:

```prisma
@@relation(fields: [userId], references: [id], onDelete: Cascade)
//         ^^^^^^^^^^^^^^    ^^^^^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^
//         named arg         named arg          named arg
//         value: "[userId]" value: "[id]"      value: "Cascade"
```

### Default values

Field defaults are a special case. The parser recognizes two forms in `@default(...)`:

| Form | AST type | Example |
|------|----------|---------|
| Function call | `PslDefaultFunctionValue` | `@default(autoincrement())`, `@default(now())` |
| Literal | `PslDefaultLiteralValue` | `@default(true)`, `@default(42)`, `@default("hello")` |

These are the **only** place where the parser produces typed values instead of raw strings.

## Comments

Line comments start with `//` and extend to the end of the line. They are stripped during parsing and do not appear in the AST.

```prisma
model User {
  id Int @id // primary key
}
```

Comments within quoted strings are not treated as comments.

## Summary of language constructs

| Construct | AST node | Context |
|-----------|----------|---------|
| Document | `PslDocumentAst` | Root |
| Model | `PslModel` | Top-level block |
| Enum | `PslEnum` | Top-level block |
| Composite type | `PslCompositeType` | Top-level block |
| Types block | `PslTypesBlock` | Top-level block (singular) |
| Named type declaration | `PslNamedTypeDeclaration` | Inside `types` block |
| Field | `PslField` | Inside model or composite type |
| Enum value | `PslEnumValue` | Inside enum |
| Attribute | `PslAttribute` | On fields, models, enums, named types |
| Type constructor call | `PslTypeConstructorCall` | Field type or named type RHS |
| Positional argument | `PslAttributePositionalArgument` | Inside attribute or constructor args |
| Named argument | `PslAttributeNamedArgument` | Inside attribute or constructor args |

## Current limitations

1. **No typed value model.** Argument values are raw strings. The parser cannot distinguish between `true` (boolean), `Cascade` (enum-like identifier), `42` (number), `[a, b]` (list), and `{ x: 1 }` (object). Downstream interpreters must parse values themselves.

2. **No scoping.** Attribute names (`@index`, `@@map`, `@db.VarChar`) are accepted by the parser without validation. The parser does not know which attributes are valid in which context, or which arguments an attribute accepts. All validation happens in interpreters.

3. **No function-call values in arguments.** Although `@default(now())` is recognized specially, general function calls like `wildcard()` or `raw("...")` inside attribute argument lists are not parsed as structured AST nodes — they're stored as raw strings (e.g. `"wildcard()"`, `"raw(\"...\")"`).

4. **Single-line constructs.** Fields and attributes must fit on one line. There is no multi-line continuation syntax.

5. **No object literal AST.** The parser tracks `{}` for delimiter balancing, so `{ status: "active" }` won't break parsing, but it's stored as a raw string with no structure.
