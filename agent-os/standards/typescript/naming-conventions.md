# TypeScript Naming Conventions

## Overview

Consistent naming conventions improve code readability and maintainability. This document defines the naming standards for TypeScript projects at Prisma.

## File Naming

### TypeScript Files

Use **kebab-case** for all TypeScript source files:

```
✅ Good:
user-service.ts
database-connection.ts
api-router.ts
authentication-middleware.ts

❌ Bad:
UserService.ts
database_connection.ts
APIRouter.ts
authenticationMiddleware.ts
```

### Exception: Class Files with Single Export

For files that export a single class, you may use **PascalCase** to match the class name:

```
✅ Acceptable:
TenantManager.ts          # Exports TenantManager class
UserRepository.ts         # Exports UserRepository class

✅ Also Good:
tenant-manager.ts         # Exports TenantManager class
user-repository.ts        # Exports UserRepository class
```

**Guideline:** Be consistent within a project. If using PascalCase for class files, apply it consistently across all similar files.

### Type Definition Files

```
✅ Good:
types.ts                  # General types
user-types.ts            # Domain-specific types
api-types.ts             # API-related types

❌ Bad:
Types.ts
user.types.ts
api_types.ts
```

### Test Files

Match the source file name with `.test.ts` or `.spec.ts` suffix:

```
user-service.ts    →    user-service.test.ts
api-router.ts      →    api-router.spec.ts
```

## Code Naming

### Classes

Use **PascalCase** for class names:

```typescript
// ✅ Good
class UserService {}
class DatabaseConnection {}
class ApiRouter {}
class HTTPClient {}

// ❌ Bad
class userService {}
class database_connection {}
class apiRouter {}
class httpClient {}
```

### Interfaces and Types

Use **PascalCase** for interfaces and type aliases:

```typescript
// ✅ Good
interface User {}
interface UserProfile {}
type Result<T> = Success<T> | Failure;

// ❌ Bad
interface user {}
interface user_profile {}
type result<T> = Success<T> | Failure;
```

**Note:** Do not prefix interfaces with `I`:

```typescript
// ✅ Good
interface User {}

// ❌ Bad
interface IUser {}
```

### Functions and Variables

Use **camelCase** for functions, variables, and parameters:

```typescript
// ✅ Good
function createUser() {}
function fetchUserById(userId: string) {}

const userName = "John";
const isAuthenticated = true;
let retryCount = 0;

// ❌ Bad
function CreateUser() {}
function fetch_user_by_id(user_id: string) {}

const UserName = "John";
const is_authenticated = true;
let retry_count = 0;
```

### Constants

**Global constants:** Use **UPPER_SNAKE_CASE**

```typescript
// ✅ Good - module-level or exported constants
export const MAX_RETRY_COUNT = 3;
export const DEFAULT_TIMEOUT_MS = 5000;
export const API_BASE_URL = "https://api.example.com";

const DATABASE_HOST = process.env.DB_HOST;
```

**Local constants:** Use **camelCase**

```typescript
// ✅ Good - local to function or block
function processRequest() {
  const maxRetries = 3;
  const timeoutMs = 5000;
  const baseUrl = getBaseUrl();
}
```

**Guideline:** If it's a true constant (never changes, hardcoded value) at the module level, use UPPER_SNAKE_CASE. If it's a local variable that happens to be const, use camelCase.

### Enums

Use **PascalCase** for enum names and **PascalCase** for enum members:

```typescript
// ✅ Good
enum UserRole {
  Admin,
  User,
  Guest,
}

enum HttpStatus {
  Ok = 200,
  NotFound = 404,
  InternalServerError = 500,
}

// ❌ Bad
enum userRole {
  ADMIN,
  USER,
  GUEST,
}

enum HTTP_STATUS {
  ok = 200,
  not_found = 404,
}
```

**Modern alternative:** Consider using union types instead of enums:

```typescript
// ✅ Good - union type (often preferred)
type UserRole = "admin" | "user" | "guest";

const role: UserRole = "admin";
```

### Generic Type Parameters

**Single letter for simple cases:**

```typescript
function identity<T>(value: T): T {
  return value;
}

function map<T, U>(items: T[], fn: (item: T) => U): U[] {
  return items.map(fn);
}
```

**Descriptive names for complex cases:**

```typescript
function createRepository<TEntity, TKey>(
  connection: Connection,
): Repository<TEntity, TKey> {
  // Implementation
}

interface Result<TData, TError> {
  data?: TData;
  error?: TError;
}
```

### Private Class Members

Use a `private` modifier rather than underscore prefix:

```typescript
// ✅ Good
class UserService {
  private apiClient: ApiClient;
  private retryCount = 3;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }
}

// ❌ Bad
class UserService {
  private _apiClient: ApiClient;
  private _retryCount = 3;
}
```

## Specialized Naming Patterns

### Suffixes for Specific Patterns

Use descriptive suffixes for specialized classes:

```typescript
// Service layer
class UserService {}
class AuthenticationService {}

// Repositories/Data Access
class UserRepository {}
class OrderRepository {}

// Controllers/Routers
class UserController {}
class ApiRouter {}

// Middleware
class AuthenticationMiddleware {}
class LoggingMiddleware {}

// Factories
class UserFactory {}
class ConnectionFactory {}

// Managers (for stateful coordinators)
class TenantManager {}
class ConnectionManager {}

// Handlers (for event/message processing)
class WebhookHandler {}
class MessageHandler {}

// Builders (for complex object construction)
class QueryBuilder {}
class RequestBuilder {}
```

### Boolean Variables and Functions

Prefix boolean variables and functions with `is`, `has`, `can`, `should`:

```typescript
// ✅ Good
const isAuthenticated = true;
const hasPermission = checkPermission();
const canEdit = user.role === "admin";
const shouldRetry = retryCount < MAX_RETRIES;

function isValidEmail(email: string): boolean {}
function hasAccess(user: User, resource: Resource): boolean {}

// ❌ Bad
const authenticated = true;
const permission = checkPermission();
const edit = user.role === "admin";

function validateEmail(email: string): boolean {}
```

### Arrays and Collections

Use plural nouns for arrays and collections:

```typescript
// ✅ Good
const users: User[] = [];
const activeConnections: Connection[] = [];
const errorMessages: string[] = [];

// ❌ Bad
const userList: User[] = [];
const activeConnectionArray: Connection[] = [];
```

### Callback Functions

Use descriptive names with action verbs:

```typescript
// ✅ Good
function processUsers(users: User[], onComplete: () => void) {}

function fetchData(
  onSuccess: (data: Data) => void,
  onError: (error: Error) => void,
) {}

const handleClick = (event: MouseEvent) => {};

// ❌ Bad
function processUsers(users: User[], callback: () => void) {}

function fetchData(
  success: (data: Data) => void,
  error: (error: Error) => void,
) {}

const cb = (event: MouseEvent) => {};
```

## Abbreviations and Acronyms

### Common Abbreviations

Use these standard abbreviations consistently:

```typescript
// ✅ Good - consistent casing
class HTTPClient {} // Two-letter: uppercase
class ApiRouter {} // Three+ letters: PascalCase

const userId: string; // camelCase for variables
const apiKey: string;
const dbConnection: Connection;

// Configuration abbreviations
interface DBConfig {}
interface APIConfig {}
interface URLConfig {}
```

### Avoid Unclear Abbreviations

```typescript
// ✅ Good - clear and descriptive
const userCount = users.length;
const maximumRetries = 3;
const configurationOptions = {};

// ❌ Bad - unclear abbreviations
const usrCnt = users.length;
const maxRet = 3;
const cfgOpts = {};
```

## Example: Complete File

```typescript
// user-service.ts

import type { User, UserRole } from "./types.js";
import { validateEmail } from "./validation.js";

// Constants
const MAX_USERS_PER_REQUEST = 100;
const DEFAULT_USER_ROLE: UserRole = "user";

// Interface
interface CreateUserOptions {
  email: string;
  name: string;
  role?: UserRole;
}

// Class
export class UserService {
  private apiClient: ApiClient;
  private retryCount = 3;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  // Method
  async createUser(options: CreateUserOptions): Promise<User> {
    const { email, name, role = DEFAULT_USER_ROLE } = options;

    if (!validateEmail(email)) {
      throw new Error("Invalid email address");
    }

    const newUser = await this.apiClient.post("/users", {
      email,
      name,
      role,
    });

    return newUser;
  }

  // Boolean method
  private hasValidCredentials(user: User): boolean {
    return user.email !== "" && user.password !== "";
  }
}

// Helper function
function formatUserDisplayName(user: User): string {
  return `${user.name} (${user.email})`;
}
```

## Summary Checklist

- [ ] Files use kebab-case (e.g., `user-service.ts`)
- [ ] Classes use PascalCase (e.g., `UserService`)
- [ ] Functions and variables use camelCase (e.g., `createUser`)
- [ ] Global constants use UPPER_SNAKE_CASE (e.g., `MAX_RETRY_COUNT`)
- [ ] Local constants use camelCase (e.g., `maxRetries`)
- [ ] Interfaces and types use PascalCase (e.g., `User`)
- [ ] No `I` prefix for interfaces
- [ ] Boolean variables start with is/has/can/should
- [ ] Arrays use plural nouns (e.g., `users`)
- [ ] Private members use `private` modifier, not underscore prefix
- [ ] Specialized suffixes used consistently (Service, Repository, Manager, etc.)
