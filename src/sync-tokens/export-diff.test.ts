import { describe, expect, it } from 'vitest';
import { diffTokenSnapshots } from './export-diff';

describe('token export diff', () => {
  it('classifies added, changed, removed, and unchanged tokens', () => {
    expect(diffTokenSnapshots(
      { changed: 'old', removed: 'gone', same: 'value' },
      { added: 'new', changed: 'new', same: 'value' },
    )).toEqual({ added: 1, changed: 1, removed: 1, unchanged: 1 });
  });
});
