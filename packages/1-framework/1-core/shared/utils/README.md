# @prisma-next/utils

Shared utility functions for Prisma Next.

## Overview

This package provides general-purpose utility functions used across the Prisma Next codebase. These utilities are target-agnostic and have no dependencies on other Prisma Next packages.

## Utilities

### `defined(key, value)`

Returns an object with the key/value if value is defined, otherwise an empty object. Use with spread to conditionally include optional properties while satisfying `exactOptionalPropertyTypes`.

```typescript
import { defined } from '@prisma-next/utils';

// Instead of:
const obj = {
  required: 'value',
  ...(optional ? { optional } : {}),
};

// Use:
const obj = {
  required: 'value',
  ...defined('optional', optional),
};
```

**Why use this?**

1. **Explicit**: You name exactly which properties are optional
2. **Intentional**: Won't accidentally strip other properties
3. **Type-safe**: Returns `{}` or `{ key: V }` (without undefined)
4. **exactOptionalPropertyTypes compatible**: Properly handles TypeScript's strict optional property checking

## Package Location

This package is part of the **framework domain**, **core layer**, **shared plane**:
- **Domain**: framework (target-agnostic)
- **Layer**: core
- **Plane**: shared
- **Path**: `packages/1-framework/1-core/shared/utils`

## Dependencies

This package has **no dependencies** - it's part of the innermost core ring and provides foundational utilities.

