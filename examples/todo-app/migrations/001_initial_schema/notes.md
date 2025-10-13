# Initial Schema Migration

This migration creates the initial database schema for the todo-app example.

## Tables Created

### user
- `id`: Primary key, auto-incrementing integer
- `email`: Unique varchar field for user identification
- `active`: Boolean flag with default value `true`
- `createdAt`: Timestamp with default value `NOW()`

### post
- `id`: Primary key, auto-incrementing integer
- `title`: Text field for post title
- `published`: Boolean flag with default value `false`
- `createdAt`: Timestamp with default value `NOW()`
- `user_id`: Foreign key referencing `user.id`

## Constraints
- Primary keys on both tables
- Unique constraint on `user.email`
- Foreign key constraint from `post.user_id` to `user.id`

This migration represents the initial state of the database schema as defined in the PSL contract.
