import { describe, expect, it } from 'vitest';
import { pgVectorCodec } from '../src/exports/codecs';

// M4 cleanup F01: `renderOutputType` was retired from the codec object and now
// lives on `pgVectorCodec` (a `ParameterizedCodecDescriptor`). The descriptor's
// `paramsSchema` validates inputs upstream of `renderOutputType`, so the
// renderer never sees malformed length values; tests below assert the
// descriptor's render output for valid inputs.
describe('pgVectorCodec renderOutputType', () => {
  it('renders Vector<length>', () => {
    expect(pgVectorCodec.renderOutputType!({ length: 1536 })).toBe('Vector<1536>');
  });

  it('renders Vector<length> with small dimension', () => {
    expect(pgVectorCodec.renderOutputType!({ length: 3 })).toBe('Vector<3>');
  });
});
