import { describe, it, expect } from 'vitest';
import { rrfMerge } from '../query.js';

type SR = import('../types.js').SearchResult;

function makeResult(id: string, chunkType: 'metadata' | 'body'): SR {
  return { chunkId: id, chunkType } as SR;
}

describe('rrfMerge', () => {
  it('merges two ranked lists using RRF scoring', () => {
    const vector: SR[] = [makeResult('A', 'body'), makeResult('B', 'body')];
    const keyword: SR[] = [makeResult('C', 'body'), makeResult('A', 'body')];
    const results = rrfMerge(vector, keyword, 5);
    expect(results[0].chunkId).toBe('A');
  });

  it('applies max-normalization so top score is 1.0', () => {
    const vector: SR[] = [makeResult('X', 'body')];
    const results = rrfMerge(vector, [], 5);
    expect(results[0].score).toBeCloseTo(1.0, 5);
  });

  it('result in both lists outranks result in only one', () => {
    const vector: SR[] = [makeResult('A', 'body'), makeResult('B', 'body')];
    const keyword: SR[] = [makeResult('A', 'body')];
    const results = rrfMerge(vector, keyword, 5);
    const idxA = results.findIndex(r => r.chunkId === 'A');
    const idxB = results.findIndex(r => r.chunkId === 'B');
    expect(idxA).toBeLessThan(idxB);
  });

  it('handles k=0 by clamping to minimum', () => {
    const vector: SR[] = [makeResult('A', 'body')];
    const results = rrfMerge(vector, [], 5, 0);
    expect(results[0].score).toBeCloseTo(1.0, 5);
    expect(results[0].chunkId).toBe('A');
  });
});
