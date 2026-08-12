# @prisma-next/tsconfig

This package is inspired by https://www.elsakaan.dev/blog/monorepo-college-2.

We're solving unnecessary complexity of `extends` paths in nested `tsconfig.json` files by using `pnpm`'s superpowers.

## Usage

### Installation

Add `@prisma-next/tsconfig` as a workspace devDependency in your package's `package.json`:

```bash
pnpm add -D --workspace @prisma-next/tsconfig
```

Or add it manually to `package.json`:

```json
{
  "devDependencies": {
    "@prisma-next/tsconfig": "workspace:*"
  }
}
```

### Extending the Base Configuration

In your `tsconfig.json`, extend the base configuration:

```json
{
  "extends": ["@prisma-next/tsconfig/base"],
  "compilerOptions": {
    // Your package-specific overrides
  }
}
```
