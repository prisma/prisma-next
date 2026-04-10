import type { MongoSchemaVisitor } from './visitor';

export abstract class MongoSchemaNode {
  abstract readonly kind: string;

  abstract accept<R>(visitor: MongoSchemaVisitor<R>): R;

  protected freeze(): void {
    Object.freeze(this);
  }
}
