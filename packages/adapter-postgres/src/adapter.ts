import type { Adapter, AdapterProfile, LowererContext } from '@prisma-next/sql-target';
import { createCodecRegistry } from '@prisma-next/sql-target';
import { codecDefinitions } from './codecs';
import type {
  BinaryExpr,
  ColumnRef,
  JoinAst,
  ParamRef,
  PostgresAdapterOptions,
  PostgresContract,
  PostgresLoweredStatement,
  SelectAst,
} from './types';

const defaultCapabilities = Object.freeze({
  postgres: {
    orderBy: true,
    limit: true,
  },
});

class PostgresAdapterImpl
  implements Adapter<SelectAst, PostgresContract, PostgresLoweredStatement>
{
  readonly profile: AdapterProfile<'postgres'>;
  private readonly codecRegistry = (() => {
    const registry = createCodecRegistry();
    for (const definition of Object.values(codecDefinitions)) {
      registry.register(definition.codec);
    }
    return registry;
  })();

  constructor(options?: PostgresAdapterOptions) {
    this.profile = Object.freeze({
      id: options?.profileId ?? 'postgres/default@1',
      target: 'postgres',
      capabilities: defaultCapabilities,
      codecs: () => this.codecRegistry,
    });
  }

  lower(ast: SelectAst, context: LowererContext<PostgresContract>) {
    const sql = renderSelect(ast);
    const params = context.params ? [...context.params] : [];

    return Object.freeze({
      profileId: this.profile.id,
      body: Object.freeze({ sql, params }),
    });
  }
}

function renderSelect(ast: SelectAst): string {
  const selectClause = `SELECT ${renderProjection(ast)}`;
  const fromClause = `FROM ${quoteIdentifier(ast.from.name)}`;

  const joinsClause = ast.joins?.length ? ast.joins.map((join) => renderJoin(join)).join(' ') : '';

  const whereClause = ast.where ? ` WHERE ${renderBinary(ast.where)}` : '';
  const orderClause = ast.orderBy?.length
    ? ` ORDER BY ${ast.orderBy
        .map((order) => `${renderColumn(order.expr)} ${order.dir.toUpperCase()}`)
        .join(', ')}`
    : '';
  const limitClause = typeof ast.limit === 'number' ? ` LIMIT ${ast.limit}` : '';

  return `${selectClause} ${fromClause}${joinsClause ? ` ${joinsClause}` : ''}${whereClause}${orderClause}${limitClause}`.trim();
}

function renderProjection(ast: SelectAst): string {
  return ast.project
    .map((item) => {
      const column = renderColumn(item.expr);
      const alias = quoteIdentifier(item.alias);
      return `${column} AS ${alias}`;
    })
    .join(', ');
}

function renderBinary(expr: BinaryExpr): string {
  const left = renderColumn(expr.left);
  const right = renderParam(expr.right);
  return `${left} = ${right}`;
}

function renderColumn(ref: ColumnRef): string {
  return `${quoteIdentifier(ref.table)}.${quoteIdentifier(ref.column)}`;
}

function renderParam(ref: ParamRef): string {
  return `$${ref.index}`;
}

function renderJoin(join: JoinAst): string {
  const joinType = join.joinType.toUpperCase();
  const table = quoteIdentifier(join.table.name);
  const onClause = renderJoinOn(join.on);
  return `${joinType} JOIN ${table} ON ${onClause}`;
}

function renderJoinOn(on: JoinAst['on']): string {
  if (on.kind === 'eqCol') {
    const left = renderColumn(on.left);
    const right = renderColumn(on.right);
    return `${left} = ${right}`;
  }
  throw new Error(`Unsupported join ON expression kind: ${on.kind}`);
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function createPostgresAdapter(options?: PostgresAdapterOptions) {
  return Object.freeze(new PostgresAdapterImpl(options));
}
