# Migration Planner Demo

This example demonstrates the **Migration Planner (Slice 2)** in action! It shows how the planner generates deterministic migrations from PSL schema changes.

## 🚀 Quick Demo

Run the complete migration workflow:

```bash
pnpm demo
```

This will:
1. Reset the database to empty state
2. Modify the PSL schema (add a `bio` column to User)
3. Generate a new migration using the planner
4. Apply all migrations
5. Show the final database state

## 📋 Individual Commands

### Reset Database
```bash
pnpm reset-db
```
Clears the database and removes all tables.

### Generate Migration
```bash
pnpm generate-migration [custom-id]
```
Compares current database state with PSL schema and generates a migration program.

### Evolve Schema
```bash
pnpm evolve-schema
```
Modifies the PSL schema (adds a `bio` column) and generates a migration.

### Apply Migrations
```bash
pnpm migrate
```
Applies all available migrations in order.

### Test Migration Planner
```bash
pnpm test:planner
```
Runs: reset → evolve schema → migrate (shows the full planner workflow)

## 🔍 What You'll See

### Migration Program Structure
Each migration creates a folder with:
- `meta.json` - Migration metadata (ID, from/to hashes, etc.)
- `opset.json` - Schema operations (addTable, addColumn, etc.)
- `diff.json` - Machine-readable change summary
- `notes.md` - Human-readable migration notes

### Example Migration Output
```
📦 Migration program created:
   Directory: migrations/20250113T1430_add-columns
   Files: meta.json, opset.json, diff.json, notes.md

📋 Migration Summary:
   • 1 column(s) added

🎉 Migration generation complete!
💡 Run "pnpm migrate" to apply the new migration
```

### Database State
After migration, you'll have:
- `user` table with `id`, `email`, `active`, `bio`, `createdAt` columns
- `post` table with `id`, `title`, `published`, `createdAt`, `user_id` columns
- Foreign key relationship: `post.user_id` → `user.id`
- Unique constraint on `user.email`
- Test data inserted

## 🧠 How It Works

1. **PSL Parsing**: The planner reads `schema.psl` and converts it to a contract IR
2. **Change Detection**: Compares current database state with desired PSL state
3. **Operation Planning**: Generates additive operations (addTable, addColumn, etc.)
4. **Canonicalization**: Sorts operations deterministically for stable hashing
5. **Artifact Generation**: Creates migration program with metadata and documentation
6. **Migration Application**: Runner applies operations in correct order

## 🎯 Key Features Demonstrated

- ✅ **Deterministic**: Same PSL changes → same migration hash
- ✅ **Additive-only**: Only supports safe additions (no drops/renames in MVP)
- ✅ **Postgres-native naming**: Constraint names follow Postgres conventions
- ✅ **FK supporting indexes**: Automatically adds indexes for foreign keys when needed
- ✅ **Fail-fast**: Clear error messages for unsupported changes
- ✅ **Complete artifacts**: Generates all migration program files

## 🔧 Troubleshooting

If you encounter issues:

1. **Database connection**: Ensure PostgreSQL is running on `localhost:5432`
2. **Build errors**: Run `pnpm build` to compile TypeScript
3. **Clean slate**: Run `pnpm reset-db` to start fresh
4. **Check logs**: Look for specific error messages in the console output

## 📚 Next Steps

This demo shows the **MVP planner** which only supports additive changes. Future versions will support:
- Renames (with PSL hints)
- Drops (with explicit intent)
- Type changes (with casting rules)
- Complex transformations (with migration scripts)

The foundation is solid and ready for these extensions! 🚀
