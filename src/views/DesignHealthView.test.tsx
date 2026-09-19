/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { h } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignHealthView } from './DesignHealthView';
import type { DesignHealthScanResult } from '../design-health/types';

const mockScanResult: DesignHealthScanResult = {
  scanId: 'test-scan-1',
  scannedAt: 1700000000000,
  targetNode: {
    id: '12:34',
    name: 'Checkout Card',
    type: 'FRAME',
  },
  tokenAudit: {
    totalPropertiesScanned: 10,
    boundPropertiesCount: 8,
    unboundPropertiesCount: 2,
    tokenCoveragePercent: 80,
    highConfidenceCount: 1,
    mediumConfidenceCount: 1,
    lowConfidenceCount: 0,
    issues: [
      {
        id: '12:35:fill',
        nodeId: '12:35',
        nodeName: 'Submit Button',
        property: 'fill',
        bindingTarget: { field: 'fills', paintIndex: 0 },
        currentValue: '#0055FF',
        isEditableHere: true,
        suggestion: {
          variableId: 'var-blue',
          variableName: 'colors/brand/primary',
          confidence: 'high',
          reason: 'Inferred variable match',
          source: 'inferred',
        },
      },
      {
        id: '12:36:cornerRadius',
        nodeId: '12:36',
        nodeName: 'Input Field',
        property: 'cornerRadius',
        bindingTarget: { field: 'cornerRadius' },
        currentValue: 8,
        isEditableHere: true,
        suggestion: {
          variableId: 'var-r-8',
          variableName: 'radius/md',
          confidence: 'medium',
          reason: 'Scope and value match',
          source: 'scope-match',
        },
      },
    ],
  },
  componentCandidates: [
    {
      sourceComponentKey: 'comp-btn-key',
      sourceComponentName: 'Legacy Button',
      instancesCount: 3,
      instanceIds: ['inst-1', 'inst-2', 'inst-3'],
    },
  ],
  libraryHealth: {
    totalInstances: 5,
    uniqueComponentsCount: 2,
    remoteInstancesCount: 4,
    localInstancesCount: 1,
    deprecatedInstances: [
      {
        nodeId: 'inst-dep-1',
        instanceName: 'Old Icon',
        componentName: 'LegacyIcon',
        deprecationNotice: 'Use TashilIcon instead',
      },
    ],
  },
};

describe('DesignHealthView (Redesigned Reactive UI)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders clean empty state when no layer is selected without manual scan button', () => {
    const handleScan = vi.fn();
    render(
      <DesignHealthView
        compatibilityPlan={null}
        compatibilityPlanStatus="idle"
        message=""
        onApplyTokenBindings={vi.fn()}
        onExecuteReplacement={vi.fn()}
        onFocusNode={vi.fn()}
        onLoadCompatibilityPlan={vi.fn()}
        onScan={handleScan}
        scanResult={null}
        status="idle"
      />,
    );

    expect(
      screen.getByText('Select a frame or layer on the canvas to inspect its design health'),
    ).toBeTruthy();
    expect(screen.queryByText('Scan Selection')).toBeNull();
  });

  it('renders loading state when initial audit is running', () => {
    render(
      <DesignHealthView
        compatibilityPlan={null}
        compatibilityPlanStatus="idle"
        message=""
        onApplyTokenBindings={vi.fn()}
        onExecuteReplacement={vi.fn()}
        onFocusNode={vi.fn()}
        onLoadCompatibilityPlan={vi.fn()}
        onScan={vi.fn()}
        scanResult={null}
        status="scanning"
      />,
    );

    expect(screen.getByText('Auditing layer design health…')).toBeTruthy();
  });

  it('renders layer header, live Auto-Audited indicator, score ring, and metric breakdown', () => {
    const handleScan = vi.fn();
    render(
      <DesignHealthView
        compatibilityPlan={null}
        compatibilityPlanStatus="idle"
        message=""
        onApplyTokenBindings={vi.fn()}
        onExecuteReplacement={vi.fn()}
        onFocusNode={vi.fn()}
        onLoadCompatibilityPlan={vi.fn()}
        onScan={handleScan}
        scanResult={mockScanResult}
        status="scanned"
      />,
    );

    expect(screen.getByText('Checkout Card')).toBeTruthy();
    expect(screen.getByText('FRAME')).toBeTruthy();
    expect(screen.getByText('Auto-Audited')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.getByText('Bound Tokens')).toBeTruthy();
    expect(screen.getByText('Raw Values')).toBeTruthy();
    expect(screen.getByText('Submit Button')).toBeTruthy();
    expect(screen.getByText('colors/brand/primary')).toBeTruthy();
    expect(screen.getByText('high')).toBeTruthy();
  });

  it('triggers Auto-Bind High Confidence when clicked', () => {
    const handleApply = vi.fn();
    render(
      <DesignHealthView
        compatibilityPlan={null}
        compatibilityPlanStatus="idle"
        message=""
        onApplyTokenBindings={handleApply}
        onExecuteReplacement={vi.fn()}
        onFocusNode={vi.fn()}
        onLoadCompatibilityPlan={vi.fn()}
        onScan={vi.fn()}
        scanResult={mockScanResult}
        status="scanned"
      />,
    );

    const autoBindBtn = screen.getByRole('button', {
      name: 'Auto-Bind High Confidence (1)',
    });
    fireEvent.click(autoBindBtn);

    expect(handleApply).toHaveBeenCalledWith([
      {
        nodeId: '12:35',
        property: 'fill',
        bindingTarget: { field: 'fills', paintIndex: 0 },
        variableId: 'var-blue',
      },
    ]);
  });

  it('focuses layer on canvas when clicking node name', () => {
    const handleFocus = vi.fn();
    render(
      <DesignHealthView
        compatibilityPlan={null}
        compatibilityPlanStatus="idle"
        message=""
        onApplyTokenBindings={vi.fn()}
        onExecuteReplacement={vi.fn()}
        onFocusNode={handleFocus}
        onLoadCompatibilityPlan={vi.fn()}
        onScan={vi.fn()}
        scanResult={mockScanResult}
        status="scanned"
      />,
    );

    const nodeBtn = screen.getByRole('button', { name: 'Submit Button' });
    fireEvent.click(nodeBtn);

    expect(handleFocus).toHaveBeenCalledWith('12:35');
  });

  it('switches to Component Swaps tab and analyzes compatibility', () => {
    const handleLoadPlan = vi.fn();
    const rendered = render(
      <DesignHealthView
        compatibilityPlan={null}
        compatibilityPlanStatus="idle"
        message=""
        onApplyTokenBindings={vi.fn()}
        onExecuteReplacement={vi.fn()}
        onFocusNode={vi.fn()}
        onLoadCompatibilityPlan={handleLoadPlan}
        onScan={vi.fn()}
        scanResult={mockScanResult}
        status="scanned"
      />,
    );

    // Click Component Swaps tab
    const compTab = screen.getByRole('tab', { name: /Component Swaps/i });
    fireEvent.click(compTab);

    expect(screen.getByText(/Safely swap instances of legacy/i)).toBeTruthy();

    const targetInput = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.click(screen.getByRole('radio', { name: 'Legacy Button (3 instances)' }));
    fireEvent.input(targetInput, { target: { value: 'target-button-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze Compatibility' }));

    expect(handleLoadPlan).toHaveBeenCalledWith('comp-btn-key', 'target-button-key', 3);

    const compatibilityPlan = {
      sourceComponentKey: 'comp-btn-key',
      sourceComponentName: 'Legacy Button',
      targetComponentKey: 'target-button-key',
      targetComponentName: 'New Button',
      instancesCount: 3,
      properties: [],
      preservedCount: 0,
      needsReviewCount: 0,
      atRiskCount: 0,
      canAutoMigrate: true,
    };
    rendered.rerender(
      <DesignHealthView
        compatibilityPlan={compatibilityPlan}
        compatibilityPlanStatus="loaded"
        message=""
        onApplyTokenBindings={vi.fn()}
        onExecuteReplacement={vi.fn()}
        onFocusNode={vi.fn()}
        onLoadCompatibilityPlan={handleLoadPlan}
        onScan={vi.fn()}
        scanResult={mockScanResult}
        status="scanned"
      />,
    );
    expect(screen.getByText('Compatibility Report')).toBeTruthy();

    fireEvent.input(targetInput, { target: { value: 'different-target-key' } });
    expect(screen.queryByText('Compatibility Report')).toBeNull();
  });

  it('switches to Library Health tab and displays deprecation warnings', () => {
    const handleFocus = vi.fn();
    render(
      <DesignHealthView
        compatibilityPlan={null}
        compatibilityPlanStatus="idle"
        message=""
        onApplyTokenBindings={vi.fn()}
        onExecuteReplacement={vi.fn()}
        onFocusNode={handleFocus}
        onLoadCompatibilityPlan={vi.fn()}
        onScan={vi.fn()}
        scanResult={mockScanResult}
        status="scanned"
      />,
    );

    const libTab = screen.getByRole('tab', { name: /Library Health/i });
    fireEvent.click(libTab);

    expect(screen.getByText(/Deprecated Components \(1\)/i)).toBeTruthy();
    expect(screen.getByText('LegacyIcon')).toBeTruthy();
    expect(screen.getByText('Use TashilIcon instead')).toBeTruthy();

    const focusBtn = screen.getByRole('button', { name: 'Focus' });
    fireEvent.click(focusBtn);
    expect(handleFocus).toHaveBeenCalledWith('inst-dep-1');
  });

  it('does not claim native library updates are available when no deprecation marker exists', () => {
    render(
      <DesignHealthView
        compatibilityPlan={null}
        compatibilityPlanStatus="idle"
        message=""
        onApplyTokenBindings={vi.fn()}
        onExecuteReplacement={vi.fn()}
        onFocusNode={vi.fn()}
        onLoadCompatibilityPlan={vi.fn()}
        onScan={vi.fn()}
        scanResult={{
          ...mockScanResult,
          libraryHealth: {
            ...mockScanResult.libraryHealth,
            deprecatedInstances: [],
          },
        }}
        status="scanned"
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /Library Health/i }));
    expect(screen.getByText(/Native library update availability is not exposed/i)).toBeTruthy();
    expect(screen.queryByText(/active and up to date/i)).toBeNull();
  });

  it('syncs Tokens tab badge with editableOnly filter', () => {
    const scanWithMixedIssues: DesignHealthScanResult = {
      ...mockScanResult,
      tokenAudit: {
        ...mockScanResult.tokenAudit,
        unboundPropertiesCount: 5,
        issues: [
          {
            id: '1',
            nodeId: '1',
            nodeName: 'Editable layer',
            property: 'fill',
            bindingTarget: { field: 'fills', paintIndex: 0 },
            currentValue: '#fff',
            isEditableHere: true,
            suggestion: { variableId: 'v1', variableName: 't1', confidence: 'high', reason: '', source: 'inferred' },
          },
          {
            id: '2',
            nodeId: '2',
            nodeName: 'Non-editable layer',
            property: 'fill',
            bindingTarget: { field: 'fills', paintIndex: 0 },
            currentValue: '#000',
            isEditableHere: false,
          },
        ],
      },
    };

    render(
      <DesignHealthView
        compatibilityPlan={null}
        compatibilityPlanStatus="idle"
        message=""
        onApplyTokenBindings={vi.fn()}
        onExecuteReplacement={vi.fn()}
        onFocusNode={vi.fn()}
        onLoadCompatibilityPlan={vi.fn()}
        onScan={vi.fn()}
        scanResult={scanWithMixedIssues}
        status="scanned"
      />,
    );

    const tokensTab = screen.getByRole('tab', { name: /Tokens/i });
    // By default, editableOnlyFilter is true, so badge shows 1 (the single editable issue)
    expect(tokensTab.textContent).toContain('1');

    // Uncheck "Editable layers only"
    const checkbox = screen.getByRole('checkbox', { name: /Editable layers only/i });
    fireEvent.click(checkbox);

    // Now tab badge shows total in tree: 5
    expect(tokensTab.textContent).toContain('5');
  });

  it('allows selecting alternative token suggestion from dropdown and binding it', () => {
    const handleApply = vi.fn();
    const scanWithAlternatives: DesignHealthScanResult = {
      ...mockScanResult,
      tokenAudit: {
        ...mockScanResult.tokenAudit,
        issues: [
          {
            id: 'card-fill',
            nodeId: 'card-1',
            nodeName: 'Card',
            property: 'fill',
            bindingTarget: { field: 'fills', paintIndex: 0 },
            currentValue: '#FFFFFF',
            isEditableHere: true,
            suggestion: {
              variableId: 'var-surface-primary',
              variableName: 'surface/primary',
              confidence: 'medium',
              reason: 'Matched semantic fill',
              source: 'scope-match',
            },
            alternativeSuggestions: [
              {
                variableId: 'var-color-white',
                variableName: 'color/white',
                confidence: 'low',
                reason: 'Alternative exact match',
                source: 'exact-value',
              },
            ],
          },
        ],
      },
    };

    render(
      <DesignHealthView
        compatibilityPlan={null}
        compatibilityPlanStatus="idle"
        message=""
        onApplyTokenBindings={handleApply}
        onExecuteReplacement={vi.fn()}
        onFocusNode={vi.fn()}
        onLoadCompatibilityPlan={vi.fn()}
        onScan={vi.fn()}
        scanResult={scanWithAlternatives}
        status="scanned"
      />,
    );

    const select = screen.getByRole('combobox', {
      name: /Alternative token suggestions for Card fill/i,
    }) as HTMLSelectElement;
    expect(select).toBeTruthy();

    // Change selection to alternative token
    select.value = 'var-color-white';
    fireEvent.change(select, { target: { value: 'var-color-white' } });

    // Click Bind
    const bindBtn = screen.getByRole('button', { name: 'Bind' });
    fireEvent.click(bindBtn);

    expect(handleApply).toHaveBeenCalledWith([
      {
        nodeId: 'card-1',
        property: 'fill',
        bindingTarget: { field: 'fills', paintIndex: 0 },
        variableId: 'var-color-white',
      },
    ]);
  });
});
