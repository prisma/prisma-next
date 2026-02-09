## Setup Prisma Next in a TS app (contract → context → runtime)

### Goal state

You have a small app module (commonly `src/prisma/`) that exports:

- `executionContext` (static; safe to import anywhere)
- `tables`, `sql`, and optionally `orm` (query authoring)
- a runtime factory like `getRuntime(databaseUrl)` (dynamic; owns driver/pool lifecycle)

### Key concepts to keep straight

- **`contract.json` vs `contract.d.ts`**
  - `contract.json` is the canonical data artifact (safe to commit).
  - `contract.d.ts` preserves precise TS types for tables/codecs; use it as a **type parameter**.
- **Static descriptors vs runtime instances**
  - `createExecutionContext` uses **descriptors** (no side effects) to assemble codec + operation registries.
  - `instantiateExecutionStack` creates **instances** for runtime execution.
- **Verification**
  - Runtime compares the contract hashes to the DB marker based on `verify.mode`.

### Implementation pattern (recommended)

Create two small modules:

- `context.ts`: purely static setup (contract validation, stack descriptors, executionContext, query roots)
- `runtime.ts`: dynamic runtime creation (pool/driver, stack instantiation, plugins)

### `src/prisma/context.ts` (static)

```ts
import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import { createSqlExecutionStack } from '@prisma-next/sql-runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { orm as ormBuilder } from '@prisma-next/sql-orm-lane';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import { createExecutionContext } from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

// 1) Validate contract with the fully-typed Contract type
const contract = validateContract<Contract>(contractJson);

// 2) Compose execution stack DESCRIPTORS (target/adapter/driver/packs)
export const executionStack = createSqlExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [],
});

// 3) Build static execution context from DESCRIPTORS
export const executionContext = createExecutionContext({
  contract,
  stack: executionStack,
});

// 4) Export authoring conveniences
export const schema = schemaBuilder(executionContext);
export const tables = schema.tables;
export const sql = sqlBuilder({ context: executionContext });
export const orm = ormBuilder({ context: executionContext });
```

### `src/prisma/runtime.ts` (dynamic)

```ts
import { instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';
import { budgets, createRuntime, type Plugin, type Runtime } from '@prisma-next/sql-runtime';
import { Pool } from 'pg';
import { executionContext, executionStack } from './context';

export function getRuntime(
  databaseUrl: string,
  plugins: Plugin<typeof executionContext.contract>[] = [
    budgets({
      maxRows: 10_000,
      defaultTableRows: 10_000,
      tableRows: { user: 10_000, post: 10_000 },
      maxLatencyMs: 1_000,
    }),
  ],
): Runtime {
  const pool = new Pool({ connectionString: databaseUrl });

  const stackInstance = instantiateExecutionStack(executionStack);
  const driverDescriptor = executionStack.driver;
  if (!driverDescriptor) {
    throw new Error('Driver descriptor missing from execution stack');
  }

  const driver = driverDescriptor.create({
    connect: { pool },
    cursor: { disabled: true },
  });

  return createRuntime({
    stackInstance,
    context: executionContext,
    driver,
    verify: {
      mode: 'onFirstUse',
      requireMarker: false,
    },
    plugins,
  });
}
```

### Extension packs (common agent mistake)

If the contract requires an extension pack (e.g. pgvector), you must include its **runtime descriptor** in the stack:

```ts
import pgvectorDescriptor from '@prisma-next/extension-pgvector/runtime';

export const executionStack = createSqlExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [pgvectorDescriptor],
});
```

If you don’t, `createExecutionContext` will throw a stable failure like `RUNTIME.MISSING_EXTENSION_PACK`.

### Verification settings guidance

- **Dev**: `mode: 'onFirstUse'`, often `requireMarker: false` (iterate before stamping markers).
- **Prod**: prefer `mode: 'startup'` and `requireMarker: true` (fail fast before serving traffic).

