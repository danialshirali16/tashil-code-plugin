import { describe, expect, it } from 'vitest';
import { alignTierTopRight } from './figma-canvas-writer';

describe('alignTierTopRight', () => {
  it.each([
    ['HORIZONTAL', 'MAX', 'MIN'],
    ['VERTICAL', 'MIN', 'MAX'],
  ] as const)(
    'maps %s auto layout to Top-Right alignment',
    (layoutMode, expectedPrimary, expectedCounter) => {
      const tier = {
        counterAxisAlignItems: 'MIN',
        layoutMode,
        primaryAxisAlignItems: 'MIN',
      } as unknown as Parameters<typeof alignTierTopRight>[0];

      alignTierTopRight(tier);

      expect(tier.primaryAxisAlignItems).toBe(expectedPrimary);
      expect(tier.counterAxisAlignItems).toBe(expectedCounter);
    },
  );
});
