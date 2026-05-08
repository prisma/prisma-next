/**
 * Builder-pipeline validator pass: every {@link ParamRef} whose `codecId`
 * resolves to a *parameterized* descriptor must carry
 * `refs: { table, column }` so encode-side dispatch can call
 * `contractCodecs.forColumn(table, column)`. Refs-less parameterized
 * `ParamRef`s are a hard error — the codec-id-keyed `forCodecId` fallback
 * cannot disambiguate per-instance codecs (e.g. `vector(1024)` vs.
 * `vector(1536)`), so the dispatch path must reject them at validation
 * time rather than silently bind to the wrong instance.
 *
 * Non-parameterized codec ids (the `voidParamsSchema` case) are always
 * dispatch-safe via codec id alone, so refs-less ParamRefs for those ids
 * are accepted unchanged.
 *
 * The pass runs post-build / pre-execute — the natural location is the
 * SQL runtime's `lower()` step, between any `beforeCompile` rewrites and
 * `encodeParams`. See AC-5 in the codec-registry-unification spec.
 */

import { runtimeError } from '@prisma-next/framework-components/runtime';
import type { CodecDescriptorRegistry } from '../query-lane-context';
import type { AnyQueryAst, ParamRef } from './types';
import { collectOrderedParamRefs } from './util';

/**
 * Validate that every parameterized-codec `ParamRef` in `plan` carries
 * `refs`. Throws `RUNTIME.PARAM_REF_REFS_REQUIRED` (a runtime envelope)
 * naming the codec id and the binding label when the invariant is
 * violated. Returns the plan unchanged on success — callers that prefer
 * a side-effecting assertion can ignore the return value.
 *
 * The `registry` is consulted via `descriptorFor(codecId).isParameterized`
 * — `true` whenever the descriptor's `paramsSchema` is not the singleton
 * `voidParamsSchema`.
 */
export function validateParamRefRefs(plan: AnyQueryAst, registry: CodecDescriptorRegistry): void {
  for (const ref of collectOrderedParamRefs(plan)) {
    diagnoseRef(ref, registry);
  }
}

function diagnoseRef(ref: ParamRef, registry: CodecDescriptorRegistry): void {
  if (!ref.codecId) return;
  const descriptor = registry.descriptorFor(ref.codecId);
  if (descriptor === undefined) return;
  if (!descriptor.isParameterized) return;
  if (ref.refs) return;

  const label = ref.name ?? '<anonymous>';
  throw runtimeError(
    'RUNTIME.PARAM_REF_REFS_REQUIRED',
    `ParamRef '${label}' for parameterized codec '${ref.codecId}' is missing column refs; column-aware dispatch requires { table, column } at the binding site.`,
    { codecId: ref.codecId, paramName: ref.name },
  );
}
