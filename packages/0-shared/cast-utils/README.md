## @prisma-next/cast-utils

Named, auditable alternatives to bare `as` casts in TypeScript.

This package exports two helpers that displace `as Foo` / `as unknown as Foo` at call sites where a cast is unavoidable. The split exists so that reviewers can tell at a glance whether a cast is benign or unsafe, and so that authors are forced to articulate the compromise at the call site instead of smuggling it in via a bare `as`.

### `blindCast<T, Reason extends string>(input: unknown): T`

**Last-resort escape hatch for unsafe type assertions. Not a sanctioned tool to reach for.**

Before reaching for `blindCast`, rewrite the surrounding code so the cast becomes unnecessary — tighten an input type, add a runtime check that narrows via a type predicate, restructure a generic so the compiler can see the relationship you're asserting, or use `castAs` when the value already satisfies the target type. Only when no rewrite is feasible does `blindCast` become the right answer.

The `Reason` type parameter is a string literal the author supplies at the call site, naming the compromise. The reviewer validates whether the reason holds up under scrutiny — an unconvincing reason is an instruction to go solve the underlying type-system problem properly, not a free pass.

```typescript
import { blindCast } from '@prisma-next/cast-utils';

const stringValue = blindCast<
  string,
  'JSON.parse returns `unknown`; this field is documented to be a string in the API contract'
>(parsed[key]);
```

### `castAs<T>(value: T): T`

Type-checked, runtime pass-through alternative to a bare `as Type` cast where the value already satisfies the target type. Use this when you want to make a type annotation explicit at the call site without bypassing any compiler checks — for example, to tag a literal object with a nominal interface or to constrain an inferred type.

```typescript
import { castAs } from '@prisma-next/cast-utils';

interface FancyObject {
  key: string;
  keyTwo: { subKey: string; subKeyTwo: number };
}

const typed = castAs<FancyObject>({
  key: 'Chookede',
  keyTwo: { subKey: 'Choookeeeee', subKeyTwo: 2 },
});
```

### When to reach for which helper

| Situation | Helper |
| --- | --- |
| The value already satisfies the target type; you just want the annotation explicit. | `castAs<T>(value)` |
| The input type is genuinely opaque (`unknown`) or unrelated to the target, and you cannot rewrite the code so the cast becomes unnecessary. | `blindCast<T, "reason">(input)` |
| You can rewrite the code so the cast disappears entirely. | **Do that.** Neither helper is needed. |

See `AGENTS.md § Typesafety rules` for the repo-wide policy on casts.
