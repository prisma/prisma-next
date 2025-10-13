import { Schema } from '@prisma/relational-ir';
import { QueryAST } from '@prisma/sql';
import { OrmQueryAST } from '../ast/types';
import { lowererRegistry } from './registry';

export function lowerRelations(ormAst: OrmQueryAST, ir: Schema): QueryAST {
  const lowerer = lowererRegistry.get(ir.target);

  let baseAst: QueryAST = {
    type: 'select',
    from: ormAst.from,
    contractHash: ormAst.contractHash,
    select: ormAst.select,
    where: ormAst.where,
    orderBy: ormAst.orderBy,
    limit: ormAst.limit,
  };

  for (const include of ormAst.includes ?? []) {
    baseAst = lowerer.lowerInclude(baseAst, include, {
      ir,
      dialect: ir.target as 'postgres',
      capabilities: ir.capabilities?.postgres ?? {},
    });
  }

  return baseAst;
}
