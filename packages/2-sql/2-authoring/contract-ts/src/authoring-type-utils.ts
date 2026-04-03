import type {
  AuthoringArgumentDescriptor,
  AuthoringFieldPresetDescriptor,
} from '@prisma-next/framework-components/authoring';
import type { ScalarFieldBuilder, ScalarFieldState } from './staged-contract-dsl';

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

export type ResolveTemplateValue<Template, Args extends readonly unknown[]> = Template extends {
  readonly kind: 'arg';
  readonly index: infer Index extends number;
  readonly path?: infer Path extends readonly string[] | undefined;
  readonly default?: infer Default;
}
  ? ResolveTemplateArgValue<Args[Index], Path, Default, Args>
  : Template extends readonly unknown[]
    ? { readonly [K in keyof Template]: ResolveTemplateValue<Template[K], Args> }
    : Template extends Record<string, unknown>
      ? { readonly [K in keyof Template]: ResolveTemplateValue<Template[K], Args> }
      : Template;

type ResolveTemplatePathValue<
  Value,
  Path extends readonly string[] | undefined,
> = Path extends readonly [infer Segment extends string, ...infer Rest extends readonly string[]]
  ? Segment extends keyof NonNullable<Value>
    ? ResolveTemplatePathValue<NonNullable<Value>[Segment], Rest>
    : never
  : Value;

type ResolveTemplateDefaultValue<
  Value,
  Default,
  Args extends readonly unknown[],
> = Default extends undefined
  ? Value
  : [Value] extends [never]
    ? ResolveTemplateValue<Default, Args>
    : undefined extends Value
      ? Exclude<Value, undefined> | ResolveTemplateValue<Default, Args>
      : Value;

type ResolveTemplateArgValue<
  Value,
  Path extends readonly string[] | undefined,
  Default,
  Args extends readonly unknown[],
> = ResolveTemplateDefaultValue<ResolveTemplatePathValue<Value, Path>, Default, Args>;

export type FieldBuilderFromPresetDescriptor<
  Descriptor extends AuthoringFieldPresetDescriptor,
  Args extends readonly unknown[] = readonly [],
  ConstraintName extends string | undefined = undefined,
> = ScalarFieldBuilder<
  ScalarFieldState<
    ResolveTemplateValue<Descriptor['output']['codecId'], Args> extends string
      ? ResolveTemplateValue<Descriptor['output']['codecId'], Args>
      : string,
    undefined,
    ResolveTemplateValue<Descriptor['output']['nullable'], Args> extends true ? true : false,
    undefined,
    NamedConstraintState<
      ResolveTemplateValue<Descriptor['output']['id'], Args> extends true ? true : false,
      ConstraintName
    >,
    NamedConstraintState<
      ResolveTemplateValue<Descriptor['output']['unique'], Args> extends true ? true : false,
      ConstraintName
    >
  >
>;

export type FieldHelperFunctionWithoutNamedConstraint<
  Descriptor extends AuthoringFieldPresetDescriptor,
> = Descriptor extends {
  readonly args: infer Args extends readonly AuthoringArgumentDescriptor[];
}
  ? <const Params extends TupleFromArgumentDescriptors<Args>>(
      ...args: Params
    ) => FieldBuilderFromPresetDescriptor<Descriptor, Params>
  : () => FieldBuilderFromPresetDescriptor<Descriptor, readonly []>;

export type FieldHelperFunctionWithNamedConstraint<
  Descriptor extends AuthoringFieldPresetDescriptor,
> = Descriptor extends {
  readonly args: infer Args extends readonly AuthoringArgumentDescriptor[];
}
  ? <
      const Params extends TupleFromArgumentDescriptors<Args>,
      const Name extends string | undefined = undefined,
    >(
      ...args: [...params: Params, options?: NamedConstraintSpec<Name>]
    ) => FieldBuilderFromPresetDescriptor<Descriptor, Params, Name>
  : <const Name extends string | undefined = undefined>(
      options?: NamedConstraintSpec<Name>,
    ) => FieldBuilderFromPresetDescriptor<Descriptor, readonly [], Name>;

export type FieldHelperFunction<Descriptor extends AuthoringFieldPresetDescriptor> =
  SupportsNamedConstraintOptions<Descriptor> extends true
    ? FieldHelperFunctionWithNamedConstraint<Descriptor>
    : FieldHelperFunctionWithoutNamedConstraint<Descriptor>;

export type FieldHelpersFromNamespace<Namespace> = {
  readonly [K in keyof Namespace]: Namespace[K] extends AuthoringFieldPresetDescriptor
    ? FieldHelperFunction<Namespace[K]>
    : Namespace[K] extends Record<string, unknown>
      ? FieldHelpersFromNamespace<Namespace[K]>
      : never;
};
