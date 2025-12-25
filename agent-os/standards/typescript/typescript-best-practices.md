# TypeScript Best Practices

## Overview

This document defines TypeScript coding standards for Prisma teams. These guidelines ensure type safety, maintainability, and consistency across TypeScript projects.

## TypeScript Configuration

### Compiler Options

Always enable strict mode for maximum type safety:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

**Key Requirements:**

- **Strict mode enabled** - No implicit any, null checks, strict property initialization
- **ES2022 target** - Use modern JavaScript features
- **Consistent casing** - Enforce case-sensitive file imports

### Type Imports

Use `type` imports for type-only imports to enable proper tree-shaking and avoid runtime imports of types:

```typescript
// ✅ Good - type-only import
import type { User, UserRole } from "./types.js";
import { processUser } from "./user-service.js";

// ❌ Bad - mixing types and values unnecessarily
import { User, UserRole, processUser } from "./user.js";
```

**When to use `type` imports:**

- Importing interfaces, type aliases, or types
- When the import is only used for type annotations
- To make the distinction between runtime and compile-time imports clear

## Import Organization

### Import Grouping

Organize imports in three groups, separated by blank lines:

```typescript
// 1. External packages
import { Hono } from "hono";
import { z } from "zod";

// 2. Internal modules (shared packages)
import type { Config } from "@prisma/config";
import { logger } from "@prisma/logger";

// 3. Local modules (relative imports)
import type { Service } from "./types.js";
import { createService } from "./service-factory.js";
```

### Import Best Practices

- **Prefer named exports over default exports** - Makes refactoring easier and prevents naming inconsistencies
- **Use relative paths consistently** - Prefer `./module.js` over `./module`
- **Group by functionality** - Keep related imports together

```typescript
// ✅ Good - named exports
export function createUser() {}
export function deleteUser() {}

// ❌ Bad - default export makes refactoring harder
export default function createUser() {}
```

## Type Safety

### Avoid `any`

Never use `any` unless absolutely necessary. Use these alternatives:

```typescript
// ✅ Good - unknown for truly unknown types
function processData(data: unknown) {
  if (typeof data === "string") {
    return data.toUpperCase();
  }
}

// ✅ Good - generic types for flexibility
function identity<T>(value: T): T {
  return value;
}

// ❌ Bad - any defeats type checking
function processData(data: any) {
  return data.toUpperCase(); // Runtime error if not a string
}
```

### Type Assertions

Use type assertions sparingly and only when you have additional runtime information:

```typescript
// ✅ Good - after runtime validation
const validated = schema.parse(input);
const user = validated as User; // Safe after Zod validation

// ✅ Good - with type guard
function isUser(obj: unknown): obj is User {
  return (
    typeof obj === "object" && obj !== null && "id" in obj && "email" in obj
  );
}

if (isUser(data)) {
  console.log(data.email); // TypeScript knows it's a User
}

// ❌ Bad - blind assertion without validation
const user = input as User; // Unsafe
```

### Non-null Assertions

Avoid non-null assertions (`!`) when possible. Use optional chaining and nullish coalescing:

```typescript
// ✅ Good - optional chaining
const userName = user?.profile?.name ?? "Anonymous";

// ✅ Good - explicit null check
if (user !== null && user !== undefined) {
  console.log(user.name);
}

// ❌ Bad - non-null assertion can cause runtime errors
const userName = user!.profile!.name;
```

## Code Organization

### File Structure

```typescript
// 1. Type imports at the top
import type { Config, Options } from "./types.js";

// 2. Runtime imports
import { validateConfig } from "./validation.js";

// 3. Type definitions
interface ServiceConfig {
  timeout: number;
  retries: number;
}

// 4. Constants
const DEFAULT_TIMEOUT = 5000;

// 5. Implementation
export class Service {
  constructor(private config: ServiceConfig) {}

  async execute(): Promise<void> {
    // Implementation
  }
}

// 6. Helper functions
function isValidConfig(config: unknown): config is ServiceConfig {
  // Type guard implementation
}
```

### Module Boundaries

Keep modules focused and cohesive:

- One primary responsibility per module
- Clear public API via exports
- Internal helpers as non-exported functions
- Types in separate `types.ts` files when they're shared

## Type Definitions

### Interface vs Type

**Use interfaces for:**

- Object shapes that might be extended
- Public APIs
- Class contracts

**Use type aliases for:**

- Union types
- Intersection types
- Mapped types
- Complex type computations

```typescript
// ✅ Good - interface for extensible object shapes
interface User {
  id: string;
  email: string;
}

interface AdminUser extends User {
  permissions: string[];
}

// ✅ Good - type for unions and complex types
type Result<T> = { success: true; data: T } | { success: false; error: string };

type Nullable<T> = T | null;
```

### Avoid Type Redundancy

Don't repeat yourself with types:

```typescript
// ✅ Good - DRY with utility types
type CreateUserInput = Omit<User, "id" | "createdAt">;

type PartialUser = Partial<User>;

type ReadonlyUser = Readonly<User>;

// ❌ Bad - duplicating structure
interface CreateUserInput {
  email: string;
  name: string;
  // ... duplicating all User fields except id
}
```

## Async/Await

Always use async/await over raw promises for better readability:

```typescript
// ✅ Good - async/await
async function fetchUser(id: string): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch user: ${response.status}`);
  }
  return response.json();
}

// ❌ Bad - promise chains are harder to read
function fetchUser(id: string): Promise<User> {
  return fetch(`/api/users/${id}`).then((response) => {
    if (!response.ok) {
      throw new Error(`Failed to fetch user: ${response.status}`);
    }
    return response.json();
  });
}
```

## Validation Before Commits

Before committing TypeScript code, always run:

```bash
npm run types:check
```

**Requirements:**

- Zero TypeScript errors
- Zero TypeScript warnings
- All type checks must pass

**Never:**

- Commit code with TypeScript errors
- Use `@ts-ignore` or `@ts-expect-error` without explanation
- Suppress errors without addressing root cause

## Additional Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [TypeScript Do's and Don'ts](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)
- [TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
