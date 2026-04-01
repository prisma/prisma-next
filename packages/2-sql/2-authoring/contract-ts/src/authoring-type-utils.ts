import type {
  AuthoringArgumentDescriptor,
  AuthoringFieldPresetDescriptor,
} from '@prisma-next/contract/framework-components';

export type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;

export type NamedConstraintSpec<Name extends string | undefined = string | undefined> = {
  readonly name?: Name;
};

export type NamedConstraintState<
  Enabled extends boolean,
  Name extends string | undefined = undefined,
> = Enabled extends true ? NamedConstraintSpec<Name> : undefined;

export type OptionalObjectArgumentKeys<
  Properties extends Record<string, AuthoringArgumentDescriptor>,
> = {
  readonly [K in keyof Properties]: Properties[K] extends { readonly optional: true } ? K : never;
}[keyof Properties];

export type ObjectArgumentType<Properties extends Record<string, AuthoringArgumentDescriptor>> = {
  readonly [K in Exclude<
    keyof Properties,
    OptionalObjectArgumentKeys<Properties>
  >]: ArgTypeFromDescriptor<Properties[K]>;
} & {
  readonly [K in OptionalObjectArgumentKeys<Properties>]?: ArgTypeFromDescriptor<Properties[K]>;
};

export type ArgTypeFromDescriptor<Arg extends AuthoringArgumentDescriptor> = Arg extends {
  readonly kind: 'string';
}
  ? string
  : Arg extends { readonly kind: 'number' }
    ? number
    : Arg extends { readonly kind: 'stringArray' }
      ? readonly string[]
      : Arg extends {
            readonly kind: 'object';
            readonly properties: infer Properties extends Record<
              string,
              AuthoringArgumentDescriptor
            >;
          }
        ? ObjectArgumentType<Properties>
        : never;

export type TupleFromArgumentDescriptors<Args extends readonly AuthoringArgumentDescriptor[]> = {
  readonly [K in keyof Args]: Args[K] extends AuthoringArgumentDescriptor
    ? ArgTypeFromDescriptor<Args[K]>
    : never;
};

export type SupportsNamedConstraintOptions<Descriptor extends AuthoringFieldPresetDescriptor> =
  Descriptor['output'] extends { readonly id: true }
    ? true
    : Descriptor['output'] extends { readonly unique: true }
      ? true
      : false;
