# Summary

Make the retail-store example app interactive — a user can browse products, search, add items to a cart, check out, view orders, and see order status updates — all backed by the PN data access layer. This is the second round of development, building on the data access layer, contract, and static UI delivered in round 1 (M1–M6). The result should be a working e-commerce demo that exercises PN Mongo capabilities through real user flows, not just static data viewing.

# Description

Round 1 delivered the contract (PSL with embedded value objects), the typed data access layer (ORM CRUD, relations, `$push`/`$pull`, aggregation), integration tests, and a static Next.js UI that renders pre-seeded data. The API routes support mutations but the UI never calls them — there are no interactive elements (no "Add to Cart" button, no checkout flow, no user picker).

The original [retail-store-v2](https://github.com/mongodb-industry-solutions/retail-store-v2) is a full interactive demo with Redux state management, product search, cart management, checkout, order tracking with SSE, store locator for BOPIS, a chatbot, customer retention analytics, and guided demo "talk tracks." We don't need all of that — much of it validates external services (Dataworkz chatbot, Atlas Stream Processing, ML recommendations), not PN.

What we need is **the core e-commerce loop made interactive**: browse → search → add to cart → manage cart → check out → view orders. Each step exercises a distinct PN Mongo capability. The UI should be functional and pleasant, not a pixel-perfect port.

**Reference material:** The original repo is cloned at `wip/retail-store-v2-reference/` for reference during development.

# Requirements

## Functional Requirements

### User identity

1. **Login stub**: Unauthenticated visitors are redirected to a login page with a "Sign Up" button. Clicking it creates a new user document (via `orm.users.create()` with a generated name and empty address) and sets an auth cookie with the new user's ID. The rest of the app treats this cookie as the authenticated session — no real auth provider needed, but the app behaves like one exists.
2. **User display**: Show the authenticated user's name in the navbar. Provide a "Log out" action that clears the cookie and redirects to the login page.

### Product browsing

3. **Product catalog with pagination**: The product catalog page loads products in pages (e.g. 12 per page) with next/previous navigation. Uses the existing `findProducts()` function, extended with skip/limit support.
4. **Product search**: A search bar on the catalog page filters products by name, brand, or category. This should use the ORM's `where` clause with text matching (or a pipeline with `$regex` if ORM text filters aren't available). Atlas Search (`$search`) is a stretch goal if an Atlas cluster is available.
5. **Product detail**: Clicking a product navigates to its detail page (already exists) and shows an "Add to Cart" button.

### Cart management

6. **Add to cart**: From the product detail page (or a product card), the user can add a product to their cart. This calls the existing `addToCart()` data access function (which uses `$push`). If no cart exists, it creates one via `upsertCart()`.
7. **Cart page with item management**: The cart page shows the current user's items with quantities and prices. Each item has a "Remove" button that calls `removeFromCart()` (`$pull`). A "Clear Cart" button calls `clearCart()`.
8. **Cart item count in navbar**: The navbar shows the number of items in the current user's cart, updating after add/remove operations.

### Checkout

9. **Checkout flow**: From the cart page, a "Checkout" button navigates to a checkout page that shows:
   - Order summary (items, subtotal, total)
   - Shipping address (pre-filled from the user's address, or a simple text input)
   - Order type selector (home delivery vs. BOPIS)
   - If BOPIS: a store location picker populated from `findLocations()`
   - A "Place Order" button
10. **Place order**: Confirming the order calls `createOrder()` with the cart items, shipping info, and an initial `{ status: 'placed', timestamp: now }` status entry. Then clears the cart via `clearCart()`. Navigates to the order detail page.

### Order management

11. **Orders page**: Lists the current user's orders (existing `getUserOrders()`), showing item count, total, and latest status. Each order links to its detail page.
12. **Order detail page**: Shows order items, shipping address, status history timeline, and total. Already partially exists but needs to use the current user context instead of a hardcoded env var.
13. **Order status updates**: The order detail page has a button to simulate status progression (e.g. "Mark as Shipped", "Mark as Delivered") that calls `updateOrderStatus()` (`$push` to `statusHistory`). This exercises the `$push` update operator in an interactive context.

### Store locator

14. **Store locations for BOPIS**: During checkout, if BOPIS is selected, show a dropdown of store locations from `findLocations()`. The selected store's address becomes the shipping address.

## Non-Functional Requirements

1. **Client-side interactivity**: Interactive features use Next.js client components (`"use client"`) with `fetch` calls to the existing API routes. Server components remain for initial data loading where appropriate.
2. **UI component library**: Use an established component library (e.g. shadcn/ui, Radix, or similar) so the app looks polished out of the box without rolling custom components. Replace the existing inline-style UI from round 1 with library components.
3. **No external dependencies**: The interactive features work against `mongodb-memory-server` for tests and any MongoDB instance for the demo. No Atlas-specific features are required for the core interactive loop.
4. **Responsive layout**: The UI should look reasonable on desktop and tablet widths. Mobile is not a priority.
4. **Type safety**: All API request/response types should be derived from the contract types where possible. No `any` types.
5. **Test coverage**: Each new interactive flow should have at least one integration test proving the data access path works end-to-end (most already exist from round 1).

## Non-goals

- **Chatbot**: Validates Dataworkz, not PN. Out of scope.
- **Customer retention / CEP / Next Best Actions**: Complex event processing with Atlas Stream Processing and external microservices. Not a PN concern.
- **Personalized recommendations / ML pipeline**: External service populates `lastRecommendations` on user documents. Not a PN concern.
- **Real-time SSE / change streams**: The PN runtime doesn't yet support change streams. Deferred until the framework ships this capability. Order status updates will use polling or manual refresh instead.
- **Atlas Search (`$search`)**: Requires an extension pack not yet built. Product search will use `$regex` or ORM filters as a fallback. Atlas Search is a stretch goal.
- **Talk tracks / guided tours / demo mode**: Presentation tooling for sales demos. Not relevant to PN validation.
- **Digital receipt PDF generation / external invoice URLs**: External service concern.
- **Real authentication**: The login stub fabricates users and sets a cookie. No OAuth, JWT validation, password hashing, or session management beyond a simple cookie.
- **Redux or complex client state management**: Use simple React state or context. The original app's Redux store is overkill for what we need.

# Acceptance Criteria

## User identity

- [ ] Unauthenticated visitors are redirected to a login page
- [ ] "Sign Up" creates a new user document and sets an auth cookie
- [ ] Auth cookie persists across page navigations; server components can read it
- [ ] Navbar displays the authenticated user's name
- [ ] "Log out" clears the cookie and redirects to the login page

## Product browsing

- [ ] Product catalog paginates (at least 2 pages when >12 products are seeded)
- [ ] Search bar filters products by text match (name, brand, or category)
- [ ] Product detail page shows an "Add to Cart" button

## Cart

- [ ] "Add to Cart" creates a cart (upsert) and adds the product
- [ ] Cart page shows current user's items with prices and quantities
- [ ] "Remove" button removes a specific item (`$pull`)
- [ ] "Clear Cart" button empties the cart (`$set items: []`)
- [ ] Navbar shows cart item count that updates after mutations

## Checkout

- [ ] Checkout page shows order summary with items and total
- [ ] User can enter/confirm shipping address
- [ ] User can select home delivery or BOPIS
- [ ] BOPIS selection shows a store location dropdown populated from DB
- [ ] "Place Order" creates an order, clears the cart, and navigates to order detail

## Orders

- [ ] Orders page lists the current user's orders sorted by most recent
- [ ] Order detail page shows items, address, status history, and total
- [ ] Status update button appends a new status entry (`$push` to `statusHistory`)
- [ ] All order pages use the selected demo user, not a hardcoded env var

## Data access

- [ ] All interactive mutations go through the PN data access layer (no raw MongoDB driver calls in API routes or components)
- [ ] The existing integration tests continue to pass
- [ ] At least one new test covers the search/filter data access function

# Other Considerations

## Security

The login stub creates user documents and sets a plain-text user ID cookie. No encryption, signing, or real session management. This is a local demo app — the auth surface simulates the UX of a real app without any of the security infrastructure.

## Cost

Zero. Runs against `mongodb-memory-server` locally or any MongoDB instance the developer provides.

## Observability

Not applicable beyond standard Next.js dev server output.

## Data Protection

Not applicable — all data is synthetic demo data.

## Analytics

Not applicable.

# References

- [Original retail-store-v2](https://github.com/mongodb-industry-solutions/retail-store-v2) — source repo (cloned to `wip/retail-store-v2-reference/`)
- [Project spec](../spec.md) — parent project spec
- [Round 1 plan](../plans/retail-store-plan.md) — milestones M1–M6 (delivered)
- [Round 1 code review](../reviews/code-review.md) — findings and acceptance criteria status

# Open Questions

1. **Search implementation**: Should product search use `$regex` matching via the ORM's `where` clause, or a pipeline with `$regex` in a `$match` stage? The ORM may not support text pattern matching natively. **Assumption:** Use a pipeline with `$match` + `$regex` for search, since the pipeline builder is already used for aggregation and this exercises another PN surface. Fall back to ORM `where` with exact string filters if `$regex` isn't feasible.

2. **Seed data volume**: The current seed has 3 products, which is too few for pagination or meaningful search. Should we expand the seed to ~20–30 products? **Assumption:** Yes — expand the seed to at least 20 products across multiple categories and brands to make browsing, search, and pagination meaningful.

3. **Cart item quantity**: When adding a product that's already in the cart, should it increment the quantity or add a duplicate entry? The original app uses `$push` which adds duplicates. **Assumption:** Same as original — `$push` adds a new entry. Simplifies the implementation and matches the existing data access function.

4. **~~User persistence mechanism~~**: Resolved — cookie set by the login stub sign-up flow. Server components read it via `cookies()` for initial data loading.
