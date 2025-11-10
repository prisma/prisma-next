import type { ParamDescriptor } from '@prisma-next/contract/types';

export function createParamDescriptor(args: {
  name: string;
  table: string;
  column: string;
  type?: string;
  nullable: boolean;
}): ParamDescriptor {
  return {
    name: args.name,
    source: 'dsl',
    refs: { table: args.table, column: args.column },
    ...(args.type ? { type: args.type } : {}),
    nullable: args.nullable,
  };
}
