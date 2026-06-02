import { blindCast } from '@prisma-next/utils/casts';
import { type Type, type } from 'arktype';
import { asNamespaceId, type NamespaceId } from './namespace-id';

export interface CrossReference {
  readonly namespace: NamespaceId;
  readonly model: string;
}

export const CrossReferenceSchema = /* @__PURE__ */ blindCast<
  Type<CrossReference>,
  'namespace is validated as string at runtime and branded to NamespaceId by asNamespaceId in crossRef(); the schema accepts plain strings but the public type reflects the branded shape'
>(
  /* @__PURE__ */ type({
    '+': 'reject',
    namespace: 'string',
    model: 'string',
  }),
);

const DEFAULT_CROSS_REF_NAMESPACE = '__unbound__';

export function crossRef(
  model: string,
  namespace: string = DEFAULT_CROSS_REF_NAMESPACE,
): CrossReference {
  return { namespace: asNamespaceId(namespace), model };
}
