import { describe, expect, it } from 'vitest';
import {
  calculateTokenAuditSummary,
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

    expect(summary.totalPropertiesScanned).toBe(10); // 7 bound + 3 issues
    expect(summary.boundPropertiesCount).toBe(7);
    expect(summary.unboundPropertiesCount).toBe(3);
    expect(summary.tokenCoveragePercent).toBe(70); // 7/10 = 70%
    expect(summary.highConfidenceCount).toBe(1);
    expect(summary.mediumConfidenceCount).toBe(1);
    expect(summary.lowConfidenceCount).toBe(0);
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
});
