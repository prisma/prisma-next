import { SchemaNodeBase } from '@prisma-next/framework-components/ir';
import type { MongoSchemaVisitor } from './visitor';

export abstract class MongoSchemaNode extends SchemaNodeBase {
  abstract accept<R>(visitor: MongoSchemaVisitor<R>): R;
}
