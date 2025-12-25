# TypeScript Testing Standards

## Overview

Comprehensive testing is essential for maintaining code quality and preventing regressions. This document defines testing standards and best practices for TypeScript projects at Prisma.

## Testing Philosophy

1. **Test behavior, not implementation** - Focus on what code does, not how it does it
2. **Write tests first when fixing bugs** - Create regression tests before fixing issues
3. **Maintain high coverage** - Aim for 80%+ coverage for new features
4. **Keep tests fast** - Fast tests encourage frequent execution
5. **Make tests readable** - Tests serve as documentation

## Test Organization

### Directory Structure

Organize tests alongside source code or in a dedicated test directory:

```
src/
├── user-service.ts
├── user-service.test.ts       # Co-located tests
└── database/
    ├── connection.ts
    └── connection.test.ts

# OR

src/
├── user-service.ts
└── database/
    └── connection.ts

test/
├── unit/
│   ├── user-service.test.ts
│   └── database/
│       └── connection.test.ts
├── integration/
│   └── api-workflow.test.ts
└── e2e/
    └── user-registration.test.ts
```

**Guideline:** Choose one approach and use it consistently across the project.

## Test Types

### Unit Tests

Test individual functions and classes in isolation:

```typescript
import { describe, it, expect } from "vitest";
import { calculateTotal, applyDiscount } from "./pricing.js";

describe("Pricing calculations", () => {
  describe("calculateTotal", () => {
    it("should sum item prices correctly", () => {
      const items = [
        { price: 10, quantity: 2 },
        { price: 5, quantity: 3 },
      ];

      const total = calculateTotal(items);

      expect(total).toBe(35);
    });

    it("should return 0 for empty cart", () => {
      expect(calculateTotal([])).toBe(0);
    });

    it("should handle decimal prices", () => {
      const items = [{ price: 10.99, quantity: 2 }];
      expect(calculateTotal(items)).toBeCloseTo(21.98);
    });
  });

  describe("applyDiscount", () => {
    it("should apply percentage discount correctly", () => {
      const result = applyDiscount(100, 0.1);
      expect(result).toBe(90);
    });

    it("should not allow negative totals", () => {
      const result = applyDiscount(100, 1.5);
      expect(result).toBe(0);
    });
  });
});
```

### Integration Tests

Test interactions between multiple components:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase, cleanupDatabase } from "./test-helpers.js";
import { UserService } from "./user-service.js";
import { EmailService } from "./email-service.js";

describe("User registration workflow", () => {
  let db: Database;
  let userService: UserService;
  let emailService: EmailService;

  beforeEach(async () => {
    db = await createTestDatabase();
    emailService = new EmailService();
    userService = new UserService(db, emailService);
  });

  afterEach(async () => {
    await cleanupDatabase(db);
  });

  it("should create user and send welcome email", async () => {
    const input = {
      email: "test@example.com",
      name: "Test User",
    };

    const user = await userService.registerUser(input);

    // Verify user was created
    expect(user.email).toBe(input.email);
    expect(user.name).toBe(input.name);

    // Verify user exists in database
    const savedUser = await db.user.findUnique({
      where: { id: user.id },
    });
    expect(savedUser).toBeTruthy();

    // Verify welcome email was sent
    expect(emailService.sentEmails).toHaveLength(1);
    expect(emailService.sentEmails[0].to).toBe(input.email);
  });
});
```

### End-to-End Tests

Test complete workflows through the public API:

```typescript
import { describe, it, expect } from "vitest";
import { createTestServer } from "./test-helpers.js";

describe("User API E2E", () => {
  it("should complete full user registration flow", async () => {
    const server = await createTestServer();

    // Create user
    const createResponse = await server.fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        name: "Test User",
      }),
    });

    expect(createResponse.status).toBe(201);
    const user = await createResponse.json();
    expect(user.id).toBeTruthy();

    // Fetch user
    const fetchResponse = await server.fetch(`/api/users/${user.id}`);
    expect(fetchResponse.status).toBe(200);

    const fetchedUser = await fetchResponse.json();
    expect(fetchedUser.email).toBe("test@example.com");
  });
});
```

## Test Structure

### AAA Pattern (Arrange, Act, Assert)

Structure tests using the Arrange-Act-Assert pattern:

```typescript
it("should create user with valid input", async () => {
  // Arrange - Set up test data and dependencies
  const input = {
    email: "test@example.com",
    name: "Test User",
  };
  const userService = new UserService(mockDb);

  // Act - Execute the code under test
  const user = await userService.createUser(input);

  // Assert - Verify the results
  expect(user.email).toBe(input.email);
  expect(user.name).toBe(input.name);
  expect(user.id).toBeTruthy();
});
```

### Descriptive Test Names

Use clear, descriptive test names that explain what is being tested:

```typescript
// ✅ Good - describes the behavior
it("should return 404 when user does not exist", async () => {});
it("should throw ValidationError for invalid email", () => {});
it("should retry failed requests up to 3 times", async () => {});

// ❌ Bad - vague or technical
it("should work", () => {});
it("test user creation", () => {});
it("handles errors", () => {});
```

## Mocking and Stubbing

### Mocking External Dependencies

Always mock external services and APIs:

```typescript
import { describe, it, expect, vi } from "vitest";
import { UserService } from "./user-service.js";

describe("UserService", () => {
  it("should fetch user from external API", async () => {
    // Mock the fetch function
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "1", name: "John" }),
    });

    global.fetch = mockFetch;

    const service = new UserService();
    const user = await service.fetchUser("1");

    expect(user.name).toBe("John");
    expect(mockFetch).toHaveBeenCalledWith("/api/users/1");
  });
});
```

### Dependency Injection for Testing

Design code to accept dependencies, making testing easier:

```typescript
// ✅ Good - dependencies injected
export class UserService {
  constructor(
    private db: Database,
    private emailService: EmailService,
  ) {}

  async createUser(input: CreateUserInput): Promise<User> {
    // Implementation
  }
}

// Easy to test with mocks
const mockDb = createMockDatabase();
const mockEmailService = createMockEmailService();
const service = new UserService(mockDb, mockEmailService);

// ❌ Bad - hard-coded dependencies
export class UserService {
  private db = new Database(); // Can't be mocked
  private emailService = new EmailService();

  async createUser(input: CreateUserInput): Promise<User> {
    // Implementation
  }
}
```

### Test Doubles

Use different types of test doubles appropriately:

```typescript
// Stub - Returns predetermined values
const stubEmailService = {
  sendEmail: () => Promise.resolve({ success: true }),
};

// Mock - Verifies interactions
const mockEmailService = {
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
};

// Usage
await service.createUser(input);
expect(mockEmailService.sendEmail).toHaveBeenCalledWith({
  to: input.email,
  subject: "Welcome",
});

// Spy - Wraps real implementation
const emailService = new EmailService();
const spy = vi.spyOn(emailService, "sendEmail");

await service.createUser(input);
expect(spy).toHaveBeenCalled();
```

## Test Coverage Requirements

### Coverage Targets

- **New features**: 80%+ coverage
- **Bug fixes**: Add regression test before fixing
- **Critical paths**: 100% coverage (authentication, payments, data integrity)
- **Public APIs**: 100% coverage of exported functions

### Measuring Coverage

```bash
# Run tests with coverage
npm test -- --coverage

# Coverage report shows:
# - Lines covered
# - Branches covered
# - Functions covered
# - Statements covered
```

### What to Test

**High Priority:**

- Business logic and algorithms
- Input validation and error handling
- Edge cases and boundary conditions
- Security-critical code paths
- Data transformations

**Lower Priority:**

- Simple getters/setters
- Trivial formatters
- Third-party library wrappers (test integration, not the library)

```typescript
// ✅ Should test - business logic
export function calculateDiscount(price: number, userLevel: string): number {
  if (userLevel === "premium") {
    return price * 0.8;
  }
  if (userLevel === "standard") {
    return price * 0.9;
  }
  return price;
}

// ✅ Should test - edge cases
export function divideNumbers(a: number, b: number): number {
  if (b === 0) {
    throw new Error("Division by zero");
  }
  return a / b;
}

// ⚠️ Low priority - trivial getter
export class User {
  getName(): string {
    return this.name;
  }
}
```

## Testing Async Code

### Async/Await in Tests

Always use async/await for asynchronous tests:

```typescript
// ✅ Good - async/await
it("should fetch user data", async () => {
  const user = await fetchUser("123");
  expect(user.name).toBe("John");
});

// ❌ Bad - callback-based (harder to read)
it("should fetch user data", (done) => {
  fetchUser("123").then((user) => {
    expect(user.name).toBe("John");
    done();
  });
});
```

### Testing Promises

```typescript
it("should reject with error for invalid input", async () => {
  await expect(createUser({ email: "invalid" })).rejects.toThrow(
    "Invalid email",
  );
});

it("should resolve with user data", async () => {
  await expect(
    createUser({ email: "test@example.com" }),
  ).resolves.toMatchObject({
    email: "test@example.com",
  });
});
```

### Testing Timeouts and Delays

```typescript
it("should timeout after 5 seconds", async () => {
  const promise = slowOperation();

  await expect(promise).rejects.toThrow("Timeout");
}, 6000); // Set test timeout higher than operation timeout
```

## Test Fixtures and Helpers

### Creating Reusable Fixtures

```typescript
// test/fixtures/users.ts
export const createTestUser = (overrides?: Partial<User>): User => ({
  id: "test-id",
  email: "test@example.com",
  name: "Test User",
  createdAt: new Date(),
  ...overrides,
});

export const createAdminUser = (): User =>
  createTestUser({
    role: "admin",
    permissions: ["read", "write", "delete"],
  });

// Usage in tests
it("should process admin users", () => {
  const admin = createAdminUser();
  const result = processUser(admin);
  expect(result.hasAdminAccess).toBe(true);
});
```

### Test Helpers

```typescript
// test/helpers/database.ts
export async function createTestDatabase(): Promise<Database> {
  const db = new Database(":memory:");
  await db.migrate();
  return db;
}

export async function cleanupDatabase(db: Database): Promise<void> {
  await db.truncateAllTables();
  await db.close();
}

export async function seedTestData(db: Database): Promise<void> {
  await db.user.createMany({
    data: [
      createTestUser({ email: "user1@example.com" }),
      createTestUser({ email: "user2@example.com" }),
    ],
  });
}
```

## Testing Best Practices

### Keep Tests Independent

```typescript
// ✅ Good - tests are independent
describe("UserService", () => {
  let service: UserService;

  beforeEach(() => {
    service = new UserService(createMockDb());
  });

  it("should create user", async () => {
    const user = await service.createUser(input);
    expect(user).toBeTruthy();
  });

  it("should delete user", async () => {
    const created = await service.createUser(input);
    await service.deleteUser(created.id);
    // ...
  });
});

// ❌ Bad - tests depend on each other
describe("UserService", () => {
  let userId: string;

  it("should create user", async () => {
    const user = await service.createUser(input);
    userId = user.id; // State shared between tests
  });

  it("should delete user", async () => {
    await service.deleteUser(userId); // Depends on previous test
  });
});
```

### Test One Thing at a Time

```typescript
// ✅ Good - focused tests
it("should validate email format", () => {
  expect(validateEmail("invalid")).toBe(false);
});

it("should accept valid email", () => {
  expect(validateEmail("test@example.com")).toBe(true);
});

// ❌ Bad - testing multiple things
it("should validate input", () => {
  expect(validateEmail("invalid")).toBe(false);
  expect(validateEmail("test@example.com")).toBe(true);
  expect(validatePhone("123")).toBe(false);
  expect(validatePhone("555-1234")).toBe(true);
});
```

### Use Meaningful Assertions

```typescript
// ✅ Good - specific assertions
expect(user.email).toBe("test@example.com");
expect(users).toHaveLength(3);
expect(response.status).toBe(201);

// ❌ Bad - vague assertions
expect(user).toBeTruthy();
expect(users.length > 0).toBe(true);
expect(response).toBeDefined();
```

### Avoid Conditional Expectations

**CRITICAL**: Never use conditional logic (`if` statements) to conditionally run `expect()` calls in test files. All expectations should execute unconditionally.

**❌ WRONG: Conditional expectations**

```typescript
it("should process user data", () => {
  const result = processUser(input);
  
  if (result.status === "success") {
    expect(result.data).toBeDefined();
    expect(result.data.email).toBe("test@example.com");
  } else {
    expect(result.error).toBeDefined();
  }
});
```

**✅ CORRECT: Split into separate tests**

```typescript
it("returns success with user data when processing succeeds", () => {
  const result = processUser(validInput);
  expect(result.status).toBe("success");
  expect(result.data).toBeDefined();
  expect(result.data.email).toBe("test@example.com");
});

it("returns error when processing fails", () => {
  const result = processUser(invalidInput);
  expect(result.status).toBe("error");
  expect(result.error).toBeDefined();
});
```

**Why?**
- Conditional expectations make tests unpredictable and harder to debug
- Each test should verify one specific behavior
- Test failures are clearer when expectations always run
- Test coverage is more accurate when all code paths are tested separately

## Pre-Commit Testing

### Always Run Tests Before Committing

```bash
# Run all tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npm test user-service.test.ts
```

**Requirements:**

- All tests must pass before committing
- Zero failing tests
- Coverage should not decrease
- No skipped tests without justification

### Never Skip Tests

```typescript
// ❌ Bad - skipping tests
it.skip("should handle edge case", () => {
  // TODO: Fix this later
});

// ✅ Good - fix or document why it's skipped
it("should handle edge case", () => {
  // Test implementation
});

// ✅ Acceptable - temporary skip with ticket
it.skip("should handle edge case - see TICKET-123", () => {
  // Will be fixed in TICKET-123
});
```

## Summary Checklist

- [ ] Tests are organized by type (unit, integration, e2e)
- [ ] All tests follow AAA pattern (Arrange, Act, Assert)
- [ ] Test names clearly describe what is being tested
- [ ] External dependencies are mocked
- [ ] Tests are independent and can run in any order
- [ ] Each test focuses on one behavior
- [ ] Async tests use async/await
- [ ] Test fixtures and helpers are reusable
- [ ] No conditional expectations (`if` statements around `expect()` calls)
- [ ] Coverage meets minimum requirements (80%+ for new features)
- [ ] All tests pass before committing
- [ ] Critical paths have 100% coverage
- [ ] Regression tests added for bug fixes
