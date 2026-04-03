export function createMongoScalarTypeDescriptors(): ReadonlyMap<string, string> {
  return new Map<string, string>([
    ['String', 'mongo/string@1'],
    ['Int', 'mongo/int32@1'],
    ['Boolean', 'mongo/bool@1'],
    ['DateTime', 'mongo/date@1'],
    ['ObjectId', 'mongo/objectId@1'],
  ]);
}
