import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { ColumnDefault, ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import type { PslSpan } from '@prisma-next/psl-parser';

interface DefaultFunctionArgument {
  readonly raw: string;
  readonly span: PslSpan;
}

export interface ParsedDefaultFunctionCall {
  readonly name: string;
  readonly raw: string;
  readonly args: readonly DefaultFunctionArgument[];
  readonly span: PslSpan;
}

export interface DefaultFunctionLoweringContext {
  readonly sourceId: string;
  readonly modelName: string;
  readonly fieldName: string;
  readonly columnCodecId?: string;
}

type LoweredDefaultValue =
  | { readonly kind: 'storage'; readonly defaultValue: ColumnDefault }
  | { readonly kind: 'execution'; readonly generated: ExecutionMutationDefaultValue };

type LoweredDefaultResult =
  | { readonly ok: true; readonly value: LoweredDefaultValue }
  | { readonly ok: false; readonly diagnostic: ContractSourceDiagnostic };

export type DefaultFunctionLoweringHandler = (input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}) => LoweredDefaultResult;

export interface DefaultFunctionRegistryEntry {
  readonly lower: DefaultFunctionLoweringHandler;
  readonly usageSignatures?: readonly string[];
}

export type DefaultFunctionRegistry = ReadonlyMap<string, DefaultFunctionRegistryEntry>;

export interface MutationDefaultGeneratorDescriptor {
  readonly id: string;
  readonly applicableCodecIds: readonly string[];
  readonly resolveGeneratedColumnDescriptor?: (input: {
    readonly generated: ExecutionMutationDefaultValue;
  }) =>
    | {
        readonly codecId: string;
        readonly nativeType: string;
        readonly typeRef?: string;
        readonly typeParams?: Record<string, unknown>;
      }
    | undefined;
}

export interface ControlMutationDefaultEntry {
  readonly lower: (input: {
    readonly call: ParsedDefaultFunctionCall;
    readonly context: DefaultFunctionLoweringContext;
  }) => unknown;
  readonly usageSignatures?: readonly string[];
}

export type ControlMutationDefaultRegistry = ReadonlyMap<string, ControlMutationDefaultEntry>;

export interface ControlMutationDefaults {
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly generatorDescriptors: readonly MutationDefaultGeneratorDescriptor[];
}

function resolveSpanPositionFromBase(
  base: PslSpan,
  text: string,
  offset: number,
): PslSpan['start'] {
  const safeOffset = Math.min(Math.max(0, offset), text.length);
  let line = base.start.line;
  let column = base.start.column;

  for (let index = 0; index < safeOffset; index += 1) {
    const character = text[index] ?? '';
    if (character === '\r') {
      if (text[index + 1] === '\n' && index + 1 < safeOffset) {
        index += 1;
      }
      line += 1;
      column = 1;
      continue;
    }
    if (character === '\n') {
      line += 1;
      column = 1;
      continue;
    }
    column += 1;
  }

  return {
    offset: base.start.offset + safeOffset,
    line,
    column,
  };
}

function createSpanFromBase(
  base: PslSpan,
  startOffset: number,
  endOffset: number,
  text: string,
): PslSpan {
  const safeStart = Math.max(0, Math.min(startOffset, text.length));
  const safeEnd = Math.max(safeStart, Math.min(endOffset, text.length));
  return {
    start: resolveSpanPositionFromBase(base, text, safeStart),
    end: resolveSpanPositionFromBase(base, text, safeEnd),
  };
}

function splitTopLevelArgs(raw: string): Array<{ raw: string; start: number; end: number }> {
  if (raw.trim().length === 0) {
    return [];
  }

  const parts: Array<{ raw: string; start: number; end: number }> = [];
  let depthParen = 0;
  let depthBracket = 0;
  let quote: '"' | "'" | null = null;
  let start = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index] ?? '';
    if (quote) {
      if (character === quote && raw[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === '(') {
      depthParen += 1;
      continue;
    }
    if (character === ')') {
      depthParen = Math.max(0, depthParen - 1);
      continue;
    }
    if (character === '[') {
      depthBracket += 1;
      continue;
    }
    if (character === ']') {
      depthBracket = Math.max(0, depthBracket - 1);
      continue;
    }

    if (character === ',' && depthParen === 0 && depthBracket === 0) {
      parts.push({
        raw: raw.slice(start, index),
        start,
        end: index,
      });
      start = index + 1;
    }
  }

  parts.push({
    raw: raw.slice(start),
    start,
    end: raw.length,
  });

  return parts;
}

export function parseDefaultFunctionCall(
  expression: string,
  expressionSpan: PslSpan,
): ParsedDefaultFunctionCall | undefined {
  const trimmed = expression.trim();
  const leadingWhitespace = expression.length - expression.trimStart().length;
  const trailingWhitespace = expression.length - expression.trimEnd().length;
  const contentEnd = expression.length - trailingWhitespace;

  const openParen = trimmed.indexOf('(');
  const closeParen = trimmed.lastIndexOf(')');
  if (openParen <= 0 || closeParen !== trimmed.length - 1) {
    return undefined;
  }

  const functionName = trimmed.slice(0, openParen).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(functionName)) {
    return undefined;
  }

  const functionArgsRaw = trimmed.slice(openParen + 1, closeParen);
  const parts = splitTopLevelArgs(functionArgsRaw);
  const args: DefaultFunctionArgument[] = [];
  for (const part of parts) {
    const raw = part.raw.trim();
    if (raw.length === 0) {
      return undefined;
    }
    const leadingPartWhitespace = part.raw.length - part.raw.trimStart().length;
    const argStart = leadingWhitespace + openParen + 1 + part.start + leadingPartWhitespace;
    const argEnd = argStart + raw.length;
    args.push({
      raw,
      span: createSpanFromBase(expressionSpan, argStart, argEnd, expression),
    });
  }

  const functionStart = leadingWhitespace;
  const functionEnd = contentEnd;
  return {
    name: functionName,
    raw: trimmed,
    args,
    span: createSpanFromBase(expressionSpan, functionStart, functionEnd, expression),
  };
}

function formatSupportedFunctionList(registry: ControlMutationDefaultRegistry): string {
  const signatures = Array.from(registry.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([functionName, entry]) => {
      const usageSignatures = entry.usageSignatures?.filter((signature) => signature.length > 0);
      return usageSignatures && usageSignatures.length > 0
        ? usageSignatures
        : [`${functionName}()`];
    });
  return signatures.length > 0 ? signatures.join(', ') : 'none';
}

export function lowerDefaultFunctionWithRegistry(input: {
  readonly call: ParsedDefaultFunctionCall;
  readonly registry: ControlMutationDefaultRegistry;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  const entry = input.registry.get(input.call.name);
  if (entry) {
    return entry.lower({ call: input.call, context: input.context }) as LoweredDefaultResult;
  }
  const supportedFunctionList = formatSupportedFunctionList(input.registry);

  return {
    ok: false,
    diagnostic: {
      code: 'PSL_UNKNOWN_DEFAULT_FUNCTION',
      message: `Default function "${input.call.name}" is not supported in SQL PSL provider v1. Supported functions: ${supportedFunctionList}.`,
      sourceId: input.context.sourceId,
      span: input.call.span,
    },
  };
}
