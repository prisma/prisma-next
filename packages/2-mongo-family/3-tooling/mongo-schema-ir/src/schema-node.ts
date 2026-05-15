import { IRNodeBase } from '@prisma-next/framework-components/ir';
import type { MongoSchemaVisitor } from './visitor';

export abstract class MongoSchemaIRNode extends IRNodeBase {
  abstract accept<R>(visitor: MongoSchemaVisitor<R>): R;
}
