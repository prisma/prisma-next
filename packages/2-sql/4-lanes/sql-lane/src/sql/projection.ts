import type { TableRef } from '@prisma-next/sql-relational-core/ast';
import { isExpressionSource } from '@prisma-next/sql-relational-core/guards';
import type { AnyExpressionSource, NestedProjection } from '@prisma-next/sql-relational-core/types';
import type { ProjectionInput } from '../types/internal.ts';
import {
  errorAliasCollision,
  errorAliasPathEmpty,
  errorIncludeAliasNotFound,
  errorInvalidProjectionKey,
  errorInvalidProjectionValue,
  errorProjectionEmpty,
} from '../utils/errors.ts';
import type { IncludeState, ProjectionState } from '../utils/state.ts';

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
      // Boolean true means this is an include reference
      const matchingInclude = includes?.find((inc) => inc.alias === key);
      if (!matchingInclude) {
        errorIncludeAliasNotFound(key);
      }
      // For include references, we track the alias but use a placeholder object
      // The actual handling happens in AST building where we create includeRef
      aliases.push(key);
      columns.push({
        kind: 'column',
        table: matchingInclude.table.name,
        column: '',
        columnMeta: { nativeType: 'jsonb', codecId: 'core/json@1', nullable: true },
        toExpr: () => ({ kind: 'col', table: matchingInclude.table.name, column: '' }),
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
