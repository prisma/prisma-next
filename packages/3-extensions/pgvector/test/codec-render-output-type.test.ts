import { describe, expect, it } from 'vitest';
import { pgVectorCodec } from '../src/exports/codecs';

// `renderOutputType` lives on `pgVectorCodec` (a `ParameterizedCodecDescriptor`)
// rather than on the codec object; `paramsSchema` validates inputs upstream of
// the renderer, so the renderer never sees malformed length values. Tests
// below assert the descriptor's render output for valid inputs. See ADR 205.
describe('pgVectorCodec renderOutputType', () => {
  it('renders Vector<length>', () => {
    expect(pgVectorCodec.renderOutputType!({ length: 1536 })).toBe('Vector<1536>');
  });

  it('renders Vector<length> with small dimension', () => {
    expect(pgVectorCodec.renderOutputType!({ length: 3 })).toBe('Vector<3>');
  });
});
