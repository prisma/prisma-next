import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { ArrayLiteralAst, type ExpressionAst } from '../../syntax/ast/expressions';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

/** Surface constraints a `list` enforces over its parsed elements. */
export interface ListOptions {
  readonly nonEmpty?: boolean;
  readonly unique?: boolean;
}

/**
 * Lifts an element combinator over a `[…]` array literal into `T[]`, threading
 * each element through `of` and enforcing the optional surface constraints.
 * Element errors are collected and propagated; `nonEmpty` and `unique` add their
 * own diagnostics, anchored to the array and to each offending element.
 */
export function list<T>(of: ArgType<T>, opts?: ListOptions): ArgType<T[]> {
  return {
    kind: 'list',
    label: `${of.label}[]`,
    parse: (arg, ctx): Result<T[], readonly PslDiagnostic[]> => {
      if (!(arg instanceof ArrayLiteralAst)) {
        return notOk([leafDiagnostic(ctx, arg, `Expected a list of ${of.label}`)]);
      }
      const elements = [...arg.elements()];
      const diagnostics: PslDiagnostic[] = [];
      const parsed: { node: ExpressionAst; value: T }[] = [];
      for (const element of elements) {
        const result = of.parse(element, ctx);
        if (result.ok) parsed.push({ node: element, value: result.value });
        else diagnostics.push(...result.failure);
      }
      if (opts?.nonEmpty === true && elements.length === 0) {
        diagnostics.push(leafDiagnostic(ctx, arg, 'Expected a non-empty list'));
      }
      if (opts?.unique === true) {
        const seen = new Set<T>();
        for (const { node, value } of parsed) {
          if (seen.has(value)) diagnostics.push(leafDiagnostic(ctx, node, 'Duplicate list entry'));
          else seen.add(value);
        }
      }
      if (diagnostics.length > 0) return notOk(diagnostics);
      return ok(parsed.map((entry) => entry.value));
    },
  };
}
