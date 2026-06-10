import type { AuthoringPslBlockDescriptorNamespace } from '@prisma-next/framework-components/authoring';

export const sqlFamilyPslBlockDescriptors = {
  enum2: {
    kind: 'pslBlock',
    keyword: 'enum2',
    discriminator: 'enum2',
    name: { required: true },
    parameters: {},
    allowAdditionalParameters: true,
    interpreterLowered: true,
  },
} as const satisfies AuthoringPslBlockDescriptorNamespace;
