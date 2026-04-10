# Code Review

**Branch:** `tml-2185-port-retail-store-v2-e-commerce-app-to-prisma-next-mongodb`
**Base:** `tml-2220-m1-family-migration-spi-vertical-slice-single-index-e2e`
**Specs:** [projects/mongo-example-apps/spec.md](../spec.md) (parent), [projects/mongo-example-apps/specs/retail-store-round-2.spec.md](../specs/retail-store-round-2.spec.md) (round 2)
**Plans:** [retail-store-plan.md](../plans/retail-store-plan.md) (round 1), [retail-store-round-2-plan.md](../plans/retail-store-round-2-plan.md) (round 2)
**Review range:** `tml-2220-m1-family-migration-spi-vertical-slice-single-index-e2e...HEAD` (58 commits, 216 files, ~17k lines)

---

## Summary

This branch delivers the retail-store example app through round 1 (M1–M6: contract, data access, tests, static UI) and round 2 (interactive auth, cart, checkout, orders, Tailwind UI). The data access layer is clean and well-tested. The round 2 interactive features are functional and well-structured, but have one correctness bug (add-to-cart silent failure when no cart exists) and missing auth guards on order detail routes.

**The most important output of this review is the framework limitations table** (see "Framework limitations surfaced by this example app"). The example app has **~60 type casts** forced by framework ergonomics issues — scalar codec output types that aren't `string`, `_id` output types that aren't `string`, timestamp types requiring double casts, and untyped pipeline/raw results. These are the framework's highest-priority type ergonomics issues.

## What looks solid

- **PSL contract with embedded value objects**: 8 `type` definitions properly nested inside 7 models. The contract emitter produces correct `valueObject`-kind fields and TypeScript types with nested readonly arrays.
- **Clean data access layer**: Each collection module exports focused functions, accepts `Db` via dependency injection, and delegates to the ORM or raw command surface. The `objectIdEq` helper now properly types its parameter as `string | ObjectId`.
- **Comprehensive test coverage**: 6 test files covering CRUD lifecycle, relations, update operators, aggregation, seed verification, and search/pagination.
- **Cookie-based auth flow**: Middleware, signup, logout, and the `getAuthUser()` helper are well-separated. The middleware matcher correctly excludes auth routes and static assets.
- **UI components follow established patterns**: Radix primitives with CVA variants and `cn()` for class merging — the standard shadcn approach. Consistent and readable.
- **CartProvider context with invalidation**: Simple but effective pattern for coordinating cart count across components without complex state management.
- **Search implementation**: Pipeline builder with `MongoOrExpr` + `MongoFieldFilter.of` for multi-field `$regex` is idiomatic PN and well-tested.
- **README is thorough**: Documents the interactive flow, framework gaps, project structure, and setup instructions.

## Findings

### F01 — `addToCart()` silently fails when no cart exists

**Location:** [examples/retail-store/src/data/carts.ts](examples/retail-store/src/data/carts.ts) — lines 39–56; [examples/retail-store/app/api/cart/route.ts](examples/retail-store/app/api/cart/route.ts) — lines 14–22

**Issue:** `addToCart()` uses `updateOne` with `$push`, but **without `upsert: true`**. When a new user (fresh signup, no cart document) clicks "Add to Cart", the `updateOne` matches zero documents and silently no-ops. The POST handler calls `addToCart()` directly without first creating a cart. The spec requires: "If no cart exists, it creates one via `upsertCart()`."

This is the most common path (new signup → first add to cart) and results in the item not being added, with no error feedback.

**Suggestion:** Either upsert before pushing:

```typescript
export async function POST(req: Request) {
  // ...
  await upsertCart(db, userId, []);  // ensure cart exists
  await addToCart(db, userId, body);
  // ...
}
```

Or add `upsert: true` to the raw `updateOne` in `addToCart()` with a `$setOnInsert` for the `userId` field.

### F02 — Order detail routes lack auth guards

**Location:** [examples/retail-store/app/api/orders/[id]/route.ts](examples/retail-store/app/api/orders/%5Bid%5D/route.ts) — lines 5–35

**Issue:** The GET, DELETE, and PATCH handlers don't read the auth cookie or verify that the requesting user owns the order. Any client can view, delete, or update any order by knowing its ID. This is inconsistent with the auth pattern used in `POST /api/orders`, `GET /api/orders`, and all cart routes.

**Suggestion:** Add `getAuthUserId()` and verify the order belongs to the authenticated user:

```typescript
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { id } = await params;
  const db = await getDb();
  const order = await getOrderWithUser(db, id);
  if (!order || String(order.userId) !== userId) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }
  return NextResponse.json(order);
}
```

### F03 — Checkout clears cart client-side instead of server-side

**Location:** [examples/retail-store/app/checkout/checkout-form.tsx](examples/retail-store/app/checkout/checkout-form.tsx) — lines 66–68

**Issue:** After `POST /api/orders` succeeds, the client makes a separate `DELETE /api/cart` call. If the delete fails (network error, server crash), the order exists but the cart remains full. The user sees their cart still populated and could accidentally re-order.

**Suggestion:** Move the `clearCart()` call into the `POST /api/orders` handler so order creation and cart clearing happen in one request:

```typescript
// In POST /api/orders handler:
const order = await createOrder(db, { ... });
await clearCart(db, userId);
return NextResponse.json(order, { status: 201 });
```

### F04 — FRAMEWORK: ORM scalar output types are codec wrappers, not `string` — forces ~15 `as string` casts in UI

**Location:** [examples/retail-store/app/products/[id]/page.tsx](examples/retail-store/app/products/%5Bid%5D/page.tsx) — lines 46–52; [examples/retail-store/app/cart/page.tsx](examples/retail-store/app/cart/page.tsx) — line 50; [examples/retail-store/app/checkout/page.tsx](examples/retail-store/app/checkout/page.tsx) — lines 36, 74–79; [examples/retail-store/app/orders/page.tsx](examples/retail-store/app/orders/page.tsx) — line 39; [examples/retail-store/app/orders/[id]/page.tsx](examples/retail-store/app/orders/%5Bid%5D/page.tsx) — lines 29, 74; [examples/retail-store/src/components/navbar.tsx](examples/retail-store/src/components/navbar.tsx) — line 35

**Issue:** The ORM's output types for string fields are codec wrapper types (e.g., `CodecTypes['mongo/string@1']['output']`) instead of plain `string`. Every time a value from the ORM is passed to a React component prop, used in string interpolation, or consumed by any code that expects `string`, an `as string` cast is required. There are **~15 instances** across the UI:

- `product.name as string`, `product.brand as string`, `product.code as string`, `product.price.currency as string`
- `item.productId as string`, `item.name as string`, `item.brand as string`, `item.price.currency as string`, `item.image.url as string`
- `loc.name as string`
- `entry.status as string`, `lastStatus?.status as string`
- `user.name as string`

**Root cause:** The Mongo codec type map resolves `mongo/string@1` to a codec output type that is not assignable to `string`. For a data layer meant to be consumed by application code, scalar output types should resolve to their underlying TypeScript primitives (`string`, `number`, `boolean`). If the codec type is literally `string` at runtime, the type should reflect that.

**Framework action needed:** The codec type mapping for simple scalars (`mongo/string@1`, `mongo/int@1`, `mongo/double@1`, `mongo/boolean@1`) should produce output types assignable to their TypeScript primitives. This is the single largest ergonomics issue in the example app — it forces casts at every ORM-to-UI boundary.

### F05 — FRAMEWORK: ORM `_id` output type is a codec type, not `string` — forces ~30 `as string` casts in tests

**Location:** All test files: [examples/retail-store/test/crud-lifecycle.test.ts](examples/retail-store/test/crud-lifecycle.test.ts), [examples/retail-store/test/relations.test.ts](examples/retail-store/test/relations.test.ts), [examples/retail-store/test/update-operators.test.ts](examples/retail-store/test/update-operators.test.ts) — throughout

**Issue:** The ORM returns `_id` typed as `CodecTypes['mongo/objectId@1']['output']`. Data access functions accept `string`. Every time a test creates a document and passes its `_id` to another function, it must cast: `user._id as string`, `product._id as string`, `order._id as string`. There are **~30 instances** across the test files alone.

**Root cause:** Same as F04 — the codec output type for `mongo/objectId@1` is not assignable to `string`. The data access functions accept `string` (which is correct — they call `new ObjectId(id)` internally). But the ORM returns the codec wrapper type, creating a mismatch at every call site.

**Framework action needed:** Either:
- Make the ObjectId codec output type be `string` (the serialized form), or
- Make the `objectIdEq` helper and data access functions accept the codec output type directly, or
- Provide a typed `id()` accessor on ORM results that returns `string`

### F06 — FRAMEWORK: Timestamp codec output type is incompatible with `Date` — forces double cast `as unknown as string`

**Location:** [examples/retail-store/app/orders/[id]/page.tsx](examples/retail-store/app/orders/%5Bid%5D/page.tsx) — line 82

**Issue:** `entry.timestamp as unknown as string` is a **double cast** — `as unknown` then `as string`. This is the most aggressive form of type assertion and completely opts out of the type system. The timestamp field's codec output type is neither `string` nor `Date`, so a single `as string` doesn't compile, forcing the double cast.

**Root cause:** The `mongo/dateTime@1` (or equivalent) codec output type doesn't resolve to `Date` or `string`. If the runtime value is a `Date` object, the type should be `Date`. If it's an ISO string, it should be `string`.

**Framework action needed:** The datetime codec output type must resolve to a type that is usable without casting — either `Date` (if that's what the runtime returns) or `string`.

### F07 — FRAMEWORK: Runtime `execute()` yields `unknown` — pipeline/raw results are untyped

**Location:** [examples/retail-store/src/data/execute-raw.ts](examples/retail-store/src/data/execute-raw.ts) — line 13; [examples/retail-store/src/data/events.ts](examples/retail-store/src/data/events.ts) — line 33

**Issue:** The runtime's `execute()` async iterator yields `unknown`. Every pipeline or raw command result must be cast: `row as T` in `collectResults<T>()`, `row as { _id: string; count: number }` in `aggregateEventsByType()`. The type parameter on `collectResults<T>` is purely cosmetic — there is no runtime or compile-time verification that the documents match `T`.

**Root cause:** The runtime execution layer doesn't propagate the query plan's expected result type through the async iterator. For ORM queries this isn't an issue (the ORM has its own typed accessors), but for pipelines and raw commands, the consumer gets `unknown`.

**Framework action needed:** Either:
- Parameterize the pipeline builder's `build()` output with a result type that carries through to `execute()`, or
- Provide a typed `collectAs<T>()` utility that at least documents the cast is happening at the framework boundary rather than in user code, or
- Add Arktype-based runtime validation at the consumption site (the framework could expose a `parseResults(plan, schema)` helper)

### F08 — Dead code in checkout page

**Location:** [examples/retail-store/app/checkout/page.tsx](examples/retail-store/app/checkout/page.tsx) — lines 83–90

**Issue:** The "Your cart is empty" block can never render. Line 26 redirects to `/cart` when `items.length === 0`, so control never reaches line 83.

**Suggestion:** Remove the dead block.

### F09 — `CartProvider` uses `useState` initializer with side effects

**Location:** [examples/retail-store/src/components/cart-provider.tsx](examples/retail-store/src/components/cart-provider.tsx) — lines 24–29

**Issue:** The `useState` initializer calls `fetchCount()` which fires a network request. In React strict mode (development), initializer functions can be called twice, triggering duplicate fetches. While harmless, this is an anti-pattern.

**Suggestion:** Move the initial fetch into a `useEffect`:

```typescript
const [count, setCount] = useState(0);
useEffect(() => { fetchCount(setCount); }, []);
```

### F10 — Fabricated image URL in AddToCartButton

**Location:** [examples/retail-store/src/components/add-to-cart-button.tsx](examples/retail-store/src/components/add-to-cart-button.tsx) — line 33

**Issue:** The image URL is constructed as `/images/products/${product.code.toLowerCase()}.jpg`. No such images exist in the `public/` directory or anywhere in the project. The URLs will 404 if any component tries to render them.

**Suggestion:** Use the `image.url` from the product's contract data, or a placeholder.

### F11 — Raw command filters use bare `ObjectId` while ORM filters use `MongoParamRef`

**Location:** [examples/retail-store/src/data/carts.ts](examples/retail-store/src/data/carts.ts) — lines 53, 61; [examples/retail-store/src/data/orders.ts](examples/retail-store/src/data/orders.ts) — line 55

**Issue:** The ORM filter path wraps ObjectId values in `MongoParamRef` (via `objectIdEq`), but the raw command path passes bare `ObjectId` instances directly. Both work at runtime, but the inconsistency could confuse readers. The existing comment on `addToCart()` explains the difference.

**Suggestion:** Consider a helper like `rawIdFilter(field, id)` to parallel `objectIdEq` if more raw commands are added.

### F12 — FRAMEWORK: `findSimilarProducts` uses raw aggregate because pipeline builder lacks `$vectorSearch`

**Location:** [examples/retail-store/src/data/products.ts](examples/retail-store/src/data/products.ts) — lines 50–70

**Issue:** The plan specified pipeline builder with `$vectorSearch`, but the implementation uses `db.raw.collection('products').aggregate(...)`. The comment explains this is Atlas-specific and not in the pipeline builder. The raw aggregate is entirely untyped.

**Framework action needed:** Add `$vectorSearch` stage support to the pipeline builder (likely as an extension pack stage, given it's Atlas-specific).

### F13 — No migration artifacts committed (plan M1 gap)

**Location:** `examples/retail-store/` — no `migrations/` directory

**Issue:** The plan's M1 tasks include committing an initial migration. The `package.json` has scripts but no artifacts exist.

**Suggestion:** Run `prisma-next migration plan` and commit, or document the deferral.

## Framework limitations surfaced by this example app

This is a consolidated list of every framework issue that forced a cast, workaround, or compromise in the retail store. These are the primary value output of this example — they show exactly where the framework's type story breaks down for real application code.

| ID | Issue | Impact | Occurrences |
|---|---|---|---|
| F04 | Scalar codec output types are not assignable to `string`/`number` | `as string` at every ORM-to-UI boundary | ~15 in UI, ~15 in seed |
| F05 | `_id` codec output type not assignable to `string` | `as string` at every ID handoff | ~30 in tests |
| F06 | Timestamp codec output type not assignable to `Date` or `string` | `as unknown as string` double cast | 1 (but egregious) |
| F07 | `runtime.execute()` yields `unknown` for pipeline/raw results | `row as T` cast at every pipeline/raw call site | 3 |
| F11 | Raw commands require `MongoParamRef` for ORM filters but not for raw filters | Two different ObjectId wrapping patterns | 3 raw commands |
| F12 | Pipeline builder lacks `$vectorSearch` stage | Forced to use untyped raw aggregate | 1 |
| F13 | Mongo migration planner only handles index create/drop — no collection creation, validators, or other schema ops. Depends on F16 for any operations at all. | `migration:plan` produces zero operations; can't demonstrate contract→migration workflow | — |
| F14 | TypeScript DSL authoring not available for Mongo | Can't author contract in both PSL and TS DSL | — |
| F15 | 1:N back-relation loading not available or not tested | `include()` only tested N:1 | — |
| F16 | `@unique`/`@@index` not supported in Mongo PSL | No indexes in schema; blocks F13 | — |
| F17 | Change stream support not available | Can't demonstrate real-time order updates | — |
| F18 | ORM doesn't expose typed `$push`/`$pull` array operators | Forced to use untyped `mongoRaw` | 3 data access functions |

## Deferred (out of scope)

### F19 — No API-level tests for interactive flows

**Issue:** The round 2 interactive features (auth, cart add/remove, checkout, order status updates) lack integration tests at the API route level. The data access functions are tested, but the route handlers' auth checks, error responses, and composition logic are not.

**Why deferred:** Adding HTTP-level route tests would expand the test infrastructure significantly. The data access layer tests cover the critical paths.

## Already addressed (from prior review rounds)

| Finding | Resolution | Commit |
|---|---|---|
| F01 (prev) — `objectIdEq` parameter type `string \| unknown` | Changed to `string \| ObjectId` with proper `instanceof` check | `bf5f2ae6a` |
| F02 (prev) — `as string` casts in seed.ts | Still present but is a framework ergonomics issue, not a code issue | — |
| F03 (prev) — API routes don't guard against empty `DEMO_USER_ID` | `DEMO_USER_ID` removed entirely; replaced with cookie-based auth | `e86008d90` |
| F08 (prev) — `biome.jsonc` extends `"//"` | — | — |
| F10 (prev) — `for await` pattern for draining raw commands | Extracted into `executeRaw()` helper | Round 1 code review fixes commit |
| F11 (prev) — `scripts/seed.ts` uses `node:fs` | Simplified — `DEMO_USER_ID` auto-write logic removed | `66c7311bd` |
| Auto-provisioned `DEMO_USER_ID` | Entire mechanism replaced by signup flow | `582e213fb`, `e86008d90` |

## Acceptance-criteria traceability

### Parent spec (round 1)

| Acceptance Criterion | Status | Implementation | Evidence |
|---|---|---|---|
| Contract authored in PSL | **Met** | [examples/retail-store/prisma/contract.prisma](examples/retail-store/prisma/contract.prisma) | 7 models + 8 value object types |
| Contract emits valid `contract.json` and `contract.d.ts` | **Met** | [examples/retail-store/src/contract.json](examples/retail-store/src/contract.json), [examples/retail-store/src/contract.d.ts](examples/retail-store/src/contract.d.ts) | Value objects correctly represented |
| All CRUD operations use PN ORM | **Met** | [examples/retail-store/src/data/](examples/retail-store/src/data/) | `create`, `createAll`, `update`, `delete`, `upsert`, `findMany`, `include` |
| Embedded documents appear inline in results | **Met** | [examples/retail-store/test/crud-lifecycle.test.ts](examples/retail-store/test/crud-lifecycle.test.ts) | Asserts `product.price`, `order.items[0]`, `user.address` |
| Referenced relations load via `$lookup` | **Met** | [examples/retail-store/test/relations.test.ts](examples/retail-store/test/relations.test.ts) | 3 relation tests |
| At least one mutation uses update operators | **Met** | [examples/retail-store/test/update-operators.test.ts](examples/retail-store/test/update-operators.test.ts) | `$push`/`$pull` for cart + orders |
| Data access layer runs against mongodb-memory-server | **Met** | [examples/retail-store/test/setup.ts](examples/retail-store/test/setup.ts) | MongoMemoryReplSet |
| At least 3 distinct MongoDB idioms demonstrated | **Met** | Embedded docs, relations, `$push`/`$pull`, aggregation, upsert, `$regex` search | 6+ idioms |
| Schema migrations create correct collections/indexes | **Not met** | — | Migration planner only handles indexes (F13) and PSL lacks index support (F16); `migration:plan` produces zero operations |
| TypeScript DSL contract authoring | **Not met** | — | Framework gap (F14) |
| Change stream subscription | **Not met** | — | Framework gap (F17) |

### Round 2 spec

| Acceptance Criterion | Status | Implementation | Evidence |
|---|---|---|---|
| Unauthenticated visitors redirected to login | **Met** | [examples/retail-store/middleware.ts](examples/retail-store/middleware.ts) | Middleware checks `userId` cookie |
| Sign Up creates user + sets auth cookie | **Met** | [examples/retail-store/app/api/auth/signup/route.ts](examples/retail-store/app/api/auth/signup/route.ts) | Creates user via ORM, sets `httpOnly` cookie |
| Auth cookie persists across page navigations | **Met** | Cookie has `maxAge: 30 days`, `path: /` | Manual verification |
| Navbar displays authenticated user's name | **Met** | [examples/retail-store/src/components/navbar.tsx](examples/retail-store/src/components/navbar.tsx) | Server component reads `getAuthUser()` |
| Log out clears cookie + redirects | **Met** | [examples/retail-store/app/api/auth/logout/route.ts](examples/retail-store/app/api/auth/logout/route.ts), [examples/retail-store/src/components/navbar-client.tsx](examples/retail-store/src/components/navbar-client.tsx) | Deletes cookie, client redirects |
| Product catalog paginates | **Met** | [examples/retail-store/app/page.tsx](examples/retail-store/app/page.tsx), [examples/retail-store/src/data/products.ts](examples/retail-store/src/data/products.ts) | `findProductsPaginated()` with skip/take; [examples/retail-store/test/search.test.ts](examples/retail-store/test/search.test.ts) |
| Search bar filters products | **Met** | [examples/retail-store/src/data/products.ts](examples/retail-store/src/data/products.ts) | `searchProducts()` with `$regex` via pipeline; [examples/retail-store/test/search.test.ts](examples/retail-store/test/search.test.ts) |
| Product detail shows "Add to Cart" | **Met** | [examples/retail-store/app/products/[id]/page.tsx](examples/retail-store/app/products/%5Bid%5D/page.tsx) | `AddToCartButton` component |
| Add to Cart upserts cart + adds item | **Not met** | [examples/retail-store/src/data/carts.ts](examples/retail-store/src/data/carts.ts) | F01: `addToCart()` doesn't upsert; silently fails for new users |
| Cart page shows items with prices/quantities | **Met** | [examples/retail-store/app/cart/page.tsx](examples/retail-store/app/cart/page.tsx) | Lists items with computed totals |
| Remove button removes item (`$pull`) | **Met** | [examples/retail-store/app/cart/cart-actions.tsx](examples/retail-store/app/cart/cart-actions.tsx) | Calls `DELETE /api/cart?productId=X` |
| Clear Cart empties cart | **Met** | [examples/retail-store/app/cart/cart-actions.tsx](examples/retail-store/app/cart/cart-actions.tsx) | Calls `DELETE /api/cart` |
| Navbar shows cart item count that updates | **Met** | [examples/retail-store/src/components/cart-badge.tsx](examples/retail-store/src/components/cart-badge.tsx), [examples/retail-store/src/components/cart-provider.tsx](examples/retail-store/src/components/cart-provider.tsx) | `CartProvider` + `invalidateCart()` |
| Checkout shows order summary | **Met** | [examples/retail-store/app/checkout/page.tsx](examples/retail-store/app/checkout/page.tsx) | Items list with totals |
| Shipping address entry | **Met** | [examples/retail-store/app/checkout/checkout-form.tsx](examples/retail-store/app/checkout/checkout-form.tsx) | Text input pre-filled from user's address |
| Home delivery vs BOPIS selection | **Met** | [examples/retail-store/app/checkout/checkout-form.tsx](examples/retail-store/app/checkout/checkout-form.tsx) | Radio group with conditional UI |
| BOPIS store dropdown populated from DB | **Met** | [examples/retail-store/app/checkout/page.tsx](examples/retail-store/app/checkout/page.tsx) | `findLocations()` populates Select |
| Place Order creates order + clears cart | **Partial** | [examples/retail-store/app/api/orders/route.ts](examples/retail-store/app/api/orders/route.ts) | Order created correctly; cart cleared client-side (F03 — fragile) |
| Orders page lists user's orders | **Met** | [examples/retail-store/app/orders/page.tsx](examples/retail-store/app/orders/page.tsx) | `getUserOrders()` by auth user |
| Order detail shows items/address/status/total | **Met** | [examples/retail-store/app/orders/[id]/page.tsx](examples/retail-store/app/orders/%5Bid%5D/page.tsx) | Full order details with status history |
| Status update button (`$push` statusHistory) | **Met** | [examples/retail-store/app/orders/[id]/order-status-buttons.tsx](examples/retail-store/app/orders/%5Bid%5D/order-status-buttons.tsx) | placed → shipped → delivered progression |
| All order pages use auth user, not env var | **Met** | — | No `DEMO_USER_ID` references remain |
| All mutations via PN data access layer | **Met** | — | No raw MongoDB driver calls in routes/components |
| Existing integration tests pass | **Assumed** | — | Not verified in this review |
| New search test | **Met** | [examples/retail-store/test/search.test.ts](examples/retail-store/test/search.test.ts) | 7 tests for search + pagination |
