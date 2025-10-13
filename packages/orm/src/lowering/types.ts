import { Schema } from '@prisma/relational-ir';
import { QueryAST } from '@prisma/sql';
import { IncludeNode } from '../ast/types';

export interface LowerContext {
  ir: Schema;
  dialect: 'postgres';
  capabilities: { jsonAgg?: boolean; lateral?: boolean };
}

export interface RelationsLowerer {
  target: string;
  lowerInclude(parentAst: QueryAST, include: IncludeNode, ctx: LowerContext): QueryAST;
}
