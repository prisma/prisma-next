import type { TableRef } from '@prisma-next/sql-relational-core/ast';
import type {
  AnyBinaryBuilder,
  AnyExpressionSource,
  AnyOrderBuilder,
  JoinOnPredicate,
  NestedProjection,
} from '@prisma-next/sql-relational-core/types';
import {
  errorAliasCollision,
  errorAliasPathEmpty,
  errorIncludeAliasNotFound,
  errorInvalidProjectionKey,
  errorInvalidProjectionValue,
  errorProjectionEmpty,
} from '../utils/errors';
import { isColumnBuilder, isExpressionBuilder } from '../utils/guards';

export interface ProjectionState {
  readonly aliases: string[];
  readonly columns: AnyExpressionSource[];
}

export type ProjectionInput = Record<string, AnyExpressionSource | boolean | NestedProjection>;

function generateAlias(path: string[]): string {
  if (path.length === 0) {
    errorAliasPathEmpty();
  }
  return path.join('_');
}

export class AliasTracker {
  private readonly aliases = new Set<string>();
  private readonly aliasToPath = new Map<string, string[]>();

  register(path: string[]): string {
    const alias = generateAlias(path);
    if (this.aliases.has(alias)) {
      const existingPath = this.aliasToPath.get(alias);
      errorAliasCollision(path, alias, existingPath);
    }
    this.aliases.add(alias);
    this.aliasToPath.set(alias, path);
    return alias;
  }

  getPath(alias: string): string[] | undefined {
    return this.aliasToPath.get(alias);
  }

  has(alias: string): boolean {
    return this.aliases.has(alias);
  }
}

export function flattenProjection(
  projection: NestedProjection,
  tracker: AliasTracker,
  currentPath: string[] = [],
): { aliases: string[]; columns: AnyExpressionSource[] } {
  const aliases: string[] = [];
  const columns: AnyExpressionSource[] = [];

  for (const [key, value] of Object.entries(projection)) {
    const path = [...currentPath, key];

    if (isColumnBuilder(value) || isExpressionBuilder(value)) {
      const alias = tracker.register(path);
      aliases.push(alias);
      columns.push(value);
    } else if (typeof value === 'object' && value !== null) {
      const nested = flattenProjection(value, tracker, path);
      aliases.push(...nested.aliases);
      columns.push(...nested.columns);
    } else {
      errorInvalidProjectionValue(path);
    }
  }

  return { aliases, columns };
}

export function buildProjectionState(
  _table: TableRef,
  projection: ProjectionInput,
  includes?: ReadonlyArray<{
    readonly alias: string;
    readonly table: TableRef;
    readonly on: JoinOnPredicate;
    readonly childProjection: ProjectionState;
    readonly childWhere?: AnyBinaryBuilder;
    readonly childOrderBy?: AnyOrderBuilder;
    readonly childLimit?: number;
  }>,
): ProjectionState {
  const tracker = new AliasTracker();
  const aliases: string[] = [];
  const columns: AnyExpressionSource[] = [];

  for (const [key, value] of Object.entries(projection)) {
    if (value === true) {
      const matchingInclude = includes?.find((inc) => inc.alias === key);
      if (!matchingInclude) {
        errorIncludeAliasNotFound(key);
      }
      aliases.push(key);
      columns.push({
        kind: 'column',
        table: matchingInclude.table.name,
        column: '',
        columnMeta: {
          nativeType: 'jsonb',
          codecId: 'core/json@1',
          nullable: true,
        },
        toExpr() {
          return { kind: 'col', table: matchingInclude.table.name, column: '' };
        },
      } as AnyExpressionSource);
    } else if (isColumnBuilder(value) || isExpressionBuilder(value)) {
      const alias = tracker.register([key]);
      aliases.push(alias);
      columns.push(value);
    } else if (typeof value === 'object' && value !== null) {
      const nested = flattenProjection(value as NestedProjection, tracker, [key]);
      aliases.push(...nested.aliases);
      columns.push(...nested.columns);
    } else {
      errorInvalidProjectionKey(key);
    }
  }

  if (aliases.length === 0) {
    errorProjectionEmpty();
  }

  return { aliases, columns };
}
