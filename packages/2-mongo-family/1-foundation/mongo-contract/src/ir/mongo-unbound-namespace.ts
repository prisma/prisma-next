import {
  freezeNode,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';

export class MongoUnboundNamespace extends NamespaceBase {
  static readonly instance: MongoUnboundNamespace = new MongoUnboundNamespace();

  readonly id = UNBOUND_NAMESPACE_ID;
  readonly entries: Readonly<Record<string, Readonly<Record<string, unknown>>>> = Object.freeze({
    collection: Object.freeze({}),
  });
  declare readonly kind: string;

  private constructor() {
    super();
    Object.defineProperty(this, 'kind', {
      value: 'mongo-namespace',
      writable: false,
      enumerable: false,
      configurable: true,
    });
    freezeNode(this);
  }
}
