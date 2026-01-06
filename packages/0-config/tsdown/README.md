# @prisma-next/tsdown

We're solving maintenance burden of lots of similar `tsdown.config.ts` files across many packages that need to be aligned on pretty much everything except for the `entry` property.

Agents could help us align them and make those changes across the codebase, but doing so is usually pretty slow as the agents have to do a bunch of filesystem scans first and waste a bunch of roundtrips to do the job.

## Usage

Add `@prisma-next/tsdown` as a workspace devDependency in your package's `package.json`:

```bash
pnpm add -D --workspace @prisma-next/tsdown
```

Or add it manually to `package.json`:

```json
{
  "devDependencies": {
    "@prisma-next/tsdown": "workspace:*"
  }
}
```

### Extending the Base Configuration

For convenience, we provide a drop-in replacement for `defineConfig` that you can import and use in your `tsdown.config.ts` file:

```ts
import { defineConfig } from '@prisma-next/tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/stuff.ts'],
})
```

Alternatively, you can import and use the base configuration object directly:

```ts
import { baseConfig } from '@prisma-next/tsdown'
import { defineConfig } from 'tsdown'

export default defineConfig({
  ...baseConfig,
  entry: ['src/index.ts', 'src/stuff.ts'],
})
```
