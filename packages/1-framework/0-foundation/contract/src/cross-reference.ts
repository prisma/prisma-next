import { type } from 'arktype';
import { asNamespaceId, type NamespaceId } from './namespace-id';

export interface CrossReference {
  readonly namespace: NamespaceId;
  readonly model: string;
}

export const CrossReferenceSchema = type({
  '+': 'reject',
  namespace: 'string',
  model: 'string',
});

const DEFAULT_CROSS_REF_NAMESPACE = '__unbound__';

export function crossRef(
  model: string,
  namespace: string = DEFAULT_CROSS_REF_NAMESPACE,
): CrossReference {
  return { namespace: asNamespaceId(namespace), model };
}
