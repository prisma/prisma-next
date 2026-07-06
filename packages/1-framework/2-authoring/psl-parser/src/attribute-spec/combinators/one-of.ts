import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { blindCast } from '@prisma-next/utils/casts';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import type { ArgType, OutOf } from '../types';
import { leafDiagnostic } from './diagnostic';

/**
 * Because leaves are `Result`-pure — a failed branch returns its diagnostics
 * rather than pushing them into a sink — a discarded alternative leaves no stray
 * errors behind.
 */
export function oneOf<Alts extends readonly [ArgType<unknown>, ...ArgType<unknown>[]]>(
  ...alts: Alts
): ArgType<OutOf<Alts[number]>> {
  const label = alts.map((alt) => alt.label).join(' | ');
  return {
    kind: 'oneOf',
    label,
    parse: (arg, ctx): Result<OutOf<Alts[number]>, readonly PslDiagnostic[]> => {
      for (const alt of alts) {
        const result = alt.parse(arg, ctx);
        if (result.ok) {
          return ok(
            blindCast<
              OutOf<Alts[number]>,
              'The matched value comes from an alternative whose output type is a member of the union, but iterating the tuple widens each element to ArgType<unknown>, erasing that relationship.'
            >(result.value),
          );
        }
      }
      return notOk([leafDiagnostic(ctx, arg, `Expected one of: ${label}`)]);
    },
  };
}
