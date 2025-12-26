import type { ParamDescriptor } from '@prisma-next/contract/types';

export function createParamDescriptor(args: {
  name: string;
  table: string;
  column: string;
  codecId?: string;
  nativeType?: string;
  nullable: boolean;
}): ParamDescriptor {
  return {
    name: args.name,
    source: 'dsl',
    refs: { table: args.table, column: args.column },
    ...(args.codecId ? { codecId: args.codecId } : {}),
    ...(args.nativeType ? { nativeType: args.nativeType } : {}),
    nullable: args.nullable,
  };
}
