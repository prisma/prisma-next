import type { AuthoringPslBlockDescriptor } from '@prisma-next/framework-components/authoring';
import type { Codec, CodecLookup } from '@prisma-next/framework-components/codec';
import { describe, expect, it } from 'vitest';
import type { ParseDiagnostic } from '../src/parse';
import { parse } from '../src/parse';
import { type ResolveOptions, resolve } from '../src/resolve';
import { frameworkScalarTypes } from './support';

// A stub codec that accepts any JSON string and rejects every non-string JSON
// value, mirroring the StubStringCodec the legacy validator suite used to
// exercise the value-validation path (codec.decodeJson(JSON.parse(raw))).
const stubStringCodec: Codec = {
  id: 'stub/string@1',
  encode: async (value) => value,
  decode: async (wire) => wire,
  encodeJson: (value) => value as string,
  decodeJson: (json) => {
    if (typeof json !== 'string') {
      throw new TypeError(`expected a JSON string, got ${typeof json}`);
    }
    return json;
  },
};

const stubCodecLookup: CodecLookup = {
  get: (id) => (id === 'stub/string@1' ? stubStringCodec : undefined),
  targetTypesFor: () => undefined,
  metaFor: () => undefined,
  renderOutputTypeFor: () => undefined,
};

const policySelectDescriptor: AuthoringPslBlockDescriptor = {
  kind: 'pslBlock',
  keyword: 'policy_select',
  discriminator: 'test-policy-select',
  name: { required: true },
  parameters: {
    target: { kind: 'ref', refKind: 'model', scope: 'same-namespace', required: true },
    as: { kind: 'option', values: ['permissive', 'restrictive'], required: false },
    roles: {
      kind: 'list',
      of: { kind: 'ref', refKind: 'role', scope: 'cross-space' },
      required: false,
    },
    using: { kind: 'value', codecId: 'stub/string@1', required: true },
  },
};

const policyDescriptors = { policy_select: policySelectDescriptor };

function resolveSource(
  source: string,
  options?: Omit<ResolveOptions, 'scalarTypes'>,
): readonly ParseDiagnostic[] {
  const { document, sourceFile } = parse(source);
  return resolve(document, sourceFile, {
    scalarTypes: frameworkScalarTypes,
    defaultNamespaceId: 'public',
    ...options,
  }).diagnostics;
}

function diagnosticsFor(source: string): readonly ParseDiagnostic[] {
  return resolveSource(source, {
    pslBlockDescriptors: policyDescriptors,
    codecLookup: stubCodecLookup,
  });
}

describe('resolve — extension-block validation', () => {
  describe('fully-valid block', () => {
    it('emits no extension diagnostics for a well-formed block', () => {
      const source = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  target = Post
  as = permissive
  roles = []
  using = "true"
}
`;
      expect(diagnosticsFor(source).filter((d) => d.code.startsWith('PSL_EXTENSION_'))).toEqual([]);
    });
  });

  describe('unknown parameter', () => {
    it('reports PSL_EXTENSION_UNKNOWN_PARAMETER for a key not in the descriptor', () => {
      const source = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  target = Post
  as = permissive
  roles = []
  using = "true"
  check = "true"
}
`;
      const diagnostics = diagnosticsFor(source);
      const unknown = diagnostics.find((d) => d.code === 'PSL_EXTENSION_UNKNOWN_PARAMETER');
      expect(unknown).toBeDefined();
      expect(unknown?.message).toBe(
        'Unknown parameter "check" in "policy_select" block "ReadPosts". The descriptor does not declare this parameter.',
      );
    });

    it('does not flag unknown parameters when the descriptor is variadic', () => {
      const variadicDescriptor: AuthoringPslBlockDescriptor = {
        kind: 'pslBlock',
        keyword: 'policy_select',
        discriminator: 'test-policy-select',
        name: { required: true },
        parameters: {},
        variadicParameters: true,
      };
      const source = `
policy_select ReadPosts {
  whatever = "x"
}
`;
      const diagnostics = resolveSource(source, {
        pslBlockDescriptors: { policy_select: variadicDescriptor },
        codecLookup: stubCodecLookup,
      });
      expect(diagnostics.some((d) => d.code === 'PSL_EXTENSION_UNKNOWN_PARAMETER')).toBe(false);
    });
  });

  describe('missing required parameter', () => {
    it('reports PSL_EXTENSION_MISSING_REQUIRED_PARAMETER when a required param is absent', () => {
      const source = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  as = permissive
  roles = []
}
`;
      const diagnostics = diagnosticsFor(source);
      const missing = diagnostics.filter(
        (d) => d.code === 'PSL_EXTENSION_MISSING_REQUIRED_PARAMETER',
      );
      expect(missing.map((d) => d.message)).toEqual(
        expect.arrayContaining([
          'Required parameter "target" is missing from "policy_select" block "ReadPosts".',
          'Required parameter "using" is missing from "policy_select" block "ReadPosts".',
        ]),
      );
    });

    it('does not report missing-required when only optional params are absent', () => {
      const source = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  target = Post
  using = "true"
}
`;
      expect(
        diagnosticsFor(source).some((d) => d.code === 'PSL_EXTENSION_MISSING_REQUIRED_PARAMETER'),
      ).toBe(false);
    });
  });

  describe('option value outside its set', () => {
    it('reports PSL_EXTENSION_OPTION_OUT_OF_SET for a token not in values[]', () => {
      const source = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  target = Post
  as = none
  roles = []
  using = "true"
}
`;
      const diagnostic = diagnosticsFor(source).find(
        (d) => d.code === 'PSL_EXTENSION_OPTION_OUT_OF_SET',
      );
      expect(diagnostic?.message).toBe(
        'Parameter "as" in "policy_select" block "ReadPosts" has value "none" which is not one of the allowed values: "permissive", "restrictive".',
      );
    });

    it('emits no option diagnostic for an allowed token', () => {
      const source = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  target = Post
  as = restrictive
  roles = []
  using = "true"
}
`;
      expect(diagnosticsFor(source).some((d) => d.code === 'PSL_EXTENSION_OPTION_OUT_OF_SET')).toBe(
        false,
      );
    });
  });

  describe('list parameter', () => {
    it('rejects a non-array value with PSL_EXTENSION_INVALID_VALUE', () => {
      const source = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  target = Post
  roles = "admin"
  using = "true"
}
`;
      const diagnostic = diagnosticsFor(source).find(
        (d) => d.code === 'PSL_EXTENSION_INVALID_VALUE' && d.message.includes('roles'),
      );
      expect(diagnostic?.message).toBe(
        'Parameter "roles" in "policy_select" block "ReadPosts" must be a list.',
      );
    });

    it('accepts an array value without a list diagnostic', () => {
      const source = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  target = Post
  roles = []
  using = "true"
}
`;
      expect(
        diagnosticsFor(source).filter(
          (d) => d.code === 'PSL_EXTENSION_INVALID_VALUE' && d.message.includes('roles'),
        ),
      ).toEqual([]);
    });
  });

  describe('value rejected by its codec', () => {
    it('reports PSL_EXTENSION_INVALID_VALUE when the raw literal is not valid JSON', () => {
      const source = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  target = Post
  roles = []
  using = not_a_quoted_string
}
`;
      const diagnostic = diagnosticsFor(source).find(
        (d) => d.code === 'PSL_EXTENSION_INVALID_VALUE',
      );
      expect(diagnostic?.message).toBe(
        'Parameter "using" in "policy_select" block "ReadPosts" is not a valid JSON literal (expected a JSON string, number, boolean, or null): not_a_quoted_string',
      );
    });

    it('reports PSL_EXTENSION_INVALID_VALUE when decodeJson rejects the JSON value', () => {
      const source = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  target = Post
  roles = []
  using = 42
}
`;
      const diagnostic = diagnosticsFor(source).find(
        (d) => d.code === 'PSL_EXTENSION_INVALID_VALUE',
      );
      expect(diagnostic?.message).toBe(
        'Parameter "using" in "policy_select" block "ReadPosts" was rejected by codec "stub/string@1": expected a JSON string, got number',
      );
    });

    it('reports PSL_EXTENSION_INVALID_VALUE when the codec id is unknown', () => {
      const unknownCodecDescriptor: AuthoringPslBlockDescriptor = {
        kind: 'pslBlock',
        keyword: 'policy_select',
        discriminator: 'test-policy-select',
        name: { required: true },
        parameters: {
          using: { kind: 'value', codecId: 'missing/codec@1', required: true },
        },
      };
      const source = `
policy_select ReadPosts {
  using = "true"
}
`;
      const diagnostic = resolveSource(source, {
        pslBlockDescriptors: { policy_select: unknownCodecDescriptor },
        codecLookup: stubCodecLookup,
      }).find((d) => d.code === 'PSL_EXTENSION_INVALID_VALUE');
      expect(diagnostic?.message).toBe(
        'Parameter "using" in "policy_select" block "ReadPosts" references unknown codec "missing/codec@1".',
      );
    });

    it('emits no value diagnostic when the codec accepts the literal', () => {
      const source = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  target = Post
  roles = []
  using = "auth.uid() = user_id"
}
`;
      expect(diagnosticsFor(source).some((d) => d.code === 'PSL_EXTENSION_INVALID_VALUE')).toBe(
        false,
      );
    });
  });

  describe('ref scope resolution', () => {
    describe('same-namespace scope', () => {
      it('accepts a ref when the referent model is in the same namespace', () => {
        const source = `
namespace public {
  model Post {
    id Int @id
  }

  policy_select ReadPosts {
    target = Post
    roles = []
    using = "true"
  }
}
`;
        expect(diagnosticsFor(source).some((d) => d.code === 'PSL_EXTENSION_UNRESOLVED_REF')).toBe(
          false,
        );
      });

      it('rejects a ref when the referent model is in a different namespace', () => {
        const source = `
namespace auth {
  model Post {
    id Int @id
  }
}

namespace public {
  policy_select ReadPosts {
    target = Post
    roles = []
    using = "true"
  }
}
`;
        const diagnostic = diagnosticsFor(source).find(
          (d) => d.code === 'PSL_EXTENSION_UNRESOLVED_REF',
        );
        expect(diagnostic?.message).toBe(
          'Parameter "target" in "policy_select" block "ReadPosts" refers to "Post" (expected model), but no entity with that name and kind was found in the same namespace.',
        );
      });

      it('rejects a ref for a nonexistent entity in the same namespace', () => {
        const source = `
namespace public {
  policy_select ReadPosts {
    target = Post
    roles = []
    using = "true"
  }
}
`;
        expect(diagnosticsFor(source).some((d) => d.code === 'PSL_EXTENSION_UNRESOLVED_REF')).toBe(
          true,
        );
      });
    });

    describe('same-space scope', () => {
      const sameSpaceDescriptor: AuthoringPslBlockDescriptor = {
        kind: 'pslBlock',
        keyword: 'test_block',
        discriminator: 'test-block',
        name: { required: true },
        parameters: {
          target: { kind: 'ref', refKind: 'model', scope: 'same-space', required: true },
        },
      };

      it('accepts a ref when the referent is in any namespace', () => {
        const source = `
namespace ns1 {
  test_block MyBlock {
    target = Post
  }
}

namespace ns2 {
  model Post {
    id Int @id
  }
}
`;
        const diagnostics = resolveSource(source, {
          pslBlockDescriptors: { test_block: sameSpaceDescriptor },
          codecLookup: stubCodecLookup,
        });
        expect(diagnostics.some((d) => d.code === 'PSL_EXTENSION_UNRESOLVED_REF')).toBe(false);
      });

      it('rejects a same-space ref when the referent exists in no namespace', () => {
        const source = `
namespace public {
  test_block MyBlock {
    target = Ghost
  }
}
`;
        const diagnostic = resolveSource(source, {
          pslBlockDescriptors: { test_block: sameSpaceDescriptor },
          codecLookup: stubCodecLookup,
        }).find((d) => d.code === 'PSL_EXTENSION_UNRESOLVED_REF');
        expect(diagnostic?.message).toBe(
          'Parameter "target" in "test_block" block "MyBlock" refers to "Ghost" (expected model), but no entity with that name and kind was found in any namespace in the schema.',
        );
      });
    });

    describe('cross-space scope', () => {
      it('always passes (documented pass-through)', () => {
        const source = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  target = Post
  roles = [anon, authenticated]
  using = "true"
}
`;
        expect(diagnosticsFor(source).every((d) => d.code !== 'PSL_EXTENSION_UNRESOLVED_REF')).toBe(
          true,
        );
      });
    });
  });

  describe('list parameter', () => {
    it('validates each list element against the element descriptor', () => {
      const listDescriptor: AuthoringPslBlockDescriptor = {
        kind: 'pslBlock',
        keyword: 'test_list',
        discriminator: 'test-list',
        name: { required: true },
        parameters: {
          modes: {
            kind: 'list',
            of: { kind: 'option', values: ['read', 'write'] },
            required: false,
          },
        },
      };
      const source = `
test_list MyBlock {
  modes = [read, execute, write]
}
`;
      const diagnostics = resolveSource(source, {
        pslBlockDescriptors: { test_list: listDescriptor },
        codecLookup: stubCodecLookup,
      });
      const optionDiagnostics = diagnostics.filter(
        (d) => d.code === 'PSL_EXTENSION_OPTION_OUT_OF_SET',
      );
      expect(optionDiagnostics).toHaveLength(1);
      expect(optionDiagnostics[0]?.message).toContain('"execute"');
    });
  });

  describe('duplicate parameter', () => {
    it('emits PSL_EXTENSION_DUPLICATE_PARAMETER and keeps the first occurrence', () => {
      const source = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  target = Post
  roles = []
  using = "first"
  using = "second"
}
`;
      const diagnostic = diagnosticsFor(source).find(
        (d) => d.code === 'PSL_EXTENSION_DUPLICATE_PARAMETER',
      );
      expect(diagnostic?.message).toBe(
        'Duplicate parameter "using" in "policy_select" block "ReadPosts"; first occurrence wins',
      );
    });
  });

  describe('no descriptors registered', () => {
    it('emits no extension diagnostics when no descriptors are supplied', () => {
      const source = `
policy_select ReadPosts {
  target = Post
}
`;
      expect(resolveSource(source).filter((d) => d.code.startsWith('PSL_EXTENSION_'))).toEqual([]);
    });

    it('reports an unregistered block as an unsupported top-level block', () => {
      const source = `
policy_select ReadPosts {
  target = Post
}
`;
      const diagnostic = resolveSource(source).find(
        (d) => d.code === 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
      );
      expect(diagnostic?.message).toBe('Unsupported top-level block "policy_select"');
    });
  });

  describe('registered block keyword', () => {
    it('does not report a registered block as unsupported', () => {
      const source = `
policy_select ReadPosts {
  target = Post
  using = "true"
}

model Post {
  id Int @id
}
`;
      expect(diagnosticsFor(source).some((d) => d.code === 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK')).toBe(
        false,
      );
    });
  });
});

describe('resolve — named-type collision', () => {
  it('reports a conflict with a scalar type', () => {
    const source = `
types {
  String = String
}
`;
    const diagnostic = resolveSource(source).find((d) => d.code === 'PSL_INVALID_TYPES_MEMBER');
    expect(diagnostic?.message).toBe('Named type "String" conflicts with scalar type "String"');
  });

  it('reports a conflict with a model name', () => {
    const source = `
types {
  User = String
}

model User {
  id Int @id
}
`;
    const diagnostic = resolveSource(source).find((d) => d.code === 'PSL_INVALID_TYPES_MEMBER');
    expect(diagnostic?.message).toBe('Named type "User" conflicts with model name "User"');
  });

  it('reports both scalar and model conflicts together', () => {
    const source = `
types {
  String = String
  User = String
}

model User {
  id Int @id
}
`;
    const messages = resolveSource(source)
      .filter((d) => d.code === 'PSL_INVALID_TYPES_MEMBER')
      .map((d) => d.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'Named type "String" conflicts with scalar type "String"',
        'Named type "User" conflicts with model name "User"',
      ]),
    );
  });

  it('emits no collision diagnostic for a non-colliding named type', () => {
    const source = `
types {
  Email = String
}

model User {
  id Int @id
}
`;
    expect(resolveSource(source).some((d) => d.code === 'PSL_INVALID_TYPES_MEMBER')).toBe(false);
  });

  it('finds a colliding model across namespaces even when an earlier namespace declares another kind of the same name', () => {
    // `Order` is a composite type in namespace `a` and a model in namespace `b`.
    // The collision check must find the model across all namespaces, not stop at
    // the first (composite) hit and miss it.
    const source = `
types {
  Order = String
}

namespace a {
  type Order {
    item String
  }
}

namespace b {
  model Order {
    id Int @id
  }
}
`;
    const diagnostic = resolveSource(source).find((d) => d.code === 'PSL_INVALID_TYPES_MEMBER');
    expect(diagnostic?.message).toBe('Named type "Order" conflicts with model name "Order"');
  });
});
