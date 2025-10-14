# @prisma/psl

PSL (Prisma Schema Language) parser and lexer for converting PSL source into an Abstract Syntax Tree (AST).

## Goals

- Parse PSL source code into a structured AST representation
- Provide type-safe access to schema elements
- Enable downstream tools to work with parsed schema data
- Support the contract-first architecture where PSL defines the application's data contract

## Architecture

The package consists of three main components:

- **Lexer**: Tokenizes PSL source into tokens
- **Parser**: Converts tokens into a structured AST
- **AST Types**: TypeScript definitions for all schema elements

## Installation

```bash
# In a workspace environment
pnpm add @prisma/psl
```

## Exports

### Main Export

- `parse(input: string): SchemaAST` - Main entry point that parses PSL source into an AST

### Sub-exports

- `@prisma/psl/parser` - Parser class for advanced usage
- `@prisma/psl/ast` - AST type definitions (SchemaAST, ModelDeclaration, FieldDeclaration, etc.)

## Usage Examples

### Basic Parsing

```typescript
import { parse } from '@prisma/psl';

const pslSource = `
model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  name  String?
}
`;

const ast = parse(pslSource);
console.log(ast.models[0].name); // "User"
```

### Working with AST Types

```typescript
import { parse, SchemaAST, ModelDeclaration } from '@prisma/psl';

function extractTableNames(ast: SchemaAST): string[] {
  return ast.models.map((model: ModelDeclaration) => model.name);
}

const ast = parse(pslSource);
const tableNames = extractTableNames(ast);
```

### Advanced Parser Usage

```typescript
import { Parser } from '@prisma/psl/parser';
import { Lexer } from '@prisma/psl';

const source = 'model User { id Int @id }';
const lexer = new Lexer(source);
const tokens = lexer.tokenize();
const parser = new Parser(tokens);
const ast = parser.parse();
```

## Related Packages

- **Dependencies**: None (foundational package)
- **Used by**:
  - `@prisma/schema-emitter` - Compiles AST to contract IR
  - `@prisma/cli` - Parses PSL files for code generation

## Design Principles

- **Contract-First**: PSL serves as the source of truth for the application's data contract
- **Type Safety**: Full TypeScript support with comprehensive AST type definitions
- **Composable**: Clean separation between lexing and parsing for flexibility
- **AI-Friendly**: Machine-readable AST enables agent-based development workflows
