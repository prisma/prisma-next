# Prisma ORM Demo

Minimal Prisma ORM example app with simple read and write queries. This app demonstrates both Prisma Client (Prisma 7) and Prisma Next compatibility layer side-by-side.

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Set up your database connection:
   - Create a `.env` file in the root of this directory
   - Add your PostgreSQL connection string: `DATABASE_URL=postgresql://user:pass@localhost:5432/prisma_orm_demo?schema=public`

3. Generate Prisma Client and run migrations:
   ```bash
   pnpm prisma:generate
   pnpm prisma:migrate:dev
   ```

4. (Optional) Stamp the Prisma Next contract marker:
   ```bash
   pnpm stamp-marker
   ```

5. Seed the database:
   ```bash
   pnpm seed
   ```

## Usage

Read a user by ID:
```bash
pnpm start -- read <user-id>
```

Create a new user:
```bash
pnpm start -- create <email> <name>
```

## Example

```bash
# Create a user
pnpm start -- create alice@example.com "Alice"

# Read a user (use the ID from create output)
pnpm start -- read clxxxxxxxxxxxxx
```

## Switching Between Prisma ORM and Prisma Next

This demo is set up to easily switch between using Prisma Client (Prisma 7) and the Prisma Next compatibility layer using an environment variable.

### Using Prisma Client (Prisma 7) (Default)

The default configuration uses `@prisma/client`. Simply run your commands without any special configuration:

```bash
pnpm start -- create alice@example.com "Alice"
pnpm start -- read <user-id>
```

### Using Prisma Next Compatibility Layer

To switch to Prisma Next, set the `USE_COMPAT=true` environment variable:

1. Make sure you've stamped the contract marker:
   ```bash
   pnpm stamp-marker
   ```

2. Run your queries with the compat flag:
   ```bash
   USE_COMPAT=true pnpm start -- create alice@example.com "Alice"
   USE_COMPAT=true pnpm start -- read <user-id>
   ```

Or export it in your shell session:
```bash
export USE_COMPAT=true
pnpm start -- create alice@example.com "Alice"
pnpm start -- read <user-id>
```

### How It Works

The `getPrisma()` function automatically checks the `USE_COMPAT` environment variable:
- If `USE_COMPAT` is not set or `false` - Uses Prisma Client (Prisma 7)
- If `USE_COMPAT=true` - Uses Prisma Next compatibility layer

## Architecture

- **`src/prisma/client.ts`**: Main client file - switch implementations here
- **`src/prisma/client-next.ts`**: Alternative client using Prisma Next (for reference)
- **`src/prisma-next/contract.json`**: Prisma Next contract definition matching the Prisma schema
- **`src/prisma-next/runtime.ts`**: Prisma Next runtime setup
- **`src/prisma-next/stamp-marker.ts`**: Script to stamp the contract marker in the database
- **`src/queries/`**: Query functions that work with both implementations

## Notes

- The query functions in `src/queries/` are designed to work with both Prisma Client implementations
- Both implementations support the same API surface (`findUnique`, `create`, `$disconnect`)
- The Prisma Next compatibility layer uses the same database as Prisma ORM
- The contract marker must be stamped before using Prisma Next compatibility layer
