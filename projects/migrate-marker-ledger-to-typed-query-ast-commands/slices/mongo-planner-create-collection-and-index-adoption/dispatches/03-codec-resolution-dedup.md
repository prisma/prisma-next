# D3 — codec-resolution dedup (carried from slice 7)

## What was duplicated

Two `forCodecRef` implementations independently did "find the descriptor for `ref.codecId` → throw `RUNTIME.CODEC_DESCRIPTOR_MISSING` if absent → `materializeCodec`":

- Framework: `extractCodecLookup` in `framework-components/src/control/control-stack.ts` (over its local `descriptorsById` map).
- Runtime: `createAstCodecResolver` in `2-sql/5-runtime/src/codecs/ast-codec-resolver.ts` (over the `CodecDescriptorRegistry.descriptorFor` index).

## The collapse

One shared helper in the shared resolver core (`framework-components/src/shared/resolve-codec.ts`, beside `materializeCodec`/`validateCodecTypeParams`):

```ts
resolveCodecDescriptorOrThrow(descriptorFor: (codecId: string) => AnyCodecDescriptor | undefined, ref: CodecRef): AnyCodecDescriptor
```

Both call sites delegate to it, passing their own index by reference (`(id) => descriptorsById.get(id)` / `(id) => descriptors.descriptorFor(id)`). No registry construction, no lookup↔registry conversion shims — the indexes stay where they are and are consulted through a function reference.

## Residual (deliberate)

The two descriptor **indexes** themselves (`descriptorsById` in `extractCodecLookup` vs the SQL `CodecDescriptorRegistry`) are not unified: they live on opposite sides of the framework/SQL plane split and are built from different inputs (stack descriptor packs vs query-lane context). Unifying them would mean a cross-plane shared registry type for marginal gain — the duplicated *logic* (find + throw + materialize) is what slice 7's review flagged, and that is now single-sourced.

## Tests

`control-stack.test.ts` gains `forCodecRef` resolve + missing-descriptor cases; the existing `ast-codec-resolver.test.ts` suite (cache, typeParams validation, `CODEC_DESCRIPTOR_MISSING`) pins the runtime side unchanged.
