# Prisma ORM Demo

Minimal Prisma ORM example app with simple read and write queries. This app will later be used to test a Prisma Next compatibility layer.

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

4. Seed the database:
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

## Notes

This app provides minimal read/write functionality without relationship traversal or advanced features. The query functions are centralized in `src/queries/` to facilitate future compatibility layer integration.

