import { Schema } from '@prisma/relational-ir';
import { QueryAST } from '@prisma/sql';
import { OrmQueryAST } from '../ast/types';
import { lowererRegistry } from './registry';

export function lowerRelations(ormAst: OrmQueryAST, ir: Schema): QueryAST {
  const lowerer = lowererRegistry.get(ir.target);

  let baseAst: QueryAST = {
    type: 'select',
    from: ormAst.from,
    ...(ormAst.contractHash && { contractHash: ormAst.contractHash }),
    ...(ormAst.select && { select: ormAst.select }),
    ...(ormAst.where && { where: ormAst.where }),
    ...(ormAst.orderBy && { orderBy: ormAst.orderBy }),
    ...(ormAst.limit && { limit: ormAst.limit }),
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
