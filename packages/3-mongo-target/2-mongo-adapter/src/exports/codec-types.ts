export type CodecTypes = {
  readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
  readonly 'mongo/string@1': { readonly input: string; readonly output: string };
  readonly 'mongo/int32@1': { readonly input: number; readonly output: number };
  readonly 'mongo/bool@1': { readonly input: boolean; readonly output: boolean };
  readonly 'mongo/date@1': { readonly input: Date; readonly output: Date };
};
