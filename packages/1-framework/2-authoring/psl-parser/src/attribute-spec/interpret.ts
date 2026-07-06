import type {
  PslDiagnostic,
  PslDiagnosticCode,
  PslSpan,
} from '@prisma-next/framework-components/psl-ast';
import { blindCast } from '@prisma-next/utils/casts';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { nodePslSpan } from '../resolve';
import type { FieldAttributeAst, ModelAttributeAst } from '../syntax/ast/attributes';
import type { AttributeArgAst } from '../syntax/ast/expressions';
import type { ArgType, AttributeSpec, InterpretCtx, OptionalArgType, Param } from './types';

const DEFAULT_STRUCTURAL_CODE: PslDiagnosticCode = 'PSL_INVALID_ATTRIBUTE_SYNTAX';

/** Tracked so a later collision is reported as the right kind. */
type Origin = 'positional' | 'named';

export function interpretAttribute<Out>(
  attrNode: FieldAttributeAst | ModelAttributeAst,
  spec: AttributeSpec<Out>,
  ctx: InterpretCtx,
): Result<Out, readonly PslDiagnostic[]> {
  const diagnostics: PslDiagnostic[] = [];
  const code = spec.diagnosticCode ?? DEFAULT_STRUCTURAL_CODE;
  const leafCtx: InterpretCtx = { ...ctx, diagnosticCode: code };
  const attributeSpan = nodePslSpan(attrNode.syntax, ctx.sourceFile);

  const output: Record<string, unknown> = {};
  const seen = new Map<string, Origin>();
  let positionalSlot = 0;
  let reportedExcess = false;

  for (const arg of attrNode.argList()?.args() ?? []) {
    const name = arg.name()?.name();

    if (name === undefined) {
      const param = spec.positional[positionalSlot];
      if (param === undefined) {
        if (!reportedExcess) {
          diagnostics.push(
            diagnostic(
              code,
              `Attribute "${spec.name}" received too many positional arguments`,
              ctx,
              attributeSpan,
            ),
          );
          reportedExcess = true;
        }
        continue;
      }
      positionalSlot += 1;
      if (seen.has(param.key)) {
        diagnostics.push(
          duplicateDiagnostic(
            param.key,
            seen.get(param.key),
            false,
            spec.name,
            ctx,
            arg,
            attributeSpan,
            code,
          ),
        );
        continue;
      }
      seen.set(param.key, 'positional');
      const result = parseArgValue(arg, param.type, leafCtx, diagnostics, code);
      if (result.ok) output[param.key] = result.value;
      continue;
    }

    const param = Object.hasOwn(spec.named, name) ? spec.named[name] : undefined;
    if (param === undefined) {
      diagnostics.push(
        diagnostic(
          code,
          `Attribute "${spec.name}" received unknown argument "${name}"`,
          ctx,
          nodePslSpan(arg.syntax, ctx.sourceFile),
        ),
      );
      continue;
    }
    if (seen.has(name)) {
      diagnostics.push(
        duplicateDiagnostic(name, seen.get(name), true, spec.name, ctx, arg, attributeSpan, code),
      );
      continue;
    }
    seen.set(name, 'named');
    const result = parseArgValue(arg, param, leafCtx, diagnostics, code);
    if (result.ok) output[name] = result.value;
  }

  const finalized = new Set<string>();
  const finalizeAbsentKey = (
    key: string,
    positionalParam: Param<unknown> | undefined,
    namedParam: Param<unknown> | undefined,
  ): void => {
    if (finalized.has(key) || seen.has(key)) return;
    finalized.add(key);
    const effective = namedParam ?? positionalParam;
    if (effective === undefined) return;
    if (isOptionalArgType(effective)) {
      if (effective.hasDefault) output[key] = effective.defaultValue;
      return;
    }
    diagnostics.push(
      diagnostic(
        code,
        `Attribute "${spec.name}" is missing required argument "${key}"`,
        ctx,
        attributeSpan,
      ),
    );
  };

  for (const param of spec.positional) {
    const namedParam = Object.hasOwn(spec.named, param.key) ? spec.named[param.key] : undefined;
    finalizeAbsentKey(param.key, param.type, namedParam);
  }
  for (const key of Object.keys(spec.named)) {
    finalizeAbsentKey(key, undefined, spec.named[key]);
  }

  if (diagnostics.length > 0) {
    return notOk<readonly PslDiagnostic[]>(diagnostics);
  }

  const value = blindCast<
    Out,
    'The engine builds the output object structurally from the spec; TypeScript cannot relate the dynamically-keyed record to the spec-inferred output type.'
  >(output);
  if (spec.refine !== undefined) {
    const refineDiagnostics = spec.refine(value, leafCtx);
    if (refineDiagnostics.length > 0) {
      return notOk<readonly PslDiagnostic[]>(refineDiagnostics);
    }
  }
  return ok(value);
}

function duplicateDiagnostic(
  key: string,
  storedOrigin: Origin | undefined,
  currentIsNamed: boolean,
  attributeName: string,
  ctx: InterpretCtx,
  arg: AttributeArgAst,
  attributeSpan: PslSpan,
  code: PslDiagnosticCode,
): PslDiagnostic {
  if (currentIsNamed && storedOrigin === 'named') {
    return diagnostic(
      code,
      `Attribute "${attributeName}" received duplicate argument "${key}"`,
      ctx,
      nodePslSpan(arg.syntax, ctx.sourceFile),
    );
  }
  return diagnostic(
    code,
    `Attribute "${attributeName}" received duplicate values for "${key}" both positionally and by name`,
    ctx,
    attributeSpan,
  );
}

function parseArgValue(
  arg: AttributeArgAst,
  argType: ArgType<unknown>,
  ctx: InterpretCtx,
  diagnostics: PslDiagnostic[],
  code: PslDiagnosticCode,
): Result<unknown, readonly PslDiagnostic[]> {
  const value = arg.value();
  if (value === undefined) {
    const missing = diagnostic(
      code,
      'Attribute argument is missing a value',
      ctx,
      nodePslSpan(arg.syntax, ctx.sourceFile),
    );
    diagnostics.push(missing);
    return notOk<readonly PslDiagnostic[]>([missing]);
  }
  const result = argType.parse(value, ctx);
  if (!result.ok) {
    for (const failure of result.failure) diagnostics.push(failure);
  }
  return result;
}

function isOptionalArgType(param: Param<unknown>): param is OptionalArgType<unknown> {
  return 'optional' in param && param.optional === true;
}

function diagnostic(
  code: PslDiagnosticCode,
  message: string,
  ctx: InterpretCtx,
  span: PslSpan,
): PslDiagnostic {
  return { code, message, sourceId: ctx.sourceId, span };
}
