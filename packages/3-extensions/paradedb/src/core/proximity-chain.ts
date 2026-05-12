import {
  type AnyExpression,
  LiteralExpr,
  OperationExpr,
} from '@prisma-next/sql-relational-core/ast';
import { type Expression, toExpr } from '@prisma-next/sql-relational-core/expression';

const TEXT = 'pg/text@1' as const;

export type ProximityTerm = unknown;

export interface ProximityWithinOptions {
  readonly ordered?: boolean;
}

interface ProximityStep {
  readonly distance: number;
  readonly term: ProximityTerm;
  readonly ordered: boolean;
}

// https://docs.paradedb.com/documentation/full-text/proximity
export class ParadeDbProximityChain
  implements Expression<{ codecId: 'pg/text@1'; nullable: false }>
{
  readonly returnType = { codecId: TEXT, nullable: false } as const;

  private readonly start: ProximityTerm;
  private readonly steps: readonly ProximityStep[];

  constructor(start: ProximityTerm, steps: readonly ProximityStep[] = []) {
    this.start = start;
    this.steps = steps;
  }

  within(
    distance: number,
    term: ProximityTerm,
    options?: ProximityWithinOptions,
  ): ParadeDbProximityChain {
    if (!Number.isInteger(distance) || distance < 0) {
      throw new Error(
        `paradeDbProximity.within: distance must be a non-negative integer; got ${String(distance)}`,
      );
    }
    return new ParadeDbProximityChain(this.start, [
      ...this.steps,
      { distance, term, ordered: options?.ordered === true },
    ]);
  }

  buildAst(): AnyExpression {
    if (this.steps.length === 0) {
      throw new Error(
        'paradeDbProximity: chain must have at least one .within(distance, term) step',
      );
    }
    const args: AnyExpression[] = [toExpr(this.start, TEXT)];
    let template = '({{self}}';
    this.steps.forEach((step, i) => {
      const op = step.ordered ? '##>' : '##';
      args.push(LiteralExpr.of(step.distance));
      args.push(toExpr(step.term, TEXT));
      template += ` ${op} {{arg${2 * i}}} ${op} {{arg${2 * i + 1}}}`;
    });
    template += ')';
    const [self, ...rest] = args;
    if (!self) {
      throw new Error('paradeDbProximity: invariant violation — empty args');
    }
    return new OperationExpr({
      method: 'paradeDbProximity',
      self,
      args: rest.length > 0 ? rest : undefined,
      returns: this.returnType,
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        template,
      },
    });
  }
}
