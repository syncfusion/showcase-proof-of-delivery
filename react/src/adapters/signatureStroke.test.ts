import { describe, expect, it } from 'vitest';
import { parseStroke, strokeLeavesNoMark, strokeSvg } from './signatureStroke';

const path = (points: Array<[number, number]>) => JSON.stringify(points.map(([x, y], i) => ({ command: i ? 'L' : 'M', x, y })));

describe('strokeLeavesNoMark', () => {
  it('a perfectly horizontal line leaves no mark', () => expect(strokeLeavesNoMark(path([[107, 152], [358, 152], [609, 152]]))).toBe(true));
  it('a perfectly vertical line leaves no mark', () => expect(strokeLeavesNoMark(path([[358, 60], [358, 243]]))).toBe(true));
  it('one pixel of wobble is kept', () => expect(strokeLeavesNoMark(path([[107, 152], [358, 153], [609, 152]]))).toBe(false));
  it('an ordinary drawing is kept', () => expect(strokeLeavesNoMark(path([[143, 182], [214, 91], [250, 152]]))).toBe(false));
  it('a value that is not a point list is left alone', () => {
    expect(strokeLeavesNoMark('data:image/png;base64,AAAA')).toBe(false);
    expect(strokeLeavesNoMark('[]')).toBe(false);
  });
});

// Vectors C3 to C6 of openspec/changes/carrier-look/contracts/data-contract.md.
describe('parseStroke and strokeSvg', () => {
  it('C3 parses the viewer value', () => {
    expect(parseStroke('[{"command":"M","x":10,"y":20},{"command":"L","x":30,"y":5}]')).toEqual([{ command: 'M', x: 10, y: 20 }, { command: 'L', x: 30, y: 5 }]);
  });
  it('C4 anything else gives an empty list', () => {
    expect(parseStroke('data:image/png;base64,AAAA')).toEqual([]);
    expect(parseStroke('{"x":1}')).toEqual([]);
    expect(parseStroke('')).toEqual([]);
  });
  it('keeps a second stroke as its own move', () => {
    const two = parseStroke('[{"command":"M","x":1,"y":1},{"command":"L","x":2,"y":2},{"command":"M","x":5,"y":5},{"command":"L","x":6,"y":7}]');
    expect(two.map((p) => p.command).join('')).toBe('MLML');
  });
  it('C5 builds the path and a padded view box', () => {
    expect(strokeSvg(parseStroke(path([[10, 20], [30, 5], [50, 25]])))).toEqual({ d: 'M 10 20 L 30 5 L 50 25', viewBox: '2 -3 56 36' });
  });
  it('C6 one point draws nothing', () => expect(strokeSvg(parseStroke(path([[10, 20]])))).toBeNull());
});
