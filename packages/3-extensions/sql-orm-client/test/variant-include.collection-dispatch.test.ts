import type { ProjectionItem } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import {
  buildMixedPolyContract,
  createMockRuntime,
  getTestContext,
  isSelectAst,
  type MockRuntime,
} from './helpers';

interface RuntimeRows {
  toArray(): Promise<Record<string, unknown>[]>;
}

interface RuntimeCollection {
  variant(name: string): RuntimeCollection;
  select(...fields: string[]): RuntimeCollection;
  include(
    relationName: string,
    refine: (collection: RuntimeCollection) => RuntimeCollection,
  ): RuntimeCollection;
  all(): RuntimeRows;
}

function createVariantTaskCollection(): {
  readonly tasks: RuntimeCollection;
  readonly runtime: MockRuntime;
} {
  const contract = buildMixedPolyContract();
  const context = { ...getTestContext(), contract };
  const runtime = createMockRuntime();
  const collection = new Collection({ runtime, context }, 'Task', { namespaceId: 'public' });
  return { tasks: collection as unknown as RuntimeCollection, runtime };
}

function selectedTaskWithAssignee(tasks: RuntimeCollection, variantName: string): RuntimeRows {
  return tasks
    .variant(variantName)
    .select('id', 'title', 'type')
    .include('assignee', (assignee) => assignee.select('id', 'name'))
    .all();
}

function projectionAliases(runtime: MockRuntime): string[] {
  const ast = runtime.executions[0]?.plan.ast;
  expect(isSelectAst(ast)).toBe(true);
  if (!isSelectAst(ast)) {
    throw new Error('Expected variant include dispatch to execute a select plan');
  }
  return ast.projection.map((item: ProjectionItem) => item.alias);
}

describe('variant-owned include dispatch', () => {
  it('maps the whole MTI result and keeps only the existing broad MTI projections', async () => {
    const { tasks, runtime } = createVariantTaskCollection();
    runtime.setNextResults([
      [
        {
          id: 2,
          title: 'Dark mode',
          type: 'feature',
          features__priority: 7,
          features__assignee_id: 42,
          assignee: '[{"id":42,"name":"Ada"}]',
        },
      ],
    ]);

    const rows = await selectedTaskWithAssignee(tasks, 'Feature').toArray();

    // TML-2783 remains out of scope: MTI variant fields are still broadly
    // projected even though the parent has an explicit base-field selection.
    expect(rows).toEqual([
      {
        id: 2,
        title: 'Dark mode',
        type: 'feature',
        priority: 7,
        assigneeId: 42,
        assignee: { id: 42, name: 'Ada' },
      },
    ]);
    expect(projectionAliases(runtime)).toEqual([
      'id',
      'title',
      'type',
      'features__priority',
      'features__assignee_id',
      'assignee',
    ]);
  });

  it('maps the whole STI result without projecting an unselected variant join key', async () => {
    const { tasks, runtime } = createVariantTaskCollection();
    runtime.setNextResults([
      [
        {
          id: 1,
          title: 'Crash',
          type: 'bug',
          assignee: '[{"id":11,"name":"Grace"}]',
        },
      ],
    ]);

    const rows = await selectedTaskWithAssignee(tasks, 'Bug').toArray();

    expect(rows).toEqual([
      {
        id: 1,
        title: 'Crash',
        type: 'bug',
        assignee: { id: 11, name: 'Grace' },
      },
    ]);
    expect(projectionAliases(runtime)).toEqual(['id', 'title', 'type', 'assignee']);
  });
});
