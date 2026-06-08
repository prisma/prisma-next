# enum-demo

End-to-end demonstration of the application read surface for domain enums (TML-2852), authored with the TypeScript `enumType` API (not PSL `enum`).

`src/contract.ts` declares a `Priority` enum with `enumType`/`member` and uses it as a model field via `field.namedType(Priority)`. Declaration order is `low → high → medium`, which differs from lexical order so the ORDER BY behaviour is observable.

The slice's three surfaces, each exercised by a test:

1. **Typed reads/writes** (`test/enum-demo.types.test-d.ts`) — the field reads as the value union `'low' | 'high' | 'medium'`, not `string`; a write only accepts that union (an out-of-union literal is a compile error).
2. **`db.enums`** (`test/enum-demo.integration.test.ts`) — `db.enums.Priority` exposes `.values`, `.names`, `.members`, `.has`, `.ordinalOf` at runtime, in declaration order.
3. **Declaration-order `ORDER BY`** (`test/enum-demo.integration.test.ts`) — `ORDER BY` on the enum column sorts by declaration order via `array_position`, not lexically. The CHECK constraint emitted by slice 2 rejects out-of-union values.

The runtime client passes the TypeScript-authored `contract` directly to the execution context, so the value-union types flow from the authored definition. `pnpm emit` regenerates the committed `src/contract.json` / `src/contract.d.ts`.

```bash
pnpm --filter prisma-next-enum-demo test       # PGlite integration + type tests
pnpm --filter prisma-next-enum-demo emit:check # contract artefacts are up to date
```
