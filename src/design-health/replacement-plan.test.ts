import { describe, expect, it } from 'vitest';
import {
  buildCompatibilityPlan,
  normalizePropertyName,
} from './replacement-plan';

describe('replacement-plan', () => {
  it('normalizes property names by stripping Figma property ID hash suffix', () => {
    expect(normalizePropertyName('Label#12:34')).toBe('Label');
    expect(normalizePropertyName('Icon#567:89')).toBe('Icon');
    expect(normalizePropertyName('Size')).toBe('Size');
    expect(normalizePropertyName('')).toBe('');
  });

  it('builds compatibility plan matching identical properties', () => {
    const source = {
      key: 'source-btn-key',
      name: 'LegacyButton',
      properties: [
        { name: 'Label#10:1', type: 'TEXT' },
        { name: 'Disabled#10:2', type: 'BOOLEAN' },
        { name: 'Size#10:3', type: 'VARIANT', variantOptions: ['Small', 'Medium', 'Large'] },
      ],
    };

    const target = {
      key: 'target-btn-key',
      name: 'TashilButton',
      properties: [
        { name: 'Label#20:1', type: 'TEXT' },
        { name: 'Disabled#20:2', type: 'BOOLEAN' },
        { name: 'Size#20:3', type: 'VARIANT', variantOptions: ['Small', 'Medium', 'Large'] },
      ],
    };

    const plan = buildCompatibilityPlan({
      sourceComponent: source,
      targetComponent: target,
      instancesCount: 5,
    });

    expect(plan.preservedCount).toBe(3);
    expect(plan.needsReviewCount).toBe(0);
    expect(plan.atRiskCount).toBe(0);
    expect(plan.canAutoMigrate).toBe(true);
    expect(plan.properties.map((property) => property.targetName)).toEqual([
      'Label',
      'Disabled',
      'Size',
    ]);
  });

  it('detects variant option mismatch and marks as needs-review', () => {
    const source = {
      key: 'source-key',
      name: 'Legacy',
      properties: [
        { name: 'Size', type: 'VARIANT', variantOptions: ['Small', 'Medium', 'ExtraLarge'] },
      ],
    };

    const target = {
      key: 'target-key',
      name: 'NewComponent',
      properties: [
        { name: 'Size', type: 'VARIANT', variantOptions: ['Small', 'Medium'] }, // missing ExtraLarge
      ],
    };

    const plan = buildCompatibilityPlan({
      sourceComponent: source,
      targetComponent: target,
      instancesCount: 2,
    });

    expect(plan.preservedCount).toBe(0);
    expect(plan.needsReviewCount).toBe(1);
    expect(plan.canAutoMigrate).toBe(false);
    expect(plan.properties[0].status).toBe('needs-review');
    expect(plan.properties[0].details).toContain('ExtraLarge');
  });

  it('uses aliases for common UI properties (e.g. label -> children)', () => {
    const source = {
      key: 'source-key',
      name: 'Legacy',
      properties: [
        { name: 'Label#1', type: 'TEXT' },
      ],
    };

    const target = {
      key: 'target-key',
      name: 'Modern',
      properties: [
        { name: 'children#2', type: 'TEXT' },
      ],
    };

    const plan = buildCompatibilityPlan({
      sourceComponent: source,
      targetComponent: target,
      instancesCount: 1,
    });

    expect(plan.preservedCount).toBe(1);
    expect(plan.properties[0].status).toBe('preserved');
  });
});
