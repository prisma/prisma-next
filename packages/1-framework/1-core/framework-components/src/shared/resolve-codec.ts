import { blindCast } from '@prisma-next/utils/casts';
import type { Codec } from './codec';
import type { AnyCodecDescriptor } from './codec-descriptor';
import type { CodecInstanceContext, CodecRef } from './codec-types';
import { runtimeError } from './runtime-error';

/**
 * Look up a descriptor for `ref.codecId` using `descriptorFor`; throw
 * `RUNTIME.CODEC_DESCRIPTOR_MISSING` if none is found.
 */
export function resolveCodecDescriptorOrThrow(
  descriptorFor: (codecId: string) => AnyCodecDescriptor | undefined,
  ref: CodecRef,
): AnyCodecDescriptor {
  const descriptor = descriptorFor(ref.codecId);
  if (!descriptor) {
    throw runtimeError(
      'RUNTIME.CODEC_DESCRIPTOR_MISSING',
      `No codec descriptor registered for codecId '${ref.codecId}'.`,
      { codecId: ref.codecId },
    );
  }
  return descriptor;
}

/**
 * Validates `ref.typeParams` against `descriptor.paramsSchema`.
 *
 * Parameterized codecs that omit `typeParams` have it normalized to `{}` before
 * validation (mirrors `ast-codec-resolver.ts` semantics). Throws
 * `RUNTIME.TYPE_PARAMS_INVALID` when the validator returns a `Promise` or
 * reports issues.
 */
export function validateCodecTypeParams(descriptor: AnyCodecDescriptor, ref: CodecRef): unknown {
  const normalized =
    descriptor.isParameterized && ref.typeParams === undefined ? { ...ref, typeParams: {} } : ref;

  const result = blindCast<
    { value: unknown } | { issues: ReadonlyArray<{ message: string }> } | Promise<unknown>,
    'Standard Schema validate returns unknown; the spec guarantees this union shape'
  >(descriptor.paramsSchema['~standard'].validate(normalized.typeParams));

  if (result instanceof Promise) {
    throw runtimeError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `paramsSchema for codec '${ref.codecId}' returned a Promise; runtime validation requires a synchronous Standard Schema validator.`,
      { codecId: ref.codecId, typeParams: ref.typeParams },
    );
  }

  if ('issues' in result && result.issues) {
    const messages = result.issues.map((issue) => issue.message).join('; ');
    throw runtimeError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `Invalid typeParams for codec '${ref.codecId}': ${messages}`,
      { codecId: ref.codecId, typeParams: ref.typeParams },
    );
  }

  return blindCast<{ value: unknown }, 'issues guard above rules out the issues branch'>(result)
    .value;
}

/**
 * Resolves a `Codec` instance: validates `ref.typeParams` via
 * {@link validateCodecTypeParams} then calls `descriptor.factory(validated)(ctx)`.
 *
 * The descriptor's `factory` is typed against its own `P`; the registry erases
 * `P` to `any`, so the factory is narrowed to `(params: unknown) => (ctx) => Codec`
 * at the call boundary. The `paramsSchema` validates the input above before we
 * forward it, so the narrowing is safe by construction.
 */
export function materializeCodec(
  descriptor: AnyCodecDescriptor,
  ref: CodecRef,
  ctx: CodecInstanceContext,
): Codec {
  const validated = validateCodecTypeParams(descriptor, ref);
  return blindCast<
    (params: unknown) => (ctx: CodecInstanceContext) => Codec,
    'registry erases P to any; paramsSchema validates input before forwarding'
  >(descriptor.factory)(validated)(ctx);
}
