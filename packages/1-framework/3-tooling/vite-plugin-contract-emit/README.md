# @prisma-next/vite-plugin-contract-emit

Vite plugin for automatic Prisma Next contract artifact emission during development.

## Overview

This plugin integrates with Vite's dev server to automatically emit contract artifacts (`contract.json` and `contract.d.ts`) when you start the server and whenever your contract authoring files change.

## Features

- **Emit on startup**: Emits contract artifacts when the Vite dev server starts
- **Authoritative watch mode**: Re-emits from `contract.source.authoritativeInputs`
- **Debounce**: Configurable debounce prevents rapid re-emission during rapid edits
- **Last-change-wins**: Overlapping emit requests are cancelled to avoid stale results
- **Error overlay**: Emission failures are surfaced via Vite's error overlay
- **Partial coverage warning**: Surfaces `configPathOnly` as a warning instead of guessing
- **Console logging**: Compact success/error messages with optional debug output

## Installation

```bash
pnpm add -D @prisma-next/vite-plugin-contract-emit vite
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { prismaVitePlugin } from '@prisma-next/vite-plugin-contract-emit';

export default defineConfig({
  plugins: [prismaVitePlugin('prisma-next.config.ts')],
});
```

## API

### `prismaVitePlugin(configPath, options?)`

Creates a Vite plugin configured to emit contract artifacts.

#### Parameters

- `configPath: string` — Path to your `prisma-next.config.ts` file (relative to Vite root)
- `options?: PrismaVitePluginOptions` — Optional configuration

#### Options

```ts
interface PrismaVitePluginOptions {
  debounceMs?: number;  // Debounce delay in ms (default: 150)
  logLevel?: 'silent' | 'info' | 'debug';  // Log verbosity (default: 'info')
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `debounceMs` | `150` | Delay before re-emitting after file changes |
| `logLevel` | `'info'` | `'silent'`: no output, `'info'`: success/errors, `'debug'`: verbose |

## How It Works

1. **On server start**: The plugin loads `prisma-next.config.ts` via the CLI config loader
2. **Resolve authoritative inputs**: It inspects `contract.source.authoritativeInputs`
3. **Choose watch strategy**:
   - `moduleGraph`: crawl the Vite module graph from the config entrypoint
   - `paths`: watch the explicit provider paths
   - `configPathOnly`: watch only the config file and log a partial-coverage warning
4. **Filter emitted artifacts**: Output files are removed from the watch set to avoid self-trigger loops
5. **Initial emit**: The contract is emitted immediately on server start
6. **Hot updates**: When any watched file changes, a debounced re-emit is triggered

## Architecture

```mermaid
graph TD
    A[Vite Dev Server] --> B[prismaVitePlugin]
    B --> C[configureServer hook]
    C --> D[Load config via CLI loader]
    D --> E[Read authoritativeInputs]
    E --> F{moduleGraph / paths / configPathOnly}
    F --> G[Resolve watched files]
    G --> H[Filter emitted artifacts]
    H --> I[Add files to watcher]
    I --> J[Initial emit]
    
    K[File change] --> L[handleHotUpdate hook]
    L --> M[Schedule debounced emit]
    M --> N[executeContractEmit]
    N --> O[Write artifacts]
    
    P[Error or partial coverage] --> Q[Overlay or console warning]
```

## Dependencies

- **@prisma-next/cli**: Uses the control-api `executeContractEmit` operation
- **vite**: Peer dependency (>=5.0.0)

## Example

See `examples/prisma-next-demo` for a working example with:
- `vite.config.ts` configured with the plugin
- `pnpm dev` script to start Vite
- `prisma/contract.ts` as the contract authoring source

Run `pnpm dev` in the demo, edit `prisma/contract.ts`, and watch the artifacts regenerate.

## Related

- [ADR 032 — Dev Auto-Emit Integration](../../../../../docs/architecture%20docs/adrs/ADR%20032%20-%20Dev%20Auto%20Emit%20Integration.md)
- [ADR 008 — Dev Auto-Emit, CI Explicit Emit](../../../../../docs/architecture%20docs/adrs/ADR%20008%20-%20Dev%20Auto%20Emit%20CI%20Explicit%20Emit.md)
- [Subsystem: Contract Emitter & Types](../../../../../docs/architecture%20docs/subsystems/2.%20Contract%20Emitter%20&%20Types.md)
