/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { h } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignHealthView } from './DesignHealthView';
import type { DesignHealthScanResult } from '../design-health/types';
import type { DesignHealthViewProps } from './DesignHealthView';

const mockScanResult: DesignHealthScanResult = {
  scanId: 'test-scan-1',
  scannedAt: Date.now(),
  targetNode: {
    id: '12:34',
    name: 'Checkout Card',
    type: 'FRAME',
  },
  tokenAudit: {
    audited: true,
    totalPropertiesScanned: 10,
    boundPropertiesCount: 8,
    unboundPropertiesCount: 2,
    tokenCoveragePercent: 80,
    highConfidenceCount: 1,
    mediumConfidenceCount: 1,
    lowConfidenceCount: 0,
    issues: [
      {
        id: '12:35:fill:0',
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
  nodesVisited: 42,
  capReached: false,
  selectionCount: 1,
};

function createProps(
  overrides: Partial<DesignHealthViewProps> = {},
): DesignHealthViewProps {
  return {
    scanResult: null,
    status: 'idle',
    message: '',
    onScan: vi.fn(),
    onApplyTokenBindings: vi.fn(),
    onFocusNode: vi.fn(),
    ...overrides,
  };
}

function renderView(overrides: Partial<DesignHealthViewProps> = {}) {
  const props = createProps(overrides);
  const view = render(<DesignHealthView {...props} />);
  return { props, ...view };
}

describe('DesignHealthView', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the empty prompt when no layer is selected', () => {
    renderView();

    expect(
      screen.getByText('Select a frame or layer on the canvas to inspect its design health'),
    ).toBeTruthy();
    expect(screen.queryByText('Scan Selection')).toBeNull();
  });

  it('renders the loading state while the initial audit runs', () => {
    renderView({ status: 'scanning' });

    expect(screen.getByText('Auditing layer design health…')).toBeTruthy();
  });

  it('offers a retry when the scan failed without a previous result', () => {
    const onScan = vi.fn();
    renderView({ status: 'error', message: 'Selection vanished.', onScan });

    fireEvent.click(screen.getByRole('button', { name: 'Retry Audit' }));
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('renders the header with an honest status, node subject, and coverage meter', () => {
    renderView({ scanResult: mockScanResult, status: 'scanned' });

    expect(screen.getByRole('heading', { name: 'Design health' })).toBeTruthy();
    expect(screen.getByText('Checkout Card')).toBeTruthy();
    expect(screen.getByText('FRAME')).toBeTruthy();
    expect(screen.getByText(/Up to date/)).toBeTruthy();
    expect(screen.queryByText('Auto-Audited')).toBeNull();
    expect(screen.getByText('8 of 10 properties bound')).toBeTruthy();
    const meter = document.querySelector('[role="meter"]');
    expect(meter?.getAttribute('aria-valuetext')).toBe('80 percent — 8 of 10 properties bound');
  });

  it('warns about partial audits and multi-selection instead of hiding them', () => {
    renderView({
      scanResult: {
        ...mockScanResult,
        capReached: true,
        selectionCount: 2,
      },
      status: 'scanned',
    });

    expect(screen.getByText(/Partial audit: the 800-layer limit was reached/)).toBeTruthy();
    expect(screen.getByText(/only the first one was audited/)).toBeTruthy();
  });

  it('binds a high-confidence row with its exact binding target', () => {
    const onApplyTokenBindings = vi.fn();
    renderView({
      scanResult: mockScanResult,
      status: 'scanned',
      onApplyTokenBindings,
    });

    expect(screen.getByText('Ready to auto-fix (1)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bind 1 high-confidence' }));

    expect(onApplyTokenBindings).toHaveBeenCalledWith([
      {
        nodeId: '12:35',
        property: 'fill',
        bindingTarget: { field: 'fills', paintIndex: 0 },
        variableId: 'var-blue',
      },
    ]);
  });

  it('clusters repeated properties of one node under a single header', () => {
    const onApplyTokenBindings = vi.fn();
    renderView({
      scanResult: {
        ...mockScanResult,
        tokenAudit: {
          ...mockScanResult.tokenAudit,
          issues: [
            {
              id: 'header-1:gap',
              nodeId: 'header-1',
              nodeName: 'Header',
              property: 'gap',
              bindingTarget: { field: 'itemSpacing' },
              currentValue: 4,
              isEditableHere: true,
              suggestion: {
                variableId: 'v-space-4',
                variableName: 'Spacing/4',
                confidence: 'high',
                reason: 'Inferred match',
                source: 'inferred',
              },
            },
            {
              id: 'header-1:paddingTop',
              nodeId: 'header-1',
              nodeName: 'Header',
              property: 'padding',
              bindingTarget: { field: 'paddingTop' },
              currentValue: 16,
              isEditableHere: true,
              suggestion: {
                variableId: 'v-space-16',
                variableName: 'Spacing/16',
                confidence: 'high',
                reason: 'Inferred match',
                source: 'inferred',
              },
            },
          ],
        },
      },
      status: 'scanned',
      onApplyTokenBindings,
    });

    // The node name appears once, with a cluster count — not once per row.
    expect(screen.getByText('Header')).toBeTruthy();
    expect(screen.getByText('(2)')).toBeTruthy();
    expect(screen.getByText('itemSpacing')).toBeTruthy();
    expect(screen.getByText('paddingTop')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Bind' }).length).toBe(2);
  });

  it('suppresses HIGH chips in auto-fix rows but keeps deviation chips', () => {
    renderView({ scanResult: mockScanResult, status: 'scanned' });

    // High confidence is the silent default: no HIGH chip anywhere.
    expect(screen.queryByText('high')).toBeNull();
    expect(screen.queryByText('HIGH')).toBeNull();
    // The medium-confidence row in "Review suggestions" keeps its chip.
    expect(screen.getByText('medium')).toBeTruthy();
  });

  it('shows in-component findings without hiding or letting them be bound', () => {
    renderView({
      scanResult: {
        ...mockScanResult,
        tokenAudit: {
          ...mockScanResult.tokenAudit,
          issues: [
            ...mockScanResult.tokenAudit.issues,
            {
              id: 'inst-9:fill:0',
              nodeId: 'inst-9',
              nodeName: 'Inside Instance',
              property: 'fill',
              bindingTarget: { field: 'fills', paintIndex: 0 },
              currentValue: '#101010',
              isEditableHere: false,
            },
          ],
        },
      },
      status: 'scanned',
    });

    // The finding is visible in its own group, marked as belonging to the
    // main component — not hidden behind a scope filter.
    const group = screen.getByRole('region', { name: 'Fix in the main component' });
    expect(within(group).getByText('Inside Instance')).toBeTruthy();
    // In-instance rows never get a Bind button.
    expect(within(group).queryByRole('button', { name: 'Bind' })).toBeNull();
    // Editable rows elsewhere still do.
    expect(screen.getByRole('button', { name: 'Bind 1 high-confidence' })).toBeTruthy();
  });

  it('keeps the property filter and chosen tokens across rescans', () => {
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

    const view = renderView({ scanResult: scanWithAlternatives, status: 'scanned' });

    fireEvent.click(screen.getByRole('radio', { name: 'Fills' }));
    const dropdown = screen.getByLabelText('Token for Card fill');
    fireEvent.keyDown(dropdown, { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('radio', { name: 'color/white' }));

    // A background rescan (new scanId, same issues) keeps both choices.
    view.rerender(
      <DesignHealthView
        {...view.props}
        scanResult={{ ...scanWithAlternatives, scanId: 'test-scan-2', scannedAt: Date.now() }}
        status="scanned"
      />,
    );

    expect(
      (screen.getByRole('radio', { name: 'Fills' }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(screen.getByLabelText('Token for Card fill')).toBeTruthy();
    expect(screen.getAllByText('color/white').length).toBeGreaterThan(0);
  });

  it('lets the user choose an alternative token and bind it', () => {
    const onApplyTokenBindings = vi.fn();
    renderView({
      scanResult: {
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
      },
      status: 'scanned',
      onApplyTokenBindings,
    });

    const dropdown = screen.getByLabelText('Token for Card fill');
    fireEvent.keyDown(dropdown, { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('radio', { name: 'color/white' }));

    fireEvent.click(screen.getByRole('button', { name: 'Bind' }));

    expect(onApplyTokenBindings).toHaveBeenCalledWith([
      {
        nodeId: 'card-1',
        property: 'fill',
        bindingTarget: { field: 'fills', paintIndex: 0 },
        variableId: 'var-color-white',
      },
    ]);
  });

  it('focuses a node without changing the audited subject', () => {
    const onFocusNode = vi.fn();
    renderView({ scanResult: mockScanResult, status: 'scanned', onFocusNode });

    fireEvent.click(screen.getByRole('button', { name: 'Submit Button' }));

    expect(onFocusNode).toHaveBeenCalledWith('12:35');
  });

  it('shows the honest nothing-to-audit state for zero-property selections', () => {
    renderView({
      scanResult: {
        ...mockScanResult,
        tokenAudit: {
          audited: false,
          totalPropertiesScanned: 0,
          boundPropertiesCount: 0,
          unboundPropertiesCount: 0,
          tokenCoveragePercent: 0,
          highConfidenceCount: 0,
          mediumConfidenceCount: 0,
          lowConfidenceCount: 0,
          issues: [],
        },
      },
      status: 'scanned',
    });

    expect(screen.getByText('Nothing to audit')).toBeTruthy();
    expect(screen.queryByText(/100% coverage/)).toBeNull();
  });

  it('claims full coverage only when every property really is bound', () => {
    renderView({
      scanResult: {
        ...mockScanResult,
        tokenAudit: {
          ...mockScanResult.tokenAudit,
          audited: true,
          totalPropertiesScanned: 10,
          boundPropertiesCount: 10,
          unboundPropertiesCount: 0,
          tokenCoveragePercent: 100,
          issues: [],
        },
      },
      status: 'scanned',
    });

    expect(screen.getByText('All properties bound')).toBeTruthy();
  });

  it('distinguishes an empty filter result from full coverage and can clear it', () => {
    renderView({ scanResult: mockScanResult, status: 'scanned' });

    fireEvent.click(screen.getByRole('radio', { name: 'Opacity' }));

    expect(screen.getByText('No issues match the current filter')).toBeTruthy();
    expect(screen.getByText(/2 unbound properties remain in this selection/)).toBeTruthy();
    expect(screen.queryByText(/100% coverage/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(screen.getByText('Ready to auto-fix (1)')).toBeTruthy();
    expect(screen.queryByText('No issues match the current filter')).toBeNull();
  });

  it('surfaces deprecated components with canvas focus', () => {
    const onFocusNode = vi.fn();
    renderView({
      scanResult: mockScanResult,
      status: 'scanned',
      onFocusNode,
    });

    fireEvent.click(screen.getByRole('radio', { name: /^Library/ }));

    expect(screen.getByText('Deprecated components (1)')).toBeTruthy();
    expect(screen.getByText('Use TashilIcon instead')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    expect(onFocusNode).toHaveBeenCalledWith('inst-dep-1');
  });

  it('does not claim library updates are available when no marker exists', () => {
    renderView({
      scanResult: {
        ...mockScanResult,
        libraryHealth: {
          ...mockScanResult.libraryHealth,
          deprecatedInstances: [],
        },
      },
      status: 'scanned',
    });

    fireEvent.click(screen.getByRole('radio', { name: /^Library/ }));
    expect(screen.getByText(/Native library update availability is not exposed/)).toBeTruthy();
  });
});
