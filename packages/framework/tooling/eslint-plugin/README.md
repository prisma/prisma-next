# @prisma-next/eslint-plugin

ESLint plugin for Prisma Next query builder that provides TypeScript-powered linting and validation of query builder `build()` calls.

## Installation

```bash
npm install --save-dev @prisma-next/eslint-plugin @typescript-eslint/parser
```

## Configuration

### ESLint 9 (Flat Config)

Add to your ESLint configuration:

```js
// eslint.config.js
import prismaNext from '@prisma-next/eslint-plugin';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: '@typescript-eslint/parser',
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@prisma-next': prismaNext,
    },
    rules: {
      '@prisma-next/lint-build-call': 'error',
    },
  },
];
```

Or use the recommended flat configuration:

```js
// eslint.config.js
import prismaNext from '@prisma-next/eslint-plugin';

export default [
  prismaNext.configs['flat/recommended'],
];
```

### ESLint 8 (Legacy Configuration)

```json
{
  "plugins": ["@prisma-next"],
  "rules": {
    "@prisma-next/lint-build-call": "error"
  }
}
```

## Rules

### `lint-build-call`

Validates query builder `build()` calls using TypeScript type information to catch common issues and enforce best practices.

#### What it checks

1. **Unbounded Queries**: Detects SELECT queries without `.limit()` calls that could fetch unlimited rows
2. **Excessive Limits**: Warns when `.limit()` exceeds a configurable maximum value

#### Options

```typescript
{
  // Enforce limit() calls on SELECT queries (default: true)
  requireLimit?: boolean;
  
  // Maximum allowed limit value (default: 1000)  
  maxLimit?: number;
}
```

#### Examples

❌ **Incorrect** - Unbounded query:

```typescript
const plan = sql
  .from(userTable)
  .select({
    id: userTable.columns.id,
    email: userTable.columns.email,
  })
  .build(); // Error: unbounded query
```

✅ **Correct** - Bounded query:

```typescript
const plan = sql
  .from(userTable)
  .select({
    id: userTable.columns.id,
    email: userTable.columns.email,
  })
  .limit(100)
  .build(); // OK
```

#### Configuration Examples

**Basic usage:**
```js
{
  '@prisma-next/lint-build-call': 'error'
}
```

**Custom configuration:**
```js
{
  '@prisma-next/lint-build-call': [
    'error', 
    {
      requireLimit: true,
      maxLimit: 500,
    }
  ]
}
```

**Disable limit requirement:**
```js
{
  '@prisma-next/lint-build-call': [
    'error',
    {
      requireLimit: false
    }
  ]
}
```

## TypeScript Integration

This plugin leverages TypeScript's type checker to provide accurate analysis of query builder calls. For best results:

1. Ensure `@typescript-eslint/parser` is configured
2. Include `project` in parser options pointing to your `tsconfig.json`
3. Run ESLint on TypeScript files (`.ts`, `.tsx`)

## Contributing

This plugin is part of the Prisma Next project. See the main repository for contribution guidelines.

## License

See the main Prisma Next repository for license information.
