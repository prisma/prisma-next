import type { DiffableNode } from '@prisma-next/framework-components/control';
import { IRNodeBase } from '@prisma-next/framework-components/ir';
import type { MongoSchemaVisitor } from './visitor';

/**
 * Every concrete Mongo schema-IR node also implements the framework's
 * `DiffableNode` interface, so a node can be carried as the `expected`/
 * `actual` payload of a `SchemaDiffIssue`. Mongo's own diff (`diffMongoSchemas`)
 * still hand-rolls its comparisons and never calls `isEqualTo`/`children` —
 * this conformance exists so an issue can carry the real collection/index/
 * validator/options node it concerns, not a coordinate string.
 */
export abstract class MongoSchemaIRNode extends IRNodeBase implements DiffableNode {
  abstract readonly id: string;
  abstract accept<R>(visitor: MongoSchemaVisitor<R>): R;

  isEqualTo(other: DiffableNode): boolean {
    return this.id === other.id;
  }

  children(): readonly DiffableNode[] {
    return [];
  }
}
