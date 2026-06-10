import type {
  AuthoringEntityTypeNamespace,
  AuthoringPslBlockDescriptorNamespace,
} from '@prisma-next/framework-components/authoring';

export const sqlFamilyAuthoringEntityTypes = {
  enum2: {
    kind: 'entity',
    discriminator: 'enum2',
    output: {
      factory: (_input: never): null => null,
    },
  },
} as const satisfies AuthoringEntityTypeNamespace;

export const sqlFamilyPslBlockDescriptors = {
  enum2: {
    kind: 'pslBlock',
    keyword: 'enum2',
    discriminator: 'enum2',
    name: { required: true },
    parameters: {},
    allowAdditionalParameters: true,
  },
} as const satisfies AuthoringPslBlockDescriptorNamespace;
