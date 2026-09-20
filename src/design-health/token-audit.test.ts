import { describe, expect, it } from 'vitest';
import {
  calculateTokenAuditSummary,
  createTokenCandidateIndex,
  filterHighConfidenceIssues,
  rankTokenSuggestion,
  type TokenCandidateInput,
} from './token-audit';
import type { TokenPropertyIssue } from './types';

describe('token-audit', () => {
  const sampleTokens: TokenCandidateInput[] = [
    {
      variableId: 'var:primary-600',
      variableName: 'color/primary/600',
      resolvedType: 'COLOR',
      scopes: ['FRAME_FILL', 'SHAPE_FILL'],
      value: '#2563EB',
    },
    {
      variableId: 'var:spacing-md',
      variableName: 'spacing/md',
      resolvedType: 'FLOAT',
      scopes: ['GAP'],
      value: 16,
    },
    {
      variableId: 'var:radius-md',
      variableName: 'radius/md',
      resolvedType: 'FLOAT',
      scopes: ['CORNER_RADIUS'],
      value: 16,
    },
  ];

  it('ranks Figma inferredVariable as High confidence', () => {
    const result = rankTokenSuggestion({
      property: 'fill',
      currentValue: '#2563EB',
      inferredVariable: { id: 'var:primary-600', name: 'color/primary/600' },
      availableTokens: sampleTokens,
    });

    expect(result.suggestion).toBeDefined();
    expect(result.suggestion?.confidence).toBe('high');
    expect(result.suggestion?.variableId).toBe('var:primary-600');
    expect(result.suggestion?.source).toBe('inferred');
  });

  it('disambiguates matching numbers by scope (e.g. GAP vs CORNER_RADIUS) as Medium confidence', () => {
    const gapResult = rankTokenSuggestion({
      property: 'gap',
      currentValue: 16,
      availableTokens: sampleTokens,
    });

    expect(gapResult.suggestion).toBeDefined();
    expect(gapResult.suggestion?.confidence).toBe('medium');
    expect(gapResult.suggestion?.variableId).toBe('var:spacing-md');
    expect(gapResult.suggestion?.source).toBe('scope-match');

    const radiusResult = rankTokenSuggestion({
      property: 'cornerRadius',
      currentValue: 16,
      availableTokens: sampleTokens,
    });

    expect(radiusResult.suggestion).toBeDefined();
    expect(radiusResult.suggestion?.confidence).toBe('medium');
    expect(radiusResult.suggestion?.variableId).toBe('var:radius-md');
    expect(radiusResult.suggestion?.source).toBe('scope-match');
  });

  it('reuses a candidate index without changing exact, near, inferred, or name ranking', () => {
    const tokens: TokenCandidateInput[] = [
      ...sampleTokens,
      {
        variableId: 'var:primary-bg',
        variableName: 'background/primary/default',
        resolvedType: 'COLOR',
        scopes: ['FRAME_FILL'],
        value: '#2563EB',
      },
      {
        variableId: 'var:spacing-sm',
        variableName: 'spacing/sm',
        resolvedType: 'FLOAT',
        scopes: ['GAP'],
        value: 12,
      },
    ];
    const candidateIndex = createTokenCandidateIndex(tokens);
    const cases = [
      { property: 'fill' as const, currentValue: '#2563eb', nodeName: 'Card' },
      { property: 'gap' as const, currentValue: 15.9995, nodeName: 'Stack' },
      { property: 'gap' as const, currentValue: 11, nodeName: 'Stack' },
      {
        property: 'fill' as const,
        currentValue: '#123456',
        nodeName: 'Primary Button',
      },
      {
        property: 'fill' as const,
        currentValue: '#2563EB',
        inferredVariable: {
          id: 'var:primary-600',
          name: 'color/primary/600',
        },
      },
    ];

    for (const params of cases) {
      expect(rankTokenSuggestion({ ...params, candidateIndex })).toEqual(
        rankTokenSuggestion({ ...params, availableTokens: tokens }),
      );
    }
  });

  it('calculates audit summary correctly', () => {
    const sampleIssues: TokenPropertyIssue[] = [
      {
        id: '1',
        nodeId: 'node-1',
        nodeName: 'Box',
        property: 'fill',
        bindingTarget: { field: 'fills', paintIndex: 0 },
        currentValue: '#2563EB',
        isEditableHere: true,
        suggestion: {
          variableId: 'var:1',
          variableName: 'color/primary',
          confidence: 'high',
          reason: 'inferred',
          source: 'inferred',
        },
      },
      {
        id: '2',
        nodeId: 'node-2',
        nodeName: 'Button',
        property: 'cornerRadius',
        bindingTarget: { field: 'cornerRadius' },
        currentValue: 8,
        isEditableHere: true,
        suggestion: {
          variableId: 'var:2',
          variableName: 'radius/sm',
          confidence: 'medium',
          reason: 'scope',
          source: 'scope-match',
        },
      },
      {
        id: '3',
        nodeId: 'node-3',
        nodeName: 'Card',
        property: 'stroke',
        bindingTarget: { field: 'strokes', paintIndex: 0 },
        currentValue: '#cccccc',
        isEditableHere: false,
        // no suggestion
      },
    ];

    const summary = calculateTokenAuditSummary(7, sampleIssues);

    expect(summary.audited).toBe(true);
    expect(summary.totalPropertiesScanned).toBe(10); // 7 bound + 3 issues
    expect(summary.boundPropertiesCount).toBe(7);
    expect(summary.unboundPropertiesCount).toBe(3);
    expect(summary.tokenCoveragePercent).toBe(70); // 7/10 = 70%
    expect(summary.highConfidenceCount).toBe(1);
    expect(summary.mediumConfidenceCount).toBe(1);
    expect(summary.lowConfidenceCount).toBe(0);
  });

  it('never reports 100% coverage for a selection with nothing to audit', () => {
    const summary = calculateTokenAuditSummary(0, []);

    expect(summary.audited).toBe(false);
    expect(summary.totalPropertiesScanned).toBe(0);
    expect(summary.tokenCoveragePercent).toBe(0);
  });

  it('filters only high-confidence and editable issues for auto-bind', () => {
    const issues: TokenPropertyIssue[] = [
      {
        id: '1',
        nodeId: 'node-1',
        nodeName: 'Editable High',
        property: 'fill',
        bindingTarget: { field: 'fills', paintIndex: 0 },
        currentValue: '#fff',
        isEditableHere: true,
        suggestion: { variableId: 'v1', variableName: 't1', confidence: 'high', reason: '', source: 'inferred' },
      },
      {
        id: '2',
        nodeId: 'node-2',
        nodeName: 'Non-editable High',
        property: 'fill',
        bindingTarget: { field: 'fills', paintIndex: 0 },
        currentValue: '#fff',
        isEditableHere: false,
        suggestion: { variableId: 'v2', variableName: 't2', confidence: 'high', reason: '', source: 'inferred' },
      },
      {
        id: '3',
        nodeId: 'node-3',
        nodeName: 'Editable Med',
        property: 'fill',
        bindingTarget: { field: 'fills', paintIndex: 0 },
        currentValue: '#fff',
        isEditableHere: true,
        suggestion: { variableId: 'v3', variableName: 't3', confidence: 'medium', reason: '', source: 'scope-match' },
      },
    ];

    const filtered = filterHighConfidenceIssues(issues);
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('1');
  });

  it('suggests the nearest scale step when no token holds the exact value', () => {
    const result = rankTokenSuggestion({
      property: 'gap',
      currentValue: 15,
      availableTokens: [
        { variableId: 'v:space-12', variableName: 'spacing/12', resolvedType: 'FLOAT', scopes: ['GAP'], value: 12 },
        { variableId: 'v:space-16', variableName: 'spacing/16', resolvedType: 'FLOAT', scopes: ['GAP'], value: 16 },
        { variableId: 'v:space-64', variableName: 'spacing/64', resolvedType: 'FLOAT', scopes: ['GAP'], value: 64 },
      ],
    });

    expect(result.suggestion?.source).toBe('near-value');
    expect(result.suggestion?.variableId).toBe('v:space-16'); // |16-15| < |12-15|
    expect(result.suggestion?.confidence).toBe('low');
    expect(result.suggestion?.suggestedValue).toBe(16);
    // 12 stays as a pickable alternative; 64 is too far to suggest.
    expect(result.alternatives?.map((a) => a.variableId)).toEqual(['v:space-12']);
  });

  it('treats a color whose RGB matches and only alpha differs as a strong near match', () => {
    const result = rankTokenSuggestion({
      property: 'fill',
      currentValue: '#2563EB80',
      availableTokens: [
        { variableId: 'v:primary', variableName: 'color/primary/600', resolvedType: 'COLOR', scopes: ['FRAME_FILL'], value: '#2563EB' },
      ],
    });

    expect(result.suggestion?.source).toBe('near-value');
    expect(result.suggestion?.confidence).toBe('medium');
    expect(result.suggestion?.reason).toContain('opacity');
    expect(result.suggestion?.suggestedValue).toBe('#2563EB');
  });

  it('suggests the nearest shade when no exact color token exists', () => {
    const result = rankTokenSuggestion({
      property: 'fill',
      currentValue: '#2564EB',
      availableTokens: [
        { variableId: 'v:primary', variableName: 'color/primary/600', resolvedType: 'COLOR', scopes: ['FRAME_FILL'], value: '#2563EB' },
        { variableId: 'v:danger', variableName: 'color/danger/600', resolvedType: 'COLOR', scopes: ['FRAME_FILL'], value: '#FF0000' },
      ],
    });

    expect(result.suggestion?.source).toBe('near-value');
    expect(result.suggestion?.variableId).toBe('v:primary');
    expect(result.suggestion?.confidence).toBe('low');
    expect(result.alternatives ?? []).toEqual([]);
  });

  it('falls back to tokens named like the layer when nothing is value-close', () => {
    const result = rankTokenSuggestion({
      property: 'fill',
      currentValue: '#7B2D26',
      nodeName: 'Primary Button',
      availableTokens: [
        { variableId: 'v:primary', variableName: 'color/primary/600', resolvedType: 'COLOR', scopes: ['FRAME_FILL'], value: '#2563EB' },
        { variableId: 'v:danger', variableName: 'color/danger/600', resolvedType: 'COLOR', scopes: ['FRAME_FILL'], value: '#DC2626' },
      ],
    });

    expect(result.suggestion?.source).toBe('name-match');
    expect(result.suggestion?.variableId).toBe('v:primary');
    expect(result.suggestion?.confidence).toBe('low');
    expect(result.suggestion?.reason).toContain('primary');
    expect(result.suggestion?.suggestedValue).toBe('#2563EB');
  });

  it('still returns no suggestion when nothing is close or name-compatible', () => {
    const result = rankTokenSuggestion({
      property: 'fill',
      currentValue: '#123456',
      nodeName: 'Rectangle 1', // generic words only — no usable name signal
      availableTokens: [
        { variableId: 'v:white', variableName: 'color/white', resolvedType: 'COLOR', scopes: ['FRAME_FILL'], value: '#FFFFFF' },
        { variableId: 'v:black', variableName: 'color/black', resolvedType: 'COLOR', scopes: ['FRAME_FILL'], value: '#000000' },
      ],
    });

    expect(result.suggestion).toBeUndefined();
    expect(result.alternatives).toBeUndefined();
  });

  it('prefers a semantic background token over a same-value color primitive for fills', () => {
    // "background" contains none of the old substrings ("bg", "color", …), so
    // before tiered keywords this token lost the disambiguation it should win.
    const result = rankTokenSuggestion({
      property: 'fill',
      currentValue: '#F7F7F8',
      availableTokens: [
        { variableId: 'v:gray-100', variableName: 'color/gray/100', resolvedType: 'COLOR', scopes: ['FRAME_FILL'], value: '#F7F7F8' },
        { variableId: 'v:bg-neutral', variableName: 'background/neutral/subtle/default', resolvedType: 'COLOR', scopes: ['FRAME_FILL'], value: '#F7F7F8' },
      ],
    });

    expect(result.suggestion?.variableId).toBe('v:bg-neutral');
    expect(result.suggestion?.confidence).toBe('medium');
    expect(result.suggestion?.source).toBe('scope-match');
    expect(result.alternatives?.map((a) => a.variableId)).toEqual(['v:gray-100']);
  });

  it('lets a layer-name word outrank keyword tiers when tokens share a value', () => {
    const result = rankTokenSuggestion({
      property: 'fill',
      currentValue: '#DDDDDD',
      nodeName: 'Sidebar',
      availableTokens: [
        { variableId: 'v:bg-default', variableName: 'background/default', resolvedType: 'COLOR', scopes: ['FRAME_FILL'], value: '#DDDDDD' },
        { variableId: 'v:sidebar', variableName: 'color/sidebar', resolvedType: 'COLOR', scopes: ['FRAME_FILL'], value: '#DDDDDD' },
      ],
    });

    expect(result.suggestion?.variableId).toBe('v:sidebar');
    expect(result.suggestion?.confidence).toBe('medium');
    expect(result.suggestion?.reason).toContain(`layer's name`);
  });

  it('ranks bare-number primitive scale steps below semantic tokens of the same tier', () => {
    const result = rankTokenSuggestion({
      property: 'fill',
      currentValue: '#EEEEEE',
      availableTokens: [
        { variableId: 'v:surface-100', variableName: 'surface/100', resolvedType: 'COLOR', scopes: ['FRAME_FILL'], value: '#EEEEEE' },
        { variableId: 'v:surface-subtle', variableName: 'surface/subtle', resolvedType: 'COLOR', scopes: ['FRAME_FILL'], value: '#EEEEEE' },
      ],
    });

    expect(result.suggestion?.variableId).toBe('v:surface-subtle');
    expect(result.suggestion?.confidence).toBe('medium');
    expect(result.alternatives?.map((a) => a.variableId)).toEqual(['v:surface-100']);
  });

  it('keeps low confidence when equally-ranked tokens cannot be separated', () => {
    const result = rankTokenSuggestion({
      property: 'fill',
      currentValue: '#CCCCCC',
      availableTokens: [
        { variableId: 'v:aaa', variableName: 'background/aaa', resolvedType: 'COLOR', scopes: ['FRAME_FILL'], value: '#CCCCCC' },
        { variableId: 'v:bbb', variableName: 'background/bbb', resolvedType: 'COLOR', scopes: ['FRAME_FILL'], value: '#CCCCCC' },
      ],
    });

    expect(result.suggestion).toBeDefined();
    expect(result.suggestion?.confidence).toBe('low');
    expect(result.suggestion?.source).toBe('exact-value');
    expect(result.alternatives?.length).toBe(1);
  });

  it('never suggests a radius-only token for a gap even when the value matches exactly', () => {
    // Figma variable scopes are binding constraints: this token is restricted
    // to CORNER_RADIUS, so it must not surface for itemSpacing.
    const result = rankTokenSuggestion({
      property: 'gap',
      currentValue: 12,
      availableTokens: [
        { variableId: 'v:radius-md', variableName: 'radius/md', resolvedType: 'FLOAT', scopes: ['CORNER_RADIUS'], value: 12 },
        { variableId: 'v:spacing-sm', variableName: 'spacing/sm', resolvedType: 'FLOAT', scopes: ['GAP'], value: 10 },
      ],
    });

    expect(result.suggestion?.variableId).toBe('v:spacing-sm'); // nearest scope-compatible step
    expect(result.suggestion?.source).toBe('near-value');
    expect(result.suggestion?.suggestedValue).toBe(10);
    expect(result.alternatives ?? []).toEqual([]); // the radius token is nowhere
  });

  it('excludes scope-incompatible tokens from exact-match alternatives too', () => {
    const result = rankTokenSuggestion({
      property: 'gap',
      currentValue: 16,
      availableTokens: [
        { variableId: 'v:radius-md', variableName: 'radius/md', resolvedType: 'FLOAT', scopes: ['CORNER_RADIUS'], value: 16 },
        { variableId: 'v:spacing-md', variableName: 'spacing/md', resolvedType: 'FLOAT', scopes: ['GAP'], value: 16 },
      ],
    });

    expect(result.suggestion?.variableId).toBe('v:spacing-md');
    expect(result.suggestion?.confidence).toBe('medium');
    expect(result.suggestion?.source).toBe('scope-match');
    expect(result.alternatives ?? []).toEqual([]);
  });

  it('returns no suggestion when only scope-incompatible tokens hold the value and none is near', () => {
    const result = rankTokenSuggestion({
      property: 'opacity',
      currentValue: 0.5,
      availableTokens: [
        { variableId: 'v:radius-xs', variableName: 'radius/xs', resolvedType: 'FLOAT', scopes: ['CORNER_RADIUS'], value: 0.5 },
        { variableId: 'v:spacing-xl', variableName: 'spacing/xl', resolvedType: 'FLOAT', scopes: ['GAP'], value: 40 },
      ],
    });

    expect(result.suggestion).toBeUndefined();
    expect(result.alternatives).toBeUndefined();
  });

  it('prefers the resting-state token over a same-value interaction-state variant', () => {
    // Both tokens resolve to #F9FAFB here; before the state penalty this tie
    // was decided by list order and could pick the hover variant.
    const result = rankTokenSuggestion({
      property: 'fill',
      currentValue: '#F9FAFB',
      availableTokens: [
        { variableId: 'v:transparent-hover', variableName: 'background/neutral/transparent-hover', resolvedType: 'COLOR', scopes: ['FRAME_FILL'], value: '#F9FAFB' },
        { variableId: 'v:subtle-default', variableName: 'background/neutral/subtle/default', resolvedType: 'COLOR', scopes: ['FRAME_FILL'], value: '#F9FAFB' },
      ],
    });

    expect(result.suggestion?.variableId).toBe('v:subtle-default');
    expect(result.suggestion?.confidence).toBe('medium');
    expect(result.alternatives?.map((a) => a.variableId)).toEqual(['v:transparent-hover']);
  });

  it('still suggests an interaction-state token when it is the only same-value candidate', () => {
    const result = rankTokenSuggestion({
      property: 'fill',
      currentValue: '#F9FAFB',
      availableTokens: [
        { variableId: 'v:brand-hover', variableName: 'background/brand/hover', resolvedType: 'COLOR', scopes: ['FRAME_FILL'], value: '#F9FAFB' },
      ],
    });

    expect(result.suggestion?.variableId).toBe('v:brand-hover');
    expect(result.suggestion?.confidence).toBe('medium');
    expect(result.suggestion?.source).toBe('scope-match');
  });
});
