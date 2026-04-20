# Retail Store Round 2 — Interactive E-Commerce

## Summary

Make the retail-store example app interactive so a user can sign up, browse and search products, manage a cart, check out, and view orders — all backed by the PN data access layer. This builds on the contract, data access layer, and integration tests delivered in round 1. The result is a working e-commerce demo where every user action exercises a distinct PN Mongo capability (ORM CRUD, `$push`/`$pull`, `$regex` search, upsert, aggregation).

**Spec:** `projects/mongo-example-apps/specs/retail-store-round-2.spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Agent / Engineer | Drives execution |
| Reviewer | Will | Architectural review, UX feedback |

---

## Milestones

### Milestone 1: Foundation — UI library, auth stub, expanded seed data

Set up shadcn/ui, implement the login stub with cookie-based auth, expand the seed data, and replace the existing inline-style pages with library components. After this milestone, the app has a working auth flow and a polished but still read-only product catalog.

**Tasks:**

- [ ] Install and configure shadcn/ui (Tailwind CSS, cn utility, base components: Button, Card, Input, Badge, Select, DropdownMenu, Dialog, Separator, Skeleton)
- [ ] Replace `app/globals.css` inline reset with Tailwind base styles
- [ ] Implement auth middleware: Next.js middleware that checks for a `userId` cookie; redirects unauthenticated requests to `/login` (except `/login` and `/api/auth/*` routes)
- [ ] Create `/login` page with "Sign Up" button — calls `POST /api/auth/signup` which creates a user via `orm.users.create()` with a generated name (e.g. "User-{shortId}"), sets a `userId` cookie, and redirects to `/`
- [ ] Create `POST /api/auth/signup` API route
- [ ] Create `POST /api/auth/logout` API route — clears the `userId` cookie, redirects to `/login`
- [ ] Create a shared `getAuthUser()` server helper that reads the `userId` cookie via `cookies()`, fetches the user via `findUserById()`, and returns null if not found (used by all server components)
- [ ] Rebuild navbar as a server component using shadcn: show user name from `getAuthUser()`, cart item count (placeholder 0 for now), nav links (Products, Cart, Orders), and a Log Out dropdown item
- [ ] Expand seed data to ~24 products across 4+ categories (Apparel/Topwear, Apparel/Bottomwear, Accessories/Bags, Footwear/Shoes) and 5+ brands. Add 3+ store locations. Keep 2 users for test purposes but the demo flow creates its own users via signup.
- [ ] Rebuild product catalog page (`app/page.tsx`) with shadcn Card components in a grid layout
- [ ] Rebuild product detail page (`app/products/[id]/page.tsx`) with shadcn components (no "Add to Cart" yet — that's M2)
- [ ] Add pagination to the product catalog: extend `findProducts()` with `skip`/`limit` parameters, add Previous/Next controls using shadcn Button
- [ ] Add product search: create `searchProducts(query)` data access function using a pipeline with `$match` + `$regex` (case-insensitive match on `name`, `brand`, `articleType`); add a search Input to the catalog page that submits as a query parameter; catalog page filters results via the search function when a query is present
- [ ] Write integration test for `searchProducts()`: seed products, search by partial name, verify filtered results
- [ ] Remove `DEMO_USER_ID` references from all API routes and page components — replace with `getAuthUser()` or cookie-based user resolution

**Validates:** auth acceptance criteria (AC 1–5), product browsing (AC 6–8 except "Add to Cart" button), search test (AC 21)

### Milestone 2: Cart — add to cart, manage items, navbar count

Wire up the full cart experience: add items from product pages, view/manage the cart, and show a live item count in the navbar.

**Tasks:**

- [ ] Add "Add to Cart" button to the product detail page (client component) — calls `POST /api/cart` with the product data; shows loading/success feedback via shadcn Button states and a toast or inline message
- [ ] Add "Add to Cart" button to product cards on the catalog page (small icon button on each card)
- [ ] Update `POST /api/cart` route to read `userId` from the auth cookie instead of `DEMO_USER_ID`; on POST, upsert the cart (create if none exists) then `$push` the item
- [ ] Rebuild cart page (`app/cart/page.tsx`) with shadcn components: list items with name, brand, quantity, price; "Remove" button per item; "Clear Cart" button; subtotal display; "Proceed to Checkout" link
- [ ] Wire "Remove" button to `DELETE /api/cart?productId=X` (calls `removeFromCart()`)
- [ ] Wire "Clear Cart" button to `DELETE /api/cart` with no productId (calls `clearCart()`)
- [ ] Update `DELETE /api/cart` and `GET /api/cart` routes to use the auth cookie for user ID
- [ ] Implement navbar cart count: create `GET /api/cart/count` route that returns `{ count: items.length }` for the authenticated user; navbar client component fetches this on mount and after mutations (via a simple polling interval or custom event)
- [ ] Add a `CartProvider` React context that tracks cart count and provides an `invalidateCart()` function for mutation components to call after add/remove/clear

**Validates:** cart acceptance criteria (AC 9–13)

### Milestone 3: Checkout and orders — place order, view history, update status

Complete the checkout flow and rebuild the order pages with interactive status updates.

**Tasks:**

- [ ] Create checkout page (`app/checkout/page.tsx`) with shadcn components:
  - Order summary section (items from cart, subtotal, total)
  - Shipping address field (pre-filled from user's address if available, otherwise text Input)
  - Order type radio group (Home Delivery / BOPIS) using shadcn RadioGroup
  - Conditional store location Select dropdown when BOPIS is chosen (populated from `GET /api/locations`)
  - "Place Order" Button
- [ ] Create `POST /api/orders` handler update: read user from auth cookie; accept `{ items, shippingAddress, type }` from the checkout form; call `createOrder()` with initial status `{ status: 'placed', timestamp: now }`; call `clearCart()`; return the created order
- [ ] Wire "Place Order": on success, redirect to `/orders/{id}` for the new order
- [ ] Rebuild orders list page (`app/orders/page.tsx`) with shadcn: show each order as a Card with item count, total, latest status Badge, and link to detail
- [ ] Update orders routes to use auth cookie instead of `DEMO_USER_ID`
- [ ] Rebuild order detail page (`app/orders/[id]/page.tsx`) with shadcn: items list, shipping address, status history timeline (using a vertical list with Badges), total
- [ ] Add status progression buttons to the order detail page: show the next logical status as a Button (placed → shipped → delivered). Clicking calls `PATCH /api/orders/[id]` which runs `updateOrderStatus()` (`$push` to `statusHistory`). Disable when status is `delivered`.
- [ ] Verify the order detail page loads correctly using the order ID from the URL and the auth cookie (no hardcoded env var)

**Validates:** checkout acceptance criteria (AC 14–18), order acceptance criteria (AC 19–22)

### Milestone 4: Polish and close-out

Final pass: verify all acceptance criteria, fix rough edges, update documentation.

**Tasks:**

- [ ] Run the full test suite — all existing integration tests pass
- [ ] Run typecheck — no errors
- [ ] Manually walk through the full user journey: sign up → browse → search → add to cart → checkout (home + BOPIS) → view orders → update status → log out → log back in and see persisted orders
- [ ] Verify all acceptance criteria from the spec (checklist pass)
- [ ] Fix any remaining inline-style remnants — all UI uses shadcn/Tailwind
- [ ] Update `examples/retail-store/README.md` with updated Quick Start (no more `DEMO_USER_ID`), feature table, and screenshots or description of the interactive flows
- [ ] Update the seed script: remove `DEMO_USER_ID` auto-write logic (no longer needed); seed only products, locations, and sample data — users are created via signup
- [ ] Verify data access layer constraint: all mutations go through PN data access functions, no raw MongoDB driver calls in routes or components

---

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| Unauthenticated visitors redirected to login | Manual | M1 | Middleware redirect; verify in walkthrough |
| Sign Up creates user + sets cookie | Integration | M1 | Test `orm.users.create()` path (existing seed test covers ORM create) |
| Auth cookie persists across navigations | Manual | M1 | Verify in walkthrough |
| Navbar shows user name | Manual | M1 | Verify in walkthrough |
| Log out clears cookie + redirects | Manual | M1 | Verify in walkthrough |
| Product catalog paginates | Integration | M1 | Test `findProducts(skip, limit)` with >12 seeded products |
| Search filters products | Integration | M1 | New test for `searchProducts()` with `$regex` |
| Product detail shows "Add to Cart" | Manual | M2 | Verify in walkthrough |
| Add to Cart upserts cart + adds item | Integration | M2 | Existing `upsertCart` + `addToCart` tests cover this |
| Cart page shows items | Manual | M2 | Verify in walkthrough |
| Remove button removes item (`$pull`) | Integration | M2 | Existing `removeFromCart` test covers this |
| Clear Cart empties cart | Integration | M2 | Existing `clearCart` test covers this |
| Navbar cart count updates | Manual | M2 | Verify in walkthrough |
| Checkout shows order summary | Manual | M3 | Verify in walkthrough |
| Shipping address entry | Manual | M3 | Verify in walkthrough |
| Home delivery vs BOPIS selection | Manual | M3 | Verify in walkthrough |
| BOPIS store dropdown from DB | Integration | M3 | Existing `findLocations()` test covers data path |
| Place Order creates order + clears cart | Integration | M3 | Existing `createOrder` + `clearCart` tests cover this |
| Orders page lists user's orders | Manual | M3 | Verify in walkthrough |
| Order detail shows items/address/status/total | Manual | M3 | Verify in walkthrough |
| Status update button (`$push` statusHistory) | Integration | M3 | Existing `updateOrderStatus` test covers this |
| All order pages use auth user, not env var | Manual | M3/M4 | Verify no `DEMO_USER_ID` references remain |
| All mutations via PN data access layer | Code review | M4 | Verify in close-out |
| Existing integration tests pass | CI | M4 | Run full suite |
| New search test | Integration | M1 | `searchProducts()` test |

## Open Items

1. **Search implementation**: Assumed pipeline with `$match` + `$regex`. If the pipeline builder doesn't support `$regex` in `$match`, fall back to raw command or ORM `where` with string equality. Resolve during M1 implementation.

2. **Seed data volume**: Expanding from 3 to ~24 products. The seed function's return type (`SeedResult`) may need updating if we stop seeding demo users for the app flow (users are now created via signup). Test seed still creates users for integration tests.

3. **Cart count reactivity**: The spec requires navbar cart count to update after mutations. The simplest approach is a React context with manual invalidation (components call `invalidateCart()` after mutation). More sophisticated approaches (SSE, polling) are out of scope per the spec's non-goals.

4. **Carry-forward from round 1 code review**: F01 (`objectIdEq` type) and F08 (`biome.jsonc` extends) are already fixed. F07 (no migration artifacts) is out of scope for round 2; tracked in round 1 plan.
