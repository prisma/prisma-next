# Retail Store — Prisma Next MongoDB Example

An e-commerce example application demonstrating Prisma Next's MongoDB capabilities with a Next.js frontend.

## What This Demonstrates

| Feature | Implementation |
|---|---|
| **PSL contract with embedded value objects** | 8 `type` definitions (Price, Image, Address, CartItem, etc.) nested inside 7 models |
| **ORM CRUD** | `create`, `createAll`, `update`, `delete`, `upsert` via `@prisma-next/mongo-orm` |
| **Reference relations** | `include('user')` compiles to `$lookup` for cart→user, order→user, invoice→order |
| **Array update operators** | `$push`/`$pull` via `mongoRaw` for cart items and order status history |
| **Aggregation pipelines** | `$match`→`$group`→`$sort` for event analytics, `$sample` for random products |
| **Vector search** | `findSimilarProducts` via `$vectorSearch` (requires Atlas cluster) |
| **Next.js integration** | Server-rendered pages and REST API routes backed by the data access layer |

## Quick Start (tests only — no external DB)

```bash
# 1. Build framework packages (from repo root)
pnpm build

# 2. Emit contract
pnpm emit

# 3. Run tests (uses mongodb-memory-server)
pnpm test
```

## Running with a Remote MongoDB Instance

To run the full app (UI + API) against a real MongoDB cluster:

**1. Create `.env` in `examples/retail-store/`:**

```env
DB_URL=mongodb+srv://user:pass@your-cluster.mongodb.net
MONGODB_DB=retail_store
```

**2. Seed the database:**

```bash
pnpm db:seed
```

This populates all 7 collections with sample data and automatically writes `DEMO_USER_ID` (the seeded demo user's ObjectId) into `.env`. The cart and orders pages use this to identify the logged-in user.

**3. Start the dev server:**

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to browse the product catalog, view the cart, and see order history.

### Vector Search (optional, Atlas only)

To test `findSimilarProducts`, create a vector search index named `product_embedding_index` on the `products` collection's `embedding` field in Atlas, and populate the `embedding` arrays with actual vectors (the seed data sets `embedding: null` by default).

## Domain Model

```
Products  ─── Price, Image (embedded value objects)
Users     ─── Address? (optional embedded)
Carts     ──→ User (reference relation), CartItem[] (embedded array)
Orders    ──→ User (reference relation), OrderLineItem[], StatusEntry[]
Locations ─── flat fields
Invoices  ──→ Order (reference relation), InvoiceLineItem[]
Events    ─── EventMetadata (embedded)
```

## Project Structure

```
prisma/contract.prisma    PSL schema with types and models
src/contract.json         Generated contract (machine-readable)
src/contract.d.ts         Generated types (compile-time safety)
src/db.ts                 Database factory (orm, runtime, pipeline, raw)
src/seed.ts               Seed data for all 7 collections
src/data/                 Data access layer (typed functions per collection)
test/                     Integration tests against mongodb-memory-server
app/                      Next.js App Router (pages + API routes)
```

## Framework Gaps

- **Float scalar type**: Not in default Mongo PSL scalar descriptors; added via custom `scalarTypeDescriptors` in config
- **ObjectId in filters**: `MongoFieldFilter.eq` with ObjectId values requires wrapping in `MongoParamRef` (see `src/data/object-id-filter.ts`)
- **`@unique`/`@@index`**: Not supported in Mongo PSL interpreter; migration planner only generates index operations
- **Typed `$push`/`$pull`**: ORM doesn't expose array update operators; use `mongoRaw` with untyped commands
- **Atlas Search**: Requires extension pack not yet available
- **Change Streams**: Not yet supported in the framework
