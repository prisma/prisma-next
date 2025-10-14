# @prisma/schema-emitter

Compiles PSL AST into data contract IR (`contract.json`) and generates TypeScript type definitions (`contract.d.ts`).

## Goals

- Transform PSL AST into canonical data contract IR format
- Generate TypeScript type definitions for type-safe query building
- Provide deterministic, hashable contract representations
- Enable contract verification and drift detection
- Support the contract-first architecture

## Architecture

The package consists of two main components:

- **IR Emitter**: Converts PSL AST to contract IR format
- **Types Emitter**: Generates TypeScript type definitions from IR

## Installation

```bash
# In a workspace environment
pnpm add @prisma/schema-emitter
```

## Exports

### Main Export

- `emitContract(ast: SchemaAST): Promise<Contract>` - Generates contract IR from PSL AST
- `emitSchemaAndTypes(ast: SchemaAST, namespace?: string): Promise<{ schema: string; types: string }>` - Generates both contract JSON and TypeScript types

## Usage Examples

### Basic Contract Generation

```typescript
import { parse } from '@prisma/psl';
import { emitContract } from '@prisma/schema-emitter';

const pslSource = `
model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  name  String?

  posts Post[]
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  content  String?
  authorId Int

  author User @relation(fields: [authorId], references: [id])
}
`;

const ast = parse(pslSource);
const contract = await emitContract(ast);

console.log(contract.contractHash); // "sha256:abc123..."
console.log(Object.keys(contract.tables)); // ["user", "post"]
```

### Generating Both Contract and Types

```typescript
import { parse } from '@prisma/psl';
import { emitSchemaAndTypes } from '@prisma/schema-emitter';

const ast = parse(pslSource);
const { schema, types } = await emitSchemaAndTypes(ast, 'MyApp');

// schema is JSON string of contract IR
const contractIR = JSON.parse(schema);

// types is TypeScript type definitions
console.log(types);
// Output:
// declare namespace MyApp {
//   interface User {
//     id: number;
//     email: string;
//     name: string | null;
//   }
//   interface Post {
//     id: number;
//     title: string;
//     content: string | null;
//     authorId: number;
//   }
// }
```

### CLI Integration

```typescript
import { parse } from '@prisma/psl';
import { emitSchemaAndTypes } from '@prisma/schema-emitter';
import { writeFileSync, mkdirSync } from 'fs';

async function generateContract(pslFile: string, outputDir: string) {
  const pslContent = readFileSync(pslFile, 'utf-8');
  const ast = parse(pslContent);

  const { schema, types } = await emitSchemaAndTypes(ast);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(`${outputDir}/contract.json`, schema);
  writeFileSync(`${outputDir}/contract.d.ts`, types);
}
```

### Contract Structure

The emitted contract IR follows this structure:

```typescript
interface Contract {
  version: number;
  target: string;
  contractHash: string;
  tables: {
    [tableName: string]: {
      columns: {
        [columnName: string]: {
          type: string;
          pk?: boolean;
          unique?: boolean;
          nullable?: boolean;
          default?: any;
        };
      };
      foreignKeys?: Array<{
        columns: string[];
        references: {
          table: string;
          columns: string[];
        };
      }>;
      indexes?: Array<{
        columns: string[];
        unique?: boolean;
      }>;
    };
  };
}
```

## Related Packages

- **Dependencies**:
  - `@prisma/psl` - PSL AST parsing
  - `@prisma/relational-ir` - IR type definitions and validation
- **Used by**:
  - `@prisma/cli` - Code generation commands
  - `@prisma/migrate` - Contract comparison for migrations

## Design Principles

- **Contract-First**: PSL defines the data contract, not just a schema
- **Deterministic**: Same PSL input always produces same contract hash
- **Type Safety**: Generated types enable compile-time query validation
- **Composable**: Clean separation between IR generation and type generation
- **AI-Friendly**: Machine-readable contract format enables agent workflows
