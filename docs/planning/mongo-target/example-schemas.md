# Example MongoDB Schemas and Query Patterns

Concrete MongoDB schemas with their Prisma Next PSL representations and the query patterns we want to support. These serve as design validation — if the PSL can't express these schemas, or the ORM can't express these queries, we've found a gap.

> **Note**: The PSL syntax for the document family is speculative. These examples drive the design of that syntax.

---

## 1. Blog platform

A blog with users, posts, and comments. Demonstrates the core embed-vs-reference decision, 1:1 and 1:N relations, tag arrays, and the most common CRUD patterns.

### MongoDB collections

**users**
```json
{
  "_id": ObjectId("..."),
  "name": "Alice",
  "email": "alice@example.com",
  "bio": "Software engineer",
  "profile": {
    "avatarUrl": "https://...",
    "website": "https://alice.dev",
    "social": {
      "twitter": "@alice",
      "github": "alice"
    }
  },
  "createdAt": ISODate("2025-01-15T00:00:00Z")
}
```

**posts**
```json
{
  "_id": ObjectId("..."),
  "title": "Why MongoDB",
  "slug": "why-mongodb",
  "content": "MongoDB is a document database...",
  "status": "published",
  "authorId": ObjectId("aaa"),
  "tags": ["mongodb", "databases", "nosql"],
  "viewCount": 1247,
  "comments": [
    {
      "authorId": ObjectId("bbb"),
      "text": "Great article!",
      "createdAt": ISODate("2025-01-16T10:30:00Z")
    },
    {
      "authorId": ObjectId("ccc"),
      "text": "Very helpful, thanks",
      "createdAt": ISODate("2025-01-16T14:15:00Z")
    }
  ],
  "publishedAt": ISODate("2025-01-15T12:00:00Z"),
  "updatedAt": ISODate("2025-01-16T09:00:00Z")
}
```

### Prisma Next PSL

```prisma
datasource db {
  provider = "mongodb"
  url      = env("MONGODB_URL")
}

model User {
  id        ObjectId  @id @default(auto()) @map("_id")
  name      String
  email     String    @unique
  bio       String?
  profile   Profile   @embedded
  posts     Post[]    @relation(references: [authorId])
  createdAt DateTime  @default(now())

  @@collection("users")
}

type Profile @embedded {
  avatarUrl String?
  website   String?
  social    SocialLinks @embedded
}

type SocialLinks @embedded {
  twitter String?
  github  String?
}

model Post {
  id          ObjectId   @id @default(auto()) @map("_id")
  title       String
  slug        String     @unique
  content     String
  status      String     @default("draft")
  authorId    ObjectId
  author      User       @relation(fields: [authorId])
  tags        String[]
  viewCount   Int        @default(0)
  comments    Comment[]  @embedded
  publishedAt DateTime?
  updatedAt   DateTime   @updatedAt

  @@collection("posts")
  @@index([authorId])
  @@index([status, publishedAt])
}

type Comment @embedded {
  authorId  ObjectId
  text      String
  createdAt DateTime @default(now())
}
```

### Query patterns

```typescript
const db = mongo.orm({ contract, runtime });

// --- Reads ---

// List published posts with author info
const feed = await db.Post
  .where((p) => p.status.eq('published'))
  .include('author', (a) => a.select('name', 'email', 'profile'))
  .orderBy((p) => p.publishedAt.desc())
  .take(20)
  .all();

// Find post by slug (unique field)
const post = await db.Post.where({ slug: 'why-mongodb' }).first();

// Access embedded data — always loaded, fully typed
console.log(post.comments[0].text);      // string
console.log(post.author.profile.social.twitter); // string | null (after include)

// Filter on embedded fields via dot notation
const twitterUsers = await db.User
  .where((u) => u.profile.social.twitter.ne(null))
  .all();

// Filter on array contents
const mongoPosts = await db.Post
  .where((p) => p.tags.has('mongodb'))
  .all();

// Filter on embedded array element fields
const postsWithBobComments = await db.Post
  .where((p) => p.comments.some((c) => c.authorId.eq(bobId)))
  .all();

// Cursor-based pagination
const page = await db.Post
  .where((p) => p.status.eq('published'))
  .orderBy((p) => p.publishedAt.desc())
  .cursor(lastPostId)
  .take(20)
  .all();

// Count
const postCount = await db.Post
  .where((p) => p.status.eq('published'))
  .count();

// --- Writes ---

// Create with embedded data
const newPost = await db.Post.create({
  title: 'New Post',
  slug: 'new-post',
  content: 'Hello world',
  authorId: aliceId,
  tags: ['intro'],
  comments: [],
});

// Atomic increment — no read-modify-write
await db.Post.where({ id: postId }).update({
  viewCount: { $inc: 1 },
});

// Atomic array push — add a tag
await db.Post.where({ id: postId }).update({
  tags: { $addToSet: 'typescript' },
});

// Push embedded comment
await db.Post.where({ id: postId }).update({
  comments: { $push: { authorId: bobId, text: 'Nice!', createdAt: new Date() } },
});

// Update nested embedded field
await db.User.where({ id: userId }).update({
  'profile.social.twitter': '@newalice',
});

// Delete post (with cascade if configured on User.posts)
await db.Post.where({ id: postId }).delete();
```

---

## 2. E-commerce

An online store with customers, products, orders, and reviews. Demonstrates the extended reference pattern (denormalized product info in order line items), the subset pattern (recent orders on customer), array mutations for cart operations, and upsert.

### MongoDB collections

**customers**
```json
{
  "_id": ObjectId("..."),
  "email": "alice@example.com",
  "name": "Alice Smith",
  "addresses": [
    {
      "label": "home",
      "street": "123 Main St",
      "city": "Springfield",
      "state": "IL",
      "zip": "62701",
      "isDefault": true
    }
  ],
  "cart": [
    { "productId": ObjectId("ppp"), "name": "Widget", "price": 9.99, "quantity": 2 }
  ],
  "createdAt": ISODate("...")
}
```

**products**
```json
{
  "_id": ObjectId("ppp"),
  "name": "Widget",
  "description": "A useful widget",
  "price": 9.99,
  "category": "gadgets",
  "tags": ["popular", "sale"],
  "inventory": 142,
  "rating": { "average": 4.5, "count": 87 },
  "createdAt": ISODate("...")
}
```

**orders**
```json
{
  "_id": ObjectId("..."),
  "customerId": ObjectId("..."),
  "status": "shipped",
  "items": [
    {
      "productId": ObjectId("ppp"),
      "name": "Widget",
      "priceAtPurchase": 9.99,
      "quantity": 2
    }
  ],
  "shippingAddress": {
    "street": "123 Main St",
    "city": "Springfield",
    "state": "IL",
    "zip": "62701"
  },
  "total": 19.98,
  "placedAt": ISODate("..."),
  "updatedAt": ISODate("...")
}
```

### Prisma Next PSL

```prisma
model Customer {
  id        ObjectId    @id @default(auto()) @map("_id")
  email     String      @unique
  name      String
  addresses Address[]   @embedded
  cart      CartItem[]  @embedded
  orders    Order[]     @relation(references: [customerId])
  createdAt DateTime    @default(now())

  @@collection("customers")
}

type Address @embedded {
  label     String
  street    String
  city      String
  state     String
  zip       String
  isDefault Boolean @default(false)
}

type CartItem @embedded {
  productId ObjectId
  name      String
  price     Float
  quantity  Int
}

model Product {
  id          ObjectId @id @default(auto()) @map("_id")
  name        String
  description String?
  price       Float
  category    String
  tags        String[]
  inventory   Int      @default(0)
  rating      Rating   @embedded
  createdAt   DateTime @default(now())

  @@collection("products")
  @@index([category])
  @@index([tags])
}

type Rating @embedded {
  average Float @default(0)
  count   Int   @default(0)
}

model Order {
  id              ObjectId    @id @default(auto()) @map("_id")
  customerId      ObjectId
  customer        Customer    @relation(fields: [customerId])
  status          String      @default("pending")
  items           OrderItem[] @embedded
  shippingAddress Address     @embedded
  total           Float
  placedAt        DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  @@collection("orders")
  @@index([customerId, placedAt])
  @@index([status])
}

type OrderItem @embedded {
  productId       ObjectId
  name            String
  priceAtPurchase Float
  quantity        Int
}
```

### Query patterns

```typescript
// --- Cart operations (atomic array mutations) ---

// Add to cart
await db.Customer.where({ id: customerId }).update({
  cart: { $push: { productId: prodId, name: 'Widget', price: 9.99, quantity: 1 } },
});

// Remove from cart by product
await db.Customer.where({ id: customerId }).update({
  cart: { $pull: { productId: prodId } },
});

// --- Product queries ---

// Search by category with tag filter
const gadgets = await db.Product
  .where((p) => and(p.category.eq('gadgets'), p.tags.has('sale')))
  .orderBy((p) => p.rating.average.desc())
  .take(20)
  .all();

// Decrement inventory atomically
await db.Product.where({ id: prodId }).update({
  inventory: { $inc: -1 },
});

// Update rating atomically (after a new review)
await db.Product.where({ id: prodId }).update({
  'rating.count': { $inc: 1 },
  'rating.average': newAverage,  // computed by application
});

// --- Order queries ---

// Customer's order history with pagination
const orders = await db.Order
  .where((o) => o.customerId.eq(customerId))
  .orderBy((o) => o.placedAt.desc())
  .cursor(lastOrderId)
  .take(10)
  .all();

// Orders by status
const pendingOrders = await db.Order
  .where((o) => o.status.eq('pending'))
  .include('customer', (c) => c.select('name', 'email'))
  .all();

// Filter on embedded order item fields
const widgetOrders = await db.Order
  .where((o) => o.items.some((i) => i.name.eq('Widget')))
  .all();

// --- Upsert ---

// Ensure customer exists (create or update on login)
const customer = await db.Customer.upsert({
  where: { email: 'alice@example.com' },
  create: { email: 'alice@example.com', name: 'Alice', addresses: [], cart: [] },
  update: { name: 'Alice' },
});
```

---

## 3. SaaS task management (with polymorphism)

A multi-tenant project management app. Demonstrates polymorphic collections (different task types in one collection), discriminated unions, nested embedded structures, and cross-collection relations.

### MongoDB collections

**organizations**
```json
{
  "_id": ObjectId("..."),
  "name": "Acme Corp",
  "slug": "acme",
  "plan": "team",
  "memberIds": [ObjectId("u1"), ObjectId("u2"), ObjectId("u3")]
}
```

**users**
```json
{
  "_id": ObjectId("u1"),
  "email": "alice@acme.com",
  "name": "Alice",
  "role": "admin"
}
```

**tasks** — polymorphic collection
```json
// Bug report
{
  "_id": ObjectId("..."),
  "type": "bug",
  "projectId": ObjectId("..."),
  "title": "Login fails on Safari",
  "status": "open",
  "assigneeId": ObjectId("u1"),
  "severity": "high",
  "stepsToReproduce": "1. Open Safari\n2. Click Login\n3. Nothing happens",
  "browser": "Safari 17",
  "labels": ["frontend", "auth"],
  "comments": [
    { "authorId": ObjectId("u2"), "text": "Confirmed on my machine", "createdAt": ISODate("...") }
  ],
  "createdAt": ISODate("..."),
  "updatedAt": ISODate("...")
}

// Feature request
{
  "_id": ObjectId("..."),
  "type": "feature",
  "projectId": ObjectId("..."),
  "title": "Dark mode support",
  "status": "in_progress",
  "assigneeId": ObjectId("u2"),
  "priority": "medium",
  "acceptanceCriteria": [
    "Toggle in settings",
    "Persists across sessions",
    "Respects OS preference by default"
  ],
  "designUrl": "https://figma.com/...",
  "labels": ["ui", "settings"],
  "comments": [],
  "createdAt": ISODate("..."),
  "updatedAt": ISODate("...")
}

// Chore
{
  "_id": ObjectId("..."),
  "type": "chore",
  "projectId": ObjectId("..."),
  "title": "Upgrade Node to v22",
  "status": "done",
  "assigneeId": null,
  "recurrence": "quarterly",
  "labels": ["infra"],
  "comments": [],
  "createdAt": ISODate("..."),
  "updatedAt": ISODate("...")
}
```

### Prisma Next PSL

```prisma
model Organization {
  id        ObjectId   @id @default(auto()) @map("_id")
  name      String
  slug      String     @unique
  plan      String     @default("free")
  memberIds ObjectId[]
  members   User[]     @relation(references: [memberIds])

  @@collection("organizations")
}

model User {
  id    ObjectId @id @default(auto()) @map("_id")
  email String   @unique
  name  String
  role  String   @default("member")

  @@collection("users")
}

/// Base model for the polymorphic tasks collection.
/// All task types share these fields.
model Task {
  id         ObjectId  @id @default(auto()) @map("_id")
  type       String    @discriminator
  projectId  ObjectId
  title      String
  status     String    @default("open")
  assigneeId ObjectId?
  assignee   User?     @relation(fields: [assigneeId])
  labels     String[]
  comments   Comment[] @embedded
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  @@collection("tasks")
  @@index([projectId, status])
  @@index([assigneeId])
  @@index([labels])
}

model Bug extends Task {
  type             String @discriminator("bug")
  severity         String
  stepsToReproduce String?
  browser          String?
}

model Feature extends Task {
  type               String   @discriminator("feature")
  priority           String
  acceptanceCriteria String[]
  designUrl          String?
}

model Chore extends Task {
  type       String  @discriminator("chore")
  recurrence String?
}

type Comment @embedded {
  authorId  ObjectId
  text      String
  createdAt DateTime @default(now())
}
```

### Query patterns

```typescript
// --- Polymorphic queries ---

// All tasks for a project (returns union type: Bug | Feature | Chore)
const tasks = await db.Task
  .where((t) => t.projectId.eq(projectId))
  .orderBy((t) => t.updatedAt.desc())
  .take(50)
  .all();

// Narrow by type — only bugs
const bugs = await db.Bug
  .where((b) => and(b.projectId.eq(projectId), b.severity.eq('high')))
  .include('assignee')
  .all();
// bugs[0].severity    — typed as string (Bug-specific field)
// bugs[0].stepsToReproduce — typed as string | null

// Only features in progress
const features = await db.Feature
  .where((f) => f.status.eq('in_progress'))
  .all();
// features[0].acceptanceCriteria — typed as string[]
// features[0].designUrl — typed as string | null

// Type narrowing on the base collection result
for (const task of tasks) {
  if (task.type === 'bug') {
    console.log(task.severity);  // narrowed to Bug, severity is typed
  }
}

// --- Cross-collection relations ---

// Org with members
const org = await db.Organization
  .where({ slug: 'acme' })
  .include('members')
  .first();

// Tasks assigned to a user
const myTasks = await db.Task
  .where((t) => t.assigneeId.eq(userId))
  .orderBy((t) => t.status.asc())
  .all();

// --- Embedded data ---

// Add a comment to any task type
await db.Task.where({ id: taskId }).update({
  comments: { $push: { authorId: userId, text: 'Working on it', createdAt: new Date() } },
});

// Find tasks with comments from a specific user
const commented = await db.Task
  .where((t) => t.comments.some((c) => c.authorId.eq(userId)))
  .all();

// --- Label operations ---

// Add a label (unique)
await db.Task.where({ id: taskId }).update({
  labels: { $addToSet: 'urgent' },
});

// Remove a label
await db.Task.where({ id: taskId }).update({
  labels: { $pull: 'urgent' },
});

// Find tasks with all specified labels
const frontendAuth = await db.Task
  .where((t) => t.labels.hasAll(['frontend', 'auth']))
  .all();
```

---

## Idiom coverage

Which idioms from [mongo-idioms.md](mongo-idioms.md) do these examples exercise?

| Idiom | Example | Coverage |
|---|---|---|
| Embed what you read together | Blog (comments in posts), E-commerce (addresses, cart items, order items) | Full |
| Reference what grows unboundedly | Blog (users ↔ posts), E-commerce (customers ↔ orders) | Full |
| Extended reference | E-commerce (product name/price snapshot in order items) | Demonstrated |
| Polymorphic collection | SaaS (Bug / Feature / Chore in tasks collection) | Full |
| Dot notation on nested fields | Blog (profile.social.twitter), E-commerce (rating.average) | Full |
| Array element matching | Blog (tags.has), SaaS (labels.hasAll), E-commerce (items.some) | Full |
| Atomic field-level updates | Blog ($inc viewCount), E-commerce ($inc inventory) | Full |
| Atomic array mutations | Blog ($push comment, $addToSet tag), E-commerce ($push/$pull cart), SaaS ($addToSet/$pull label) | Full |
| Cursor-based pagination | Blog (posts feed), E-commerce (order history) | Full |
| Upsert | E-commerce (ensure customer on login) | Full |
| Projection / select | Blog (author select), E-commerce (customer select) | Full |
| Count / distinct | Blog (post count) | Partial |
| Subset pattern | — | Not demonstrated |
| Bucket pattern | — | Not demonstrated |
| Schema versioning | — | Not demonstrated |
| Tree patterns | — | Not demonstrated |
| Change streams | — | Not demonstrated (deferred) |
| findOneAndUpdate | — | Not demonstrated |
| Aggregation pipeline | — | Not demonstrated (escape hatch only) |
