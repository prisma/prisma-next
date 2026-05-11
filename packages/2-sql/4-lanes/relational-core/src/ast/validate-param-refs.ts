/**
 * Builder-pipeline validator pass: every {@link ParamRef} whose `codec` resolves to a *parameterized* descriptor must carry `typeParams` on its {@link CodecRef} so encode-side dispatch can materialise the per-instance codec via `contractCodecs.forCodecRef(codec)`. Refs missing `typeParams` for a parameterized codec id are a hard error — the descriptor's `paramsSchema` would reject `undefined`, so the dispatch path
 * rejects them at validation time rather than silently failing downstream.
 *
 * Non-parameterized codec ids (the `voidParamsSchema` case) are always dispatch-safe via the codec id alone, so refs without `typeParams` for those ids are accepted unchanged.
 *
 * The pass runs post-build / pre-execute — the natural location is the SQL runtime's `lower()` step, between any `beforeCompile` rewrites and `encodeParams`.
 */

import { runtimeError } from '@prisma-next/framework-components/runtime';
import type { CodecDescriptorRegistry } from '../query-lane-context';
import type { AnyQueryAst, ParamRef } from './types';
import { collectOrderedParamRefs } from './util';

/**
 * Validate that every parameterized-codec `ParamRef` in `plan` carries `typeParams` on its `CodecRef`. Throws `RUNTIME.PARAM_REF_REFS_REQUIRED` (a runtime envelope) naming the codec id and the binding label when the invariant is violated.
 *
 * The `registry` is consulted via `descriptorFor(codecId).isParameterized` — `true` whenever the descriptor's `paramsSchema` is not the singleton `voidParamsSchema`.
 */
export function validateParamRefRefs(plan: AnyQueryAst, registry: CodecDescriptorRegistry): void {
  for (const ref of collectOrderedParamRefs(plan)) {
    diagnoseRef(ref, registry);
  }
}

function diagnoseRef(ref: ParamRef, registry: CodecDescriptorRegistry): void {
  const codecId = ref.codec?.codecId;
  if (!codecId) return;
  const descriptor = registry.descriptorFor(codecId);
  if (descriptor === undefined) return;
  if (!descriptor.isParameterized) return;
  if (ref.codec?.typeParams !== undefined) return;

  const label = ref.name ?? '<anonymous>';
  throw runtimeError(
    'RUNTIME.PARAM_REF_REFS_REQUIRED',
    `ParamRef '${label}' for parameterized codec '${codecId}' is missing typeParams; column-aware dispatch requires typeParams on the CodecRef at the binding site.`,
    { codecId, paramName: ref.name },
  );
}
