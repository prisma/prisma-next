# @prisma/cli

Command-line interface for generating data contracts and TypeScript types from PSL files.

## Goals

- Provide CLI commands for contract generation
- Enable development workflows with file watching
- Support code generation from PSL source
- Integrate with the contract-first architecture
- Offer developer-friendly tooling

## Architecture

The package consists of a single CLI application built with Commander.js:

- **Generate Command**: Converts PSL files to contract.json and contract.d.ts
- **Dev Command**: Development mode with file watching (stub implementation)
- **PSL Integration**: Uses @prisma/psl for parsing and @prisma/schema-emitter for generation

## Installation

```bash
# In a workspace environment
pnpm add @prisma/cli
```

## Exports

### CLI Binary

- `prisma-next` - Main CLI command

## Usage Examples

### Basic Contract Generation

```bash
# Generate contract.json and contract.d.ts from PSL file
npx prisma-next generate schema.psl

# Specify custom output directory
npx prisma-next generate schema.psl --output-dir .prisma
```

### Development Mode

```bash
# Start development mode (currently runs generate once)
npx prisma-next dev schema.psl

# With custom output directory
npx prisma-next dev schema.psl --output-dir .prisma
```

### CLI Commands

#### `generate` Command

```bash
prisma-next generate <psl-file> [options]

Arguments:
  psl-file                Path to the PSL file

Options:
  -o, --output-dir <dir>  Output directory for generated files (default: ".prisma")
  -h, --help              Display help for command
```

#### `dev` Command

```bash
prisma-next dev <psl-file> [options]

Arguments:
  psl-file                Path to the PSL file

Options:
  -o, --output-dir <dir>  Output directory for generated files (default: ".prisma")
  -h, --help              Display help for command
```

### Example PSL File

```prisma
// schema.psl
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
```

### Generated Output

After running `prisma-next generate schema.psl`, you'll get:

#### `.prisma/contract.json`
```json
{
  "version": 3,
  "target": "postgres",
  "contractHash": "sha256:abc123...",
  "tables": {
    "user": {
      "columns": {
        "id": { "type": "int4", "pk": true },
        "email": { "type": "text", "unique": true },
        "name": { "type": "text", "nullable": true }
      }
    },
    "post": {
      "columns": {
        "id": { "type": "int4", "pk": true },
        "title": { "type": "text" },
        "content": { "type": "text", "nullable": true },
        "authorId": { "type": "int4" }
      },
      "foreignKeys": [{
        "columns": ["authorId"],
        "references": { "table": "user", "columns": ["id"] }
      }]
    }
  }
}
```

#### `.prisma/contract.d.ts`
```typescript
declare namespace Prisma {
  interface User {
    id: number;
    email: string;
    name: string | null;
  }

  interface Post {
    id: number;
    title: string;
    content: string | null;
    authorId: number;
  }
}
```

### Integration with Build Tools

#### Package.json Scripts

```json
{
  "scripts": {
    "generate": "prisma-next generate schema.psl",
    "dev": "prisma-next dev schema.psl",
    "build": "prisma-next generate schema.psl && npm run build:app"
  }
}
```

#### CI/CD Integration

```yaml
# .github/workflows/build.yml
- name: Generate contract
  run: npx prisma-next generate schema.psl

- name: Build application
  run: npm run build
```

### Programmatic Usage

```typescript
import { Command } from 'commander';
import { parse } from '@prisma/psl';
import { emitSchemaAndTypes } from '@prisma/schema-emitter';

// Extend CLI with custom commands
const program = new Command();

program
  .command('custom-generate')
  .argument('<psl-file>')
  .action(async (pslFile) => {
    const pslContent = readFileSync(pslFile, 'utf-8');
    const ast = parse(pslContent);
    const { schema, types } = await emitSchemaAndTypes(ast);

    // Custom processing...
    console.log('Generated contract and types');
  });
```

### Error Handling

```bash
# Invalid PSL syntax
$ prisma-next generate invalid.psl
❌ Error generating data contract: SyntaxError: Unexpected token

# Missing PSL file
$ prisma-next generate missing.psl
❌ Error generating data contract: ENOENT: no such file or directory

# Successful generation
$ prisma-next generate schema.psl
📖 Reading PSL file: schema.psl
🔍 Parsing PSL...
⚡ Generating data contract and types...
✅ Generated .prisma/contract.json
✅ Generated .prisma/contract.d.ts
🎉 Data contract generation complete!
```

### Future Enhancements

The CLI is designed to support additional commands:

```bash
# Future commands (not yet implemented)
prisma-next migrate plan     # Plan migrations
prisma-next migrate apply    # Apply migrations
prisma-next migrate status   # Check migration status
prisma-next validate        # Validate contract against database
prisma-next introspect      # Generate PSL from existing database
```

## Related Packages

- **Dependencies**:
  - `@prisma/psl` - PSL parsing
  - `@prisma/relational-ir` - IR type definitions
  - `@prisma/schema-emitter` - Contract and type generation
  - `commander` - CLI framework
- **Used by**:
  - Development workflows
  - Build pipelines
  - CI/CD systems

## Design Principles

- **Contract-First**: CLI generates contracts, not just schemas
- **Developer Experience**: Simple, intuitive commands with helpful output
- **Composable**: CLI commands can be composed in build scripts
- **Type Safety**: Generated TypeScript types enable compile-time validation
- **AI-Friendly**: Clear command structure enables agent-based tooling
- **Extensible**: Commander.js foundation supports future command additions
