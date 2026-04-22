# @prisma-next/vite-plugin-contract-emit

Vite plugin for automatic Prisma Next contract artifact emission during development.

## Overview

This plugin integrates with Vite's dev server to automatically emit contract artifacts (`contract.json` and `contract.d.ts`) when you start the server and whenever your contract authoring files change.

## Features

- **Emit on startup**: Emits contract artifacts when the Vite dev server starts
- **Config graph + resolved inputs**: Re-emits from the config module graph plus loader-finalized `contract.source.inputs`
- **Debounce**: Configurable debounce prevents rapid re-emission during rapid edits
- **Last-change-wins**: Overlapping emit requests are cancelled to avoid stale results
- **Ordered pair publication**: Emits stage temp artifacts, rename `contract.d.ts` before `contract.json`, and attempts to restore the last good pair if publication fails
- **Config-only fallback warning**: Falls back to watching the config path and warns when loader-resolved inputs cannot be determined
- **Error overlay**: Emission failures are surfaced via Vite's error overlay
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
2. **Resolve paths in the loader**: The loader returns absolute `contract.source.inputs` and `contract.output`
3. **Resolve watched files**: The plugin crawls the Vite module graph from the config entrypoint
4. **Merge declared inputs**: It adds any explicit `contract.source.inputs`, and treats JS/TS inputs as additional module-graph roots
5. **Filter emitted artifacts**: Output files are removed from the watch set to avoid self-trigger loops
6. **Fallback on load failure**: If resolved inputs cannot be loaded, it watches only the config path and warns that coverage is partial
7. **Publish staged artifacts**: Emits write temp files beside the output paths, rename `contract.d.ts` first, then rename `contract.json`, and attempts to roll back to the previous pair if publication fails
8. **Initial emit**: The contract is emitted immediately on server start
9. **Hot updates**: When any watched file changes, a debounced re-emit is triggered

## Architecture

```mermaid
graph TD
    A[Vite Dev Server] --> B[prismaVitePlugin]
    B --> C[configureServer hook]
    C --> D[Load config via CLI loader]
    D --> E[Collect config module graph]
    E --> F[Merge source.inputs]
    F --> G[Filter emitted artifacts]
    G --> H[Add files to watcher]
    H --> I[Initial emit]
    
    J[File change] --> K[handleHotUpdate hook]
    K --> L[Schedule debounced emit]
    L --> M[executeContractEmit]
    M --> N[Write temp artifacts]
    N --> O[Rename d.ts then json]

    P[Error] --> Q[Overlay or console logging]
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
