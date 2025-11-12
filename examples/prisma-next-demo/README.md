# Prisma Next Demo

This example demonstrates **Prisma Next in its native form**, using the Prisma Next APIs directly without the compatibility layer.

## Purpose

This demo shows:
- Using Prisma Next's query lanes (SQL DSL, Raw SQL, etc.)
- Creating Plans and executing them via the Runtime
- Contract verification and marker management
- Native Prisma Next patterns and best practices

## Comparison

- **`prisma-next-demo`** (this example): Shows Prisma Next native APIs
- **`prisma-orm-demo`**: Shows using Prisma Next via the compatibility layer (mimics legacy Prisma Client API)

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Set up your database connection:
   - Create a `.env` file
   - Add your PostgreSQL connection string: `DATABASE_URL=postgresql://user:pass@localhost:5432/prisma_next_demo?schema=public`

3. Seed the database:
   ```bash
   pnpm seed
   ```

4. Run tests:
   ```bash
   pnpm test
   ```

## Key Files

- `src/prisma/contract.json` - Static contract definition
- `scripts/stamp-marker.ts` - Contract marker management
- `test/` - Integration tests demonstrating Prisma Next usage

