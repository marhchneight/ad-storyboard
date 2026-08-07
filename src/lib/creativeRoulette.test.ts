import { describe, it, expect } from 'vitest';
import { CREATIVE_CONSTRAINTS, pickRandomConstraint } from './creativeRoulette';

describe('pickRandomConstraint', () => {
  it('always returns one of the known constraints', () => {
    for (let i = 0; i < 20; i++) {
      expect(CREATIVE_CONSTRAINTS).toContain(pickRandomConstraint());
    }
  });

  it('never immediately repeats the excluded constraint', () => {
    const exclude = CREATIVE_CONSTRAINTS[0];
    for (let i = 0; i < 20; i++) {
      expect(pickRandomConstraint(exclude)).not.toBe(exclude);
    }
  });
});
