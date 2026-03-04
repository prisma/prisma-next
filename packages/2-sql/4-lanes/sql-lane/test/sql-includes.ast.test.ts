import type { SelectAst } from '@prisma-next/sql-relational-core/ast';
import {
  createColumnRef,
  createDerivedTableSource,
  createJoin,
  createProjectionItem,
  createSelectAstBuilder,
  createSubqueryExpr,
  createTableSource,
  createTrueExpr,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';

describe('Include AST modeling', () => {
  it('models include-style lateral join with a derived source', () => {
    const includeAggregate = createSelectAstBuilder(createTableSource('post'))
      .project([createProjectionItem('posts', createColumnRef('post', 'id'))])
      .build();

    const selectAst: SelectAst = createSelectAstBuilder(createTableSource('user'))
      .project([
        createProjectionItem('id', createColumnRef('user', 'id')),
        createProjectionItem('posts', createColumnRef('posts_lateral', 'posts')),
      ])
      .joins([
        createJoin(
          'left',
          createDerivedTableSource('posts_lateral', includeAggregate),
          createTrueExpr(),
          true,
        ),
      ])
      .build();

    const join = selectAst.joins?.[0];
    expect(join).toBeDefined();
    expect(join?.lateral).toBe(true);
    expect(join?.source.kind).toBe('derivedTable');
  });

  it('models include-style correlated projection via subquery expression', () => {
    const childQuery = createSelectAstBuilder(createTableSource('post'))
      .project([createProjectionItem('posts', createColumnRef('post', 'id'))])
      .build();

    const selectAst: SelectAst = createSelectAstBuilder(createTableSource('user'))
      .project([
        createProjectionItem('id', createColumnRef('user', 'id')),
        createProjectionItem('posts', createSubqueryExpr(childQuery)),
      ])
      .build();

    const posts = selectAst.project.find((item) => item.alias === 'posts');
    expect(posts?.expr.kind).toBe('subquery');
  });
});
