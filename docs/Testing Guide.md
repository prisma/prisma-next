# Testing Guide

**Last Updated:** 2025-01-XX
**Purpose:** Guide for writing maintainable, readable tests in Prisma Next

---

## Testing Philosophy

Our testing approach is guided by four core principles:

1. **Conciseness without obscurity** - Shorter code that's still clear
2. **Separation of concerns** - Test logic separate from infrastructure
3. **Maintainability** - Easy to update when requirements change
4. **Readability** - Tests should tell a story of what they verify

These principles drive all testing decisions, from test structure to helper design.

---

## Testing Pyramid

Prisma Next follows the testing pyramid model with three layers:

### Unit Tests

**Purpose:** Test individual components in isolation

**Characteristics:**
- Fast execution (no external dependencies)
- Test single functions, classes, or modules
- Use mocks/stubs for dependencies
- Located in `**/*.test.ts` files alongside source code

**Example:**
```typescript
// packages/runtime/test/runtime.test.ts
it('creates runtime with contract and adapter', () => {
  const runtime = createRuntime({ contract, adapter });
  expect(runtime).toBeDefined();
});
```

### Integration Tests

**Purpose:** Test interactions between multiple components

**Characteristics:**
- Test real interactions between packages
- May use real database connections
- Verify end-to-end flows within the system
- Located in `**/*.integration.test.ts` files

**Why they matter:** Many system components depend on each other. Unit tests verify isolation, but integration tests prove components work together.

**Example:**
```typescript
// packages/integration-tests/test/contract-emission.test.ts
it('emits contract and executes query', async () => {
  const { contractJson, contractDts } = await emit(ir, options, sqlTargetFamilyHook);
  const contract = validateContract<Contract>(JSON.parse(contractJson));
  const runtime = createRuntime({ contract, adapter });
  const plan = sql({ contract, adapter }).from(tables.user).select({ id: t.user.id }).build();
  const results = await collectAsync(runtime.execute(plan));
  expect(results).toHaveLength(1);
});
```

### End-to-End Tests

**Purpose:** Test complete execution paths from user input to database and back

**Characteristics:**
- Test high-value execution paths
- Use real database (Postgres via dev server)
- Test complete flows: CLI → emission → validation → query building → execution
- Located in `packages/e2e-tests/test/`

**Why they matter:** E2E tests verify the entire system works together, catching integration issues that unit and integration tests might miss.

**Example:**
```typescript
// packages/e2e-tests/test/emit-and-query.test.ts
it('emits contract via CLI and executes query against real database', async () => {
  // 1. Emit contract via CLI
  await exec('pnpm --filter @prisma-next/cli emit --contract ./schema.ts --out ./contracts');

  // 2. Load and validate contract
  const contract = validateContract<Contract>(contractJson);

  // 3. Create runtime with real database
  const runtime = createRuntime({ contract, adapter });

  // 4. Build and execute query
  const plan = sql({ contract, adapter }).from(tables.user).select({ id: t.user.id }).build();
  const results = await collectAsync(runtime.execute(plan));

  // 5. Verify results match database state
  expect(results[0].id).toBeGreaterThan(0);
});
```

### Test Distribution

**Target distribution:**
- **70% Unit Tests** - Fast feedback on individual components
- **20% Integration Tests** - Verify component interactions
- **10% E2E Tests** - Verify complete execution paths

**Current state:** Many components are unit tested in isolation, but they must be integration tested together to prove they work. E2E tests cover high-value paths all the way to the database and back.

---

## DRY Test Patterns

### The Problem: Repetition

Repeated patterns in tests make them:
- Hard to maintain (changes require updates in many places)
- Hard to read (boilerplate obscures intent)
- Error-prone (copy-paste mistakes)

### The Solution: Helper Functions

Extract common patterns into helper functions with clear names and JSDoc comments.

**❌ WRONG: Repeated pattern throughout test file**

```typescript
// Repeated 20+ times throughout the file
for await (const _row of runtime.execute(mockPlan)) {
  void _row;
  break;
}
```

**✅ CORRECT: Extract to helper function with documentation**

```typescript
/**
 * Executes a plan and consumes the first row from the result iterator.
 * This helper DRYs up the common test pattern of executing a plan and breaking
 * after the first row to trigger execution without consuming all results.
 */
const executePlan = async (runtime: ReturnType<typeof createRuntime>, plan: Plan): Promise<void> => {
  for await (const _row of runtime.execute(plan)) {
    void _row;
    break;
  }
};

// Use the helper throughout tests
await executePlan(runtime, mockPlan);
```

### When to Create Helpers

**Create a helper when:**
- ✅ Same pattern appears 3+ times in a test file
- ✅ Pattern involves multiple steps (setup, execution, cleanup)
- ✅ Pattern obscures test intent with boilerplate
- ✅ Pattern is likely to change (encapsulate change in one place)

**Don't create a helper when:**
- ❌ Pattern appears only 1-2 times
- ❌ Helper would be more complex than the pattern itself
- ❌ Pattern is specific to a single test

### Helper Characteristics

Good test helpers:

**✅ Hide implementation details**
- Database connection setup
- Error handling boilerplate
- Type assertions and conversions
- Resource cleanup

**✅ Express intent clearly**
- `executePlan(runtime, plan)` vs raw iterator handling
- `createTestContract()` vs manual contract construction
- `withDevDatabase(fn)` vs manual database lifecycle

**✅ Reduce line count significantly**
- 4 lines → 1 line (75% reduction)
- 3 lines → 1 line (66% reduction)

**✅ Maintain test independence**
- Helpers don't introduce hidden state
- Each test remains self-contained
- Failures are still easy to debug

### Helper Examples from Codebase

#### Database Helpers

```typescript
// packages/runtime/test/utils.ts

/**
 * Creates a dev database instance for testing.
 * Automatically handles connection string normalization and cleanup.
 */
export async function createDevDatabase(options?: StartServerOptions): Promise<DevDatabase> {
  const server = await unstable_startServer(options);
  return {
    connectionString: normalizeConnectionString(server.database.connectionString),
    async close() {
      await server.close();
    },
  };
}

/**
 * Executes a function with a dev database, automatically cleaning up afterward.
 */
export async function withDevDatabase<T>(
  fn: (ctx: DevDatabase) => Promise<T>,
  options?: StartServerOptions,
): Promise<T> {
  const database = await createDevDatabase(options);
  try {
    return await fn(database);
  } finally {
    await database.close();
  }
}

/**
 * Executes a function with a database client, automatically cleaning up afterward.
 */
export async function withClient<T>(
  connectionString: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
```

#### Iterator Helpers

```typescript
/**
 * Drains an async iterable, consuming all values without collecting them.
 * Useful for testing side effects without memory overhead.
 */
export async function drainAsyncIterable<T>(iterable: AsyncIterable<T>): Promise<void> {
  for await (const _ of iterable) {
    // exhaust iterator
  }
}

/**
 * Collects all values from an async iterable into an array.
 * Useful for testing query results.
 */
export async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}
```

#### Contract Helpers

```typescript
// packages/sql-query/test/sql.test.ts

/**
 * Loads a contract from test fixtures and validates it.
 * Ensures contracts have fully qualified type IDs.
 */
function loadContract(name: string): Contract {
  const json = require(`./fixtures/${name}.json`);
  return validateContract<Contract>(json);
}

/**
 * Creates a stub adapter for testing query building.
 * Provides minimal adapter interface without full implementation.
 */
function createStubAdapter(): Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement> {
  return {
    profile: {
      target: 'postgres',
      targetFamily: 'sql',
      capabilities: {},
      codecs: createCodecRegistry(),
    },
    lower: () => ({ sql: '', params: [] }),
  };
}
```

---

## Test Structure

### File Organization

**Unit tests:** `src/**/*.test.ts` (alongside source code)
**Integration tests:** `test/**/*.integration.test.ts` or `src/**/*.integration.test.ts`
**Type tests:** `src/**/*.test-d.ts` (type-level tests using `expectTypeOf`)
**E2E tests:** `packages/e2e-tests/test/**/*.test.ts`

### Test File Structure

```typescript
// 1. Imports
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRuntime } from '../src/runtime';
import { createTestContract, executePlan } from './utils';

// 2. Test fixtures and helpers (if file-specific)
const createMockPlan = () => ({ /* ... */ });

// 3. Test suite
describe('Runtime execution', () => {
  // 4. Setup/teardown
  let runtime: ReturnType<typeof createRuntime>;

  beforeAll(() => {
    runtime = createRuntime({ contract: createTestContract(), adapter });
  });

  afterAll(async () => {
    await runtime.close();
  });

  // 5. Test cases
  it('executes plan and returns results', async () => {
    const plan = createMockPlan();
    const results = await collectAsync(runtime.execute(plan));
    expect(results).toHaveLength(1);
  });
});
```

### Test Descriptions

**✅ CORRECT: Concise, direct descriptions**

```typescript
it('creates runtime with contract and adapter');
it('executes plan and returns results');
it('handles null input');
it('throws error when contract is invalid');
```

**❌ WRONG: Verbose descriptions with "should"**

```typescript
it('should create runtime with contract and adapter');
it('should execute plan and return results');
it('should handle null input');
it('should throw error when contract is invalid');
```

**Why?** The word "should" adds no information. Test descriptions should be direct and action-oriented.

---

## Test Fixtures

### Contract Fixtures

**Location:** `test/fixtures/contract.json` + `contract.d.ts`

**Pattern:** Use fully qualified type IDs, validate with `validateContract`

```typescript
// ✅ CORRECT: Load and validate contract
import contractJson from './fixtures/contract.json' assert { type: 'json' };
import type { Contract } from './fixtures/contract.d';

const contract = validateContract<Contract>(contractJson);
```

**Why?** Contracts must have fully qualified type IDs (`pg/int4@1`, not `int4`). Validation ensures structure is correct.

### Database Fixtures

**Pattern:** Use `withDevDatabase` or `withClient` for automatic cleanup

```typescript
// ✅ CORRECT: Automatic cleanup
await withDevDatabase(async (database) => {
  const client = new Client({ connectionString: database.connectionString });
  await client.connect();
  // ... test code
});

// ✅ CORRECT: Client helper
await withClient(connectionString, async (client) => {
  // ... test code
});
```

**Why?** Automatic cleanup prevents resource leaks and test interference.

### Port Management

**Issue:** Parallel test execution causes port conflicts

**Solution:** Assign unique port ranges to each test suite

```typescript
// packages/runtime/test/codecs.integration.test.ts
database = await createDevDatabase({
  acceleratePort: 54003,
  databasePort: 54004,
  shadowDatabasePort: 54005,
});

// packages/runtime/test/budgets.integration.test.ts
database = await createDevDatabase({
  acceleratePort: 54010,  // Different range
  databasePort: 54011,
  shadowDatabasePort: 54012,
});
```

**Current port assignments:**
- `compat-prisma`: 54000-54002
- `codecs.integration.test.ts`: 54003-54005
- `budgets.integration.test.ts`: 54010-54012
- `runtime.integration.test.ts`: 53213-53215
- `marker.test.ts`: 54216-54218

**When adding new test suites:** Assign a new port range and document it here.

---

## Type Testing

### Type-Level Tests

**Purpose:** Verify TypeScript types are correct

**Location:** `**/*.test-d.ts` files

**Pattern:** Use `expectTypeOf` from Vitest

```typescript
import { expectTypeOf, test } from 'vitest';
import type { Contract } from './fixtures/contract.d';
import type { ResultType, Plan } from '@prisma-next/sql-query/types';

test('Contract types are correct', () => {
  type UserTable = Contract['storage']['tables']['user'];
  expectTypeOf<UserTable>().toHaveProperty('id');
});

test('Plan type inference works', () => {
  const plan = sql({ contract, adapter })
    .from(tables.user)
    .select({ id: t.user.id, email: t.user.email })
    .build();

  type Row = ResultType<typeof plan>;
  expectTypeOf(plan).toExtend<Plan<Row>>();
});
```

**✅ CORRECT: Use `expectTypeOf` for type assertions**

```typescript
test('Type IDs are literal types', () => {
  type TextTypeId = 'pg/text@1';
  expectTypeOf<TextTypeId>().toEqualTypeOf<'pg/text@1'>();
});
```

**❌ WRONG: Don't use manual type checks**

```typescript
// Don't do this
const _check: TextTypeId extends 'pg/text@1' ? true : false = true;
```

**Why?** `expectTypeOf` provides better error messages and integrates with Vitest's test runner.

See `.cursor/rules/vitest-expect-typeof.mdc` for detailed guidance.

---

## Testing Anti-Patterns

### Anti-Pattern 1: Copy-Paste Cascade

**Symptom:** Same code block appears 5+ times in a single test

**Example:**
```typescript
// ANTI-PATTERN: Repeated throughout test
for await (const _row of runtime.execute(plan)) {
  void _row;
  break;
}
```

**Solution:** Extract to helper function

**Impact:** One change requires updating multiple locations

### Anti-Pattern 2: Implementation Detail Exposure

**Symptom:** Tests directly manipulate internal state or implementation details

**Example:**
```typescript
// ANTI-PATTERN: Test knows about internal structure
runtime['codecRegistry'].register(codec);
```

**Solution:** Use public API or create helper that encapsulates the pattern

**Impact:** Tests become fragile when implementation changes

### Anti-Pattern 3: Pyramid of Setup

**Symptom:** More lines of setup than actual test verification

**Example:**
```typescript
// ANTI-PATTERN: 30 lines of setup for 5 lines of test
it('executes query', async () => {
  // Setup: 30 lines
  const database = await createDevDatabase({ /* ... */ });
  const client = new Client({ connectionString: database.connectionString });
  await client.connect();
  await client.query('CREATE TABLE ...');
  // ... 25 more lines

  // Actual test: 5 lines
  const plan = sql({ contract, adapter }).from(tables.user).select({ id: t.user.id }).build();
  const results = await collectAsync(runtime.execute(plan));
  expect(results).toHaveLength(1);
});
```

**Solution:** Extract setup to helper or `beforeAll`/`beforeEach`

**Impact:** Test intent gets lost in boilerplate

### Anti-Pattern 4: Error Handling Everywhere

**Symptom:** `require.NoError(t, err)` or `expect(error).toBeUndefined()` appears after every operation

**Example:**
```typescript
// ANTI-PATTERN: Error checking dominates the test
const database = await createDevDatabase();
expect(database).toBeDefined();

const client = new Client({ connectionString: database.connectionString });
const err = await client.connect();
expect(err).toBeUndefined();
```

**Solution:** Helper methods handle errors internally

**Impact:** Obscures the actual test logic

---

## Best Practices

### 1. Test Behavior, Not Implementation

**✅ CORRECT: Test what the system does**

```typescript
it('returns user by id', async () => {
  const plan = sql({ contract, adapter })
    .from(tables.user)
    .where(t.user.id.eq(param('id')))
    .select({ id: t.user.id, email: t.user.email })
    .build({ params: { id: 1 } });

  const results = await collectAsync(runtime.execute(plan));
  expect(results[0].email).toBe('user@example.com');
});
```

**❌ WRONG: Test how the system does it**

```typescript
it('calls adapter.lower with correct AST', () => {
  const lowerSpy = vi.spyOn(adapter, 'lower');
  // ... test implementation details
  expect(lowerSpy).toHaveBeenCalledWith(expect.objectContaining({ /* ... */ }));
});
```

### 2. Use Descriptive Test Names

**✅ CORRECT: Clear, specific names**

```typescript
it('returns empty array when no users match filter');
it('throws error when contract has invalid type IDs');
it('handles null values in nullable columns');
```

**❌ WRONG: Vague names**

```typescript
it('works');
it('test 1');
it('handles edge case');
```

### 3. One Assertion Per Test (When Possible)

**✅ CORRECT: Single, focused assertion**

```typescript
it('returns user by id', async () => {
  const results = await collectAsync(runtime.execute(plan));
  expect(results[0].id).toBe(1);
});
```

**When multiple assertions are needed:** Group related assertions that test a single behavior

```typescript
it('returns user with all fields', async () => {
  const results = await collectAsync(runtime.execute(plan));
  expect(results[0].id).toBe(1);
  expect(results[0].email).toBe('user@example.com');
  expect(results[0].createdAt).toBeInstanceOf(Date);
});
```

### 4. Test Edge Cases

**Important edge cases to test:**
- Empty results
- Null values in nullable columns
- Invalid inputs (contracts, plans, parameters)
- Boundary conditions (limits, offsets)
- Error conditions (database errors, validation failures)

### 5. Keep Tests Independent

**✅ CORRECT: Each test is self-contained**

```typescript
it('creates user', async () => {
  const plan = sql({ contract, adapter })
    .from(tables.user)
    .insert({ email: 'new@example.com' })
    .build();
  await executePlan(runtime, plan);
});

it('reads user', async () => {
  const plan = sql({ contract, adapter })
    .from(tables.user)
    .select({ id: t.user.id, email: t.user.email })
    .build();
  const results = await collectAsync(runtime.execute(plan));
  expect(results).toHaveLength(1);
});
```

**❌ WRONG: Tests depend on execution order**

```typescript
let userId: number;

it('creates user', async () => {
  // ... creates user
  userId = result.id;  // Shared state
});

it('reads user', async () => {
  // Depends on previous test
  expect(userId).toBeDefined();
});
```

### 6. Use Appropriate Test Level

**Unit test:** Test a single function in isolation
**Integration test:** Test multiple components working together
**E2E test:** Test complete execution path to database and back

**When in doubt:** Start with a unit test. If you need to test interactions, create an integration test. If you need to test the complete flow, create an E2E test.

---

## Running Tests

### Test Commands

```bash
# Run all tests (packages + examples)
pnpm test

# Run only package tests (exclude examples)
pnpm test:packages

# Run only example tests
pnpm test:examples

# Run tests for a specific package
pnpm --filter @prisma-next/runtime test

# Run tests in watch mode
pnpm --filter @prisma-next/runtime test --watch
```

### Coverage Commands

```bash
# Run tests with coverage for all packages (excluding examples)
pnpm test:coverage:packages

# Run tests with coverage for a specific package
pnpm --filter @prisma-next/runtime test:coverage

# Run tests with coverage for all packages (including examples)
pnpm test:coverage
```

### Type Checking Tests

```bash
# Type check all packages
pnpm typecheck:packages

# Type check a specific package
pnpm --filter @prisma-next/runtime typecheck
```

---

## Summary

**Testing Philosophy:**
- Conciseness without obscurity
- Separation of concerns
- Maintainability
- Readability

**Testing Pyramid:**
- 70% Unit Tests (fast, isolated)
- 20% Integration Tests (component interactions)
- 10% E2E Tests (complete execution paths)

**DRY Patterns:**
- Extract helpers when pattern appears 3+ times
- Helpers should hide implementation details
- Helpers should express intent clearly
- Helpers should reduce line count significantly

**Test Structure:**
- Clear file organization
- Descriptive test names (no "should")
- One assertion per test (when possible)
- Test behavior, not implementation
- Keep tests independent

**Remember:** Tests are documentation. They should tell the story of what your system does, not how it does it.

---

## Related Documentation

- **Test Descriptions:** `.cursor/rules/omit-should-in-tests.mdc`
- **Type Testing:** `.cursor/rules/vitest-expect-typeof.mdc`
- **TypeScript Patterns:** `.cursor/rules/typescript-patterns.mdc` (DRY Test Patterns section)
- **Agent Onboarding:** `AGENT_ONBOARDING.md` (Testing section)

