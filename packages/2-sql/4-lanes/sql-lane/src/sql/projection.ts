import type { TableRef } from '@prisma-next/sql-relational-core/ast';
import { ColumnRef } from '@prisma-next/sql-relational-core/ast';
import type { AnyExpressionSource, NestedProjection } from '@prisma-next/sql-relational-core/types';
import { isExpressionSource } from '@prisma-next/sql-relational-core/utils/guards';
import type { ProjectionInput } from '../types/internal';
import {
  errorAliasCollision,
  errorAliasPathEmpty,
  errorIncludeAliasNotFound,
  errorInvalidProjectionKey,
  errorInvalidProjectionValue,
  errorProjectionEmpty,
} from '../utils/errors';
import type { IncludeState, ProjectionState } from '../utils/state';

export function generateAlias(path: string[]): string {
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

    if (isExpressionSource(value)) {
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
  includes?: ReadonlyArray<IncludeState>,
): ProjectionState {
  const tracker = new AliasTracker();
  const aliases: string[] = [];
  const columns: AnyExpressionSource[] = [];

  for (const [key, value] of Object.entries(projection)) {
    if (value === true) {
      // Boolean true marks an include projection alias. The concrete expression
      // is stitched during include AST construction.
      const matchingInclude = includes?.find((inc) => inc.alias === key);
      if (!matchingInclude) {
        errorIncludeAliasNotFound(key);
      }
      aliases.push(key);
      columns.push({
        kind: 'column',
        table: matchingInclude.table.name,
        column: '',
        columnMeta: { nativeType: 'jsonb', codecId: 'core/json@1', nullable: true },
        toExpr: () => ColumnRef.of(matchingInclude.table.name, ''),
      } as AnyExpressionSource);
    } else if (isExpressionSource(value)) {
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
