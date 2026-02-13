# New API sketches

## Repository-based client structure

```typescript
class PostRepository extends Repository<Contract, "Post"> {
  popular() {
    return this.filter((p) => p.views.gt(1000));
  }
}

// ...

const db = orm({
  context: executionContext,
  repositories: {
    post: new PostRepository(executionContext),
    // Use default repositories for the rest of the model
  }
});

const posts = await db.posts.popular().findMany().collect()
```

## Filter parent records by child records

```typescript
const users = await db
  .users
  .where((u) => u.posts.has((p) => p.popular()))
  .findMany()
  .toArray()
```

## Selecting related records

```typescript
db
  .users
  .where(conditions)
  .include(user.posts, (p) =>
    p.where(conditions).include(post.comments)
  )
  .findMany()
```

## Nested mutation

We're not awaiting `findUnique`, instead using `.comments` to drop to a `comments` repository attached to the parent `post` record.

```typescript
 db
  .posts
  .where({ id: postId })
  .findUnique()
  .comments
  .create(commentInput)
```


## Prev iterations, rejected for now


```typescript
const users = await db
  .user
  .filter(/* ... */)
  // option 1
  .select((u) => ({
    name: u.name,
    // posts: u.posts.filter((p) => p.views.gt(1000))
    posts: u.posts.select((p) => ({
      title: p.title,
      comments: p.comments,
    }))
  }))
  // option 2
  .select({
    name: true,
    posts: {
      comments: true
    }
  })
  .findMany()
  .collect()
```


## Questions

1. Including the low level queries into the high level query
2. Database capabilities and the number of queries
3. Fluent API for operators: looks nice but hard to extend. Functions are more composable.
