import type {
  MongoAndExpr,
  MongoExistsExpr,
  MongoExprFilter,
  MongoFieldFilter,
  MongoFilterExpr,
  MongoFilterVisitor,
  MongoNotExpr,
  MongoOrExpr,
} from '@prisma-next/mongo-query-ast/execution';
import type { MongoValue } from '@prisma-next/mongo-value';

function getNestedField(doc: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = doc;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEquals(val, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
      if (aKeys[i] !== bKeys[i]) return false;
      if (!deepEquals(aObj[aKeys[i]!], bObj[bKeys[i]!])) return false;
    }
    return true;
  }

  return false;
}

function evaluateFieldOp(op: string, actual: unknown, expected: MongoValue): boolean {
  switch (op) {
    case '$eq':
      return deepEquals(actual, expected);
    case '$ne':
      return !deepEquals(actual, expected);
    case '$gt':
      return typeof actual === typeof expected && (actual as number) > (expected as number);
    case '$gte':
      return typeof actual === typeof expected && (actual as number) >= (expected as number);
    case '$lt':
      return typeof actual === typeof expected && (actual as number) < (expected as number);
    case '$lte':
      return typeof actual === typeof expected && (actual as number) <= (expected as number);
    case '$in':
      return Array.isArray(expected) && expected.some((v) => deepEquals(actual, v));
    default:
      throw new Error(`Unsupported filter operator in migration check: ${op}`);
  }
}

export class FilterEvaluator implements MongoFilterVisitor<boolean> {
  private doc: Record<string, unknown> = {};

  evaluate(filter: MongoFilterExpr, doc: Record<string, unknown>): boolean {
    this.doc = doc;
    return filter.accept(this);
  }

  field(expr: MongoFieldFilter): boolean {
    const value = getNestedField(this.doc, expr.field);
    return evaluateFieldOp(expr.op, value, expr.value);
  }

  and(expr: MongoAndExpr): boolean {
    return expr.exprs.every((child) => child.accept(this));
  }

  or(expr: MongoOrExpr): boolean {
    return expr.exprs.some((child) => child.accept(this));
  }

  not(expr: MongoNotExpr): boolean {
    return !expr.expr.accept(this);
  }

  exists(expr: MongoExistsExpr): boolean {
    const has = getNestedField(this.doc, expr.field) !== undefined;
    return expr.exists ? has : !has;
  }

  expr(_expr: MongoExprFilter): boolean {
    throw new Error('Aggregation expression filters are not supported in migration checks');
  }
}
