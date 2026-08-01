import { describe, expect, it } from 'vitest';
import { analyzeAccessibility, contrastRatio, parseCssColor } from './accessibility';

describe('Inspect accessibility checks', () => {
  it('computes known WCAG contrast ratios', () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 4);
    expect(contrastRatio({ r: 119, g: 119, b: 119 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(4.48, 1);
    expect(parseCssColor('#fff')).toEqual({ a: 1, b: 255, g: 255, r: 255 });
  });

  it('returns warnings for low contrast, a small target, and small text', () => {
    const findings = analyzeAccessibility({
      layout: [{ property: 'width', value: '20px' }, { property: 'height', value: '18px' }],
      style: [{ property: 'color', value: '#777' }, { property: 'background-color', value: '#888' }, { property: 'font-size', value: '10px' }],
    }, 'TEXT');
    expect(findings).toEqual([
      expect.objectContaining({ check: 'contrast', status: 'warning' }),
      expect.objectContaining({ check: 'touch-target', status: 'warning' }),
      expect.objectContaining({ check: 'font-size', status: 'warning' }),
    ]);
  });
});
