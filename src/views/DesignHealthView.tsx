import {
  Banner,
  Button,
  Dropdown,
  IconButton,
  IconApprovedCheckmark24,
  IconAutoLayoutPaddingAll24,
  IconAutoLayoutSpacingHorizontal24,
  IconCorners24,
  IconLibrary16,
  IconOpacity24,
  IconRefresh16,
  IconVariable16,
  IconWarningSmall24,
  LoadingIndicator,
  SegmentedControl,
  Tabs,
} from '@create-figma-plugin/ui';
import { Fragment, h } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type {
  DesignHealthScanResult,
  TokenBindingRequest,
  TokenPropertyIssue,
  TokenSuggestion,
} from '../design-health/types';
import { filterHighConfidenceIssues } from '../design-health/token-audit';
import { EmptyInspectState } from '../components/common';
import { IconInteractionClickSmall48 } from '../ui-assets';

export interface DesignHealthViewProps {
  scanResult: DesignHealthScanResult | null;
  status: 'idle' | 'scanning' | 'scanned' | 'binding' | 'error';
  message: string;
  onScan: () => void;
  onApplyTokenBindings: (bindings: TokenBindingRequest[]) => void;
  onFocusNode: (nodeId: string) => void;
}

type PropertyFilter = 'all' | 'fill' | 'stroke' | 'cornerRadius' | 'spacing' | 'opacity';
type SubTab = 'tokens' | 'library';

const PROPERTY_FILTERS: Array<{ label: string; value: PropertyFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Fills', value: 'fill' },
  { label: 'Strokes', value: 'stroke' },
  { label: 'Radius', value: 'cornerRadius' },
  { label: 'Spacing', value: 'spacing' },
  { label: 'Opacity', value: 'opacity' },
];

function matchesPropertyFilter(issue: TokenPropertyIssue, filter: PropertyFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'spacing') {
    return issue.property === 'gap' || issue.property === 'padding';
  }
  return issue.property === filter;
}

/** Sub-tab label format: "Name (N)"; a zero count renders the bare name. */
function withCount(label: string, count: number): string {
  return count > 0 ? `${label} (${count})` : label;
}

/** Neutral wording for a relative "updated" stamp. */
function formatRelativeTime(timestamp: number, now: number): string {
  const elapsedSeconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (elapsedSeconds < 60) return 'just now';
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  return `${elapsedHours} h ago`;
}

/**
 * Near/name suggestions intentionally propose a different value than the
 * layer's raw one — surface it next to the token name so the trade-off is
 * visible before binding.
 */
function suggestedValueSuffix(suggestion: TokenSuggestion, currentValue: string | number): string {
  if (suggestion.suggestedValue === undefined) return '';
  const suggested = String(suggestion.suggestedValue);
  return suggested === String(currentValue) ? '' : ` — ${suggested}`;
}

type CoverageTone = 'success' | 'neutral' | 'warning' | 'danger';

const COVERAGE_RING_RADIUS = 30;
const COVERAGE_CIRCUMFERENCE = 2 * Math.PI * COVERAGE_RING_RADIUS;

/**
 * Graded so a decent score never reads as a failure: 50-79% is neutral
 * (brand), warning only kicks in below 50%, danger below 25%.
 */
function coverageTone(coveragePercent: number): CoverageTone {
  if (coveragePercent >= 80) return 'success';
  if (coveragePercent >= 50) return 'neutral';
  if (coveragePercent >= 25) return 'warning';
  return 'danger';
}

interface IssueCluster {
  nodeId: string;
  nodeName: string;
  issues: TokenPropertyIssue[];
}

/**
 * Consecutive audits of one node (itemSpacing + four padding edges) produce
 * near-identical rows; clustering by node keeps the list scannable. Order of
 * first appearance is preserved.
 */
function clusterByNode(issues: TokenPropertyIssue[]): IssueCluster[] {
  const clusters: IssueCluster[] = [];
  const byNodeId = new Map<string, IssueCluster>();
  for (const issue of issues) {
    const existing = byNodeId.get(issue.nodeId);
    if (existing) {
      existing.issues.push(issue);
      continue;
    }
    const cluster: IssueCluster = {
      nodeId: issue.nodeId,
      nodeName: issue.nodeName,
      issues: [issue],
    };
    byNodeId.set(issue.nodeId, cluster);
    clusters.push(cluster);
  }
  return clusters;
}

function issueIcon(issue: TokenPropertyIssue): h.JSX.Element {
  if (issue.property === 'fill' || issue.property === 'stroke') {
    return (
      <span
        aria-hidden="true"
        class="health-issue-swatch"
        title={`Color: ${String(issue.currentValue)}`}
      >
        <span class="health-issue-swatch-color" style={{ backgroundColor: String(issue.currentValue) }} />
      </span>
    );
  }
  const icon = issue.property === 'cornerRadius'
    ? <IconCorners24 />
    : issue.property === 'gap'
      ? <IconAutoLayoutSpacingHorizontal24 />
      : issue.property === 'padding'
        ? <IconAutoLayoutPaddingAll24 />
        : <IconOpacity24 />;
  return (
    <span
      aria-hidden="true"
      class="health-issue-icon"
      title={issue.property === 'cornerRadius'
        ? 'Corner radius'
        : issue.property === 'gap'
          ? 'Layout gap'
          : issue.property === 'padding'
            ? 'Padding'
            : 'Opacity'}
    >
      {icon}
    </span>
  );
}

export function DesignHealthView(props: DesignHealthViewProps): h.JSX.Element {
  const [subTab, setSubTab] = useState<SubTab>('tokens');
  const [propertyFilter, setPropertyFilter] = useState<PropertyFilter>('all');
  const [selectedSuggestions, setSelectedSuggestions] = useState<Record<string, TokenSuggestion>>({});
  const [now, setNow] = useState<number>(() => Date.now());

  const { scanResult, status, message } = props;

  const isScanning = status === 'scanning';
  const isBinding = status === 'binding';

  const allIssues = scanResult?.tokenAudit.issues ?? [];

  // Rescans must not eat user work: background rescans (selection changes,
  // documentchange) fire while the user may be mid-decision. Chosen tokens
  // survive as long as their issue still exists; the property filter and the
  // analysis context persist until the thing they refer to actually changes.
  const effectiveSuggestions = useMemo(() => {
    const next: Record<string, TokenSuggestion> = {};
    for (const issue of allIssues) {
      const chosen = selectedSuggestions[issue.id];
      if (chosen) {
        next[issue.id] = chosen;
      }
    }
    return next;
  }, [allIssues, selectedSuggestions]);

  // Keep the relative "updated" stamp honest.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // If the scan failed with no previous result, offer a retry.
  if (status === 'error' && !scanResult) {
    return (
      <EmptyInspectState
        actionLabel="Retry Audit"
        icon={<IconWarningSmall24 />}
        label={message || 'Unable to audit the selected layer. Select another layer or retry.'}
        onAction={props.onScan}
      />
    );
  }

  if (!scanResult && isScanning) {
    return (
      <main aria-labelledby="tashil-design-health-loading" class="health-loading-container">
        <LoadingIndicator />
        <span class="health-loading-text" id="tashil-design-health-loading">
          Auditing layer design health…
        </span>
      </main>
    );
  }

  if (!scanResult) {
    return (
      <EmptyInspectState
        icon={<IconInteractionClickSmall48 />}
        label="Select a frame or layer on the canvas to inspect its design health"
      />
    );
  }

  const tokenAudit = scanResult.tokenAudit;
  // Every finding is always visible: rows inside component instances render
  // with a "Fix in the main component" marker instead of a Bind button, so
  // nothing needs hiding and every count reconciles with the full audit.
  const displayedIssues = allIssues.filter((issue) => matchesPropertyFilter(issue, propertyFilter));
  const autoFixableIssues = filterHighConfidenceIssues(allIssues).filter(
    (issue) => matchesPropertyFilter(issue, propertyFilter),
  );
  const needsDecisionIssues = displayedIssues.filter(
    (issue) => issue.isEditableHere && issue.suggestion && issue.suggestion.confidence !== 'high',
  );
  const noMatchIssues = displayedIssues.filter((issue) => issue.isEditableHere && !issue.suggestion);
  const mainComponentIssues = displayedIssues.filter((issue) => !issue.isEditableHere);

  // Coverage spans both tabs: token properties AND library findings
  // (deprecated instances count as unresolved problems).
  const deprecatedCount = scanResult.libraryHealth.deprecatedInstances.length;
  const healthTotal = tokenAudit.totalPropertiesScanned + deprecatedCount;
  const coveragePercent = healthTotal > 0
    ? Math.min(100, Math.max(0, Math.round((tokenAudit.boundPropertiesCount / healthTotal) * 100)))
    : 0;
  const tone = coverageTone(coveragePercent);

  const headerStatus = isScanning
    ? 'Auditing…'
    : isBinding
      ? 'Binding tokens…'
      : status === 'error'
        ? 'Update failed — Retry'
        : `Up to date · ${formatRelativeTime(scanResult.scannedAt, now)}`;

  const handleChooseSuggestion = (
    issue: TokenPropertyIssue,
    candidates: TokenSuggestion[],
    variableId: string,
  ): void => {
    const matched = candidates.find((candidate) => candidate.variableId === variableId);
    if (matched) {
      setSelectedSuggestions((previous) => ({ ...previous, [issue.id]: matched }));
    }
  };

  const buildBinding = (issue: TokenPropertyIssue): TokenBindingRequest | null => {
    const suggestion = effectiveSuggestions[issue.id] || issue.suggestion;
    return suggestion
      ? {
          nodeId: issue.nodeId,
          property: issue.property,
          bindingTarget: issue.bindingTarget,
          variableId: suggestion.variableId,
        }
      : null;
  };

  const handleBindAllHighConfidence = (): void => {
    const bindings = autoFixableIssues
      .map(buildBinding)
      .filter((binding): binding is TokenBindingRequest => binding !== null);
    if (bindings.length > 0) {
      props.onApplyTokenBindings(bindings);
    }
  };

  const handleBindSingle = (issue: TokenPropertyIssue): void => {
    const binding = buildBinding(issue);
    if (binding) {
      props.onApplyTokenBindings([binding]);
    }
  };

  const renderIssueContent = (issue: TokenPropertyIssue, showNode: boolean): h.JSX.Element => {
    const chosenSuggestion = effectiveSuggestions[issue.id] || issue.suggestion;
    const alternativeCandidates: TokenSuggestion[] = [
      ...(issue.suggestion ? [issue.suggestion] : []),
      ...(issue.alternativeSuggestions || []),
    ];

    return (
      <div class="health-issue-content">
        {showNode ? (
          <button
            class="health-node-link"
            onClick={() => props.onFocusNode(issue.nodeId)}
            title="Show on canvas — the audited selection stays unchanged"
            type="button"
          >
            {issue.nodeName}
          </button>
        ) : null}
        <span class="health-issue-key">
          <span class="health-issue-field">{issue.bindingTarget.field}</span>
          <span class="health-issue-value">{String(issue.currentValue)}</span>
        </span>
        {chosenSuggestion ? (
          <Fragment>
            {alternativeCandidates.length > 1 && issue.isEditableHere ? (
              <span
                class="health-issue-picker"
                title={chosenSuggestion.reason || chosenSuggestion.variableName}
              >
                <Dropdown
                  aria-label={`Token for ${issue.nodeName} ${issue.property}`}
                  onValueChange={(variableId) => handleChooseSuggestion(issue, alternativeCandidates, variableId)}
                  options={alternativeCandidates.map((candidate) => ({
                    text: `${candidate.variableName}${suggestedValueSuffix(candidate, issue.currentValue)}`,
                    value: candidate.variableId,
                  }))}
                  value={chosenSuggestion.variableId}
                />
              </span>
            ) : (
              <strong
                class="health-issue-token"
                title={chosenSuggestion.reason || chosenSuggestion.variableName}
              >
                {`${chosenSuggestion.variableName}${suggestedValueSuffix(chosenSuggestion, issue.currentValue)}`}
              </strong>
            )}
            {chosenSuggestion.confidence !== 'high' ? (
              <span
                class={`confidence-chip confidence-${chosenSuggestion.confidence}`}
                title={chosenSuggestion.reason}
              >
                {chosenSuggestion.confidence}
              </span>
            ) : null}
          </Fragment>
        ) : (
          <span class="health-issue-nomatch">No matching token found</span>
        )}
      </div>
    );
  };

  const renderIssueAction = (issue: TokenPropertyIssue): h.JSX.Element => (
    <div class="health-issue-action">
      {issue.isEditableHere && (effectiveSuggestions[issue.id] || issue.suggestion) ? (
        <Button
          disabled={isBinding}
          onClick={() => handleBindSingle(issue)}
        >
          Bind
        </Button>
      ) : null}
    </div>
  );

  // Every node renders as the same cluster card — header (node name + unbound
  // count) with its property row(s) inside — whether it has one finding or
  // many, so the list stays visually consistent.
  const renderIssueCluster = (cluster: IssueCluster): h.JSX.Element => (
    <div class="health-node-cluster" key={cluster.nodeId}>
      <div class="health-cluster-header">
        <button
          class="health-node-link"
          onClick={() => props.onFocusNode(cluster.nodeId)}
          title="Show on canvas — the audited selection stays unchanged"
          type="button"
        >
          {cluster.nodeName}
        </button>
        <span class="health-cluster-count">
          ({cluster.issues.length})
        </span>
      </div>
      <div class="health-cluster-rows">
        {cluster.issues.map((issue) => (
          <div class="health-issue-row health-issue-row-nested" key={issue.id}>
            {issueIcon(issue)}
            {renderIssueContent(issue, false)}
            {renderIssueAction(issue)}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <main aria-labelledby="tashil-design-health-heading" class="design-health-view">
      <header class="health-header">
        <div class="health-header-info">
          <h1 class="health-heading" id="tashil-design-health-heading">Design Health</h1>
          <p class="health-header-description">
            Audit layer token coverage, batch-bind recommended tokens, and track
            deprecated library instances.
          </p>
        </div>
        <div class="health-header-actions">
          <span
            class={`health-status-text${status === 'error' ? ' health-status-text-error' : ''}`}
            role="status"
          >
            {isScanning ? <LoadingIndicator /> : null}
            {headerStatus}
          </span>
          <IconButton onClick={props.onScan} title="Re-audit selection">
            <IconRefresh16 />
          </IconButton>
        </div>
      </header>

      {message && !isScanning ? (
        status === 'error' ? (
          <p class="field-error" role="alert">{message}</p>
        ) : (
          <Banner icon={<IconApprovedCheckmark24 />} variant="success">{message}</Banner>
        )
      ) : null}

      {scanResult.capReached ? (
        <Banner icon={<IconWarningSmall24 />} variant="warning">
          Partial audit: the 800-layer limit was reached — results cover part of this selection.
        </Banner>
      ) : null}

      {scanResult.selectionCount > 1 ? (
        <Banner icon={<IconWarningSmall24 />} variant="warning">
          Multiple layers are selected — only the first one was audited.
        </Banner>
      ) : null}

      {/* Coverage spans both tabs: token properties plus library findings
          (deprecated instances) — the ring sits above the sub-tab bar for
          that reason. */}
      <div
        aria-valuenow={coveragePercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${coveragePercent} percent — ${tokenAudit.boundPropertiesCount} of ${healthTotal} items bound`}
        class="health-coverage"
        role="meter"
      >
        <div class="health-coverage-ring">
          <svg
            aria-hidden="true"
            class="health-coverage-svg"
            viewBox="0 0 72 72"
          >
            <circle
              class="health-coverage-track"
              cx="36"
              cy="36"
              r="30"
            />
            <circle
              class={`health-coverage-fill health-tone-${tone}-stroke`}
              cx="36"
              cy="36"
              r="30"
              strokeDasharray={COVERAGE_CIRCUMFERENCE}
              strokeDashoffset={COVERAGE_CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, coveragePercent)) / 100)}
            />
          </svg>
          <span class={`health-coverage-pct health-tone-${tone}-text`}>{coveragePercent}%</span>
        </div>
        <p class="health-coverage-caption">
          {tokenAudit.boundPropertiesCount} of {healthTotal} items bound
        </p>
      </div>

      {/* Tab labels carry their related library icon. The children are JSX
          (icons require it), so `.health-tab-option` reproduces the library
          `.text` padding that element children would otherwise bypass. */}
      <div class="health-tabs-row">
        <SegmentedControl
          onValueChange={(value) => setSubTab(value as SubTab)}
          options={[
            {
              children: (
                <span class="health-tab-option">
                  <IconVariable16 />
                  <span>{withCount('Tokens', allIssues.length)}</span>
                </span>
              ),
              value: 'tokens',
            },
            {
              children: (
                <span class="health-tab-option">
                  <IconLibrary16 />
                  <span>{withCount('Library', scanResult.libraryHealth.deprecatedInstances.length)}</span>
                </span>
              ),
              value: 'library',
            },
          ]}
          value={subTab}
        />
      </div>

      {subTab === 'tokens' ? (
        <section aria-label="Token audit" class="health-panel">
          {!tokenAudit.audited ? (
            <div class="health-empty-note">
              <h3 class="health-empty-heading">Nothing to audit</h3>
              <p>No auditable fill, stroke, radius, spacing, or opacity properties were found on this selection.</p>
            </div>
          ) : (
            <Fragment>
              {tokenAudit.unboundPropertiesCount === 0 ? (
                <div class="health-empty-note health-empty-note-success">
                  <h3 class="health-empty-heading">All properties bound</h3>
                  <p>
                    Every audited property in this selection is linked to a design token — 100% coverage.
                  </p>
                </div>
              ) : (
                <Fragment>
                  <div class="health-filter-row">
                    {/* Labels render from `value` (the capitalized filter
                        name) and are mapped back to the filter key here. The
                        `children` slot stays empty — the filter owns no panel
                        content; it drives the list below. */}
                    <Tabs
                      onValueChange={(label) => {
                        const matched = PROPERTY_FILTERS.find((filter) => filter.label === label);
                        if (matched) {
                          setPropertyFilter(matched.value);
                        }
                      }}
                      options={PROPERTY_FILTERS.map((filter) => ({
                        value: filter.label,
                        children: null,
                      }))}
                      value={PROPERTY_FILTERS.find((filter) => filter.value === propertyFilter)?.label ?? 'All'}
                    />
                  </div>
                  {propertyFilter !== 'all' ? (
                    <p class="health-showing-line" role="status">
                      Showing {displayedIssues.length} of {allIssues.length} issues
                    </p>
                  ) : null}

                  {displayedIssues.length === 0 ? (
                    <div class="health-empty-note">
                      <h3 class="health-empty-heading">No issues match the current filter</h3>
                      <p>
                        {allIssues.length} unbound {allIssues.length === 1 ? 'property remains' : 'properties remain'} in this selection.
                      </p>
                      <Button onClick={() => setPropertyFilter('all')} secondary>
                        Clear filter
                      </Button>
                    </div>
                  ) : (
                    <Fragment>
                      {autoFixableIssues.length > 0 ? (
                        <section aria-label="Ready to auto-fix" class="health-issue-group">
                          <div class="health-group-heading-row">
                            <h2 class="health-group-heading">Ready to auto-fix ({autoFixableIssues.length})</h2>
                            <Button disabled={isBinding} onClick={handleBindAllHighConfidence}>
                              {isBinding
                                ? 'Binding…'
                                : propertyFilter === 'all'
                                  ? `Bind ${autoFixableIssues.length} high-confidence`
                                  : `Bind ${autoFixableIssues.length} in ${PROPERTY_FILTERS.find((filter) => filter.value === propertyFilter)?.label ?? ''}`}
                            </Button>
                          </div>
                          <div class="health-issue-list">
                            {clusterByNode(autoFixableIssues).map(renderIssueCluster)}
                          </div>
                        </section>
                      ) : null}
                      {needsDecisionIssues.length > 0 ? (
                        <section aria-label="Review suggestions" class="health-issue-group">
                          <h2 class="health-group-heading">Review suggestions ({needsDecisionIssues.length})</h2>
                          <div class="health-issue-list">
                            {clusterByNode(needsDecisionIssues).map(renderIssueCluster)}
                          </div>
                        </section>
                      ) : null}
                      {noMatchIssues.length > 0 ? (
                        <section aria-label="No token match" class="health-issue-group">
                          <h2 class="health-group-heading">No token match ({noMatchIssues.length})</h2>
                          <div class="health-issue-list">
                            {clusterByNode(noMatchIssues).map(renderIssueCluster)}
                          </div>
                        </section>
                      ) : null}
                      {mainComponentIssues.length > 0 ? (
                        <section aria-label="Fix in the main component" class="health-issue-group">
                          <h2 class="health-group-heading">Fix in the main component ({mainComponentIssues.length})</h2>
                          <div class="health-issue-list">
                            {clusterByNode(mainComponentIssues).map(renderIssueCluster)}
                          </div>
                        </section>
                      ) : null}
                    </Fragment>
                  )}
                </Fragment>
              )}
            </Fragment>
          )}
        </section>
      ) : null}

      {subTab === 'library' ? (
        <section aria-label="Library health" class="health-panel">
          <div class="health-stats-grid">
            <div class="health-stat">
              <div class="health-stat-value">{scanResult.libraryHealth.totalInstances}</div>
              <div class="health-stat-label">Total instances</div>
            </div>
            <div class="health-stat">
              <div class="health-stat-value">{scanResult.libraryHealth.uniqueComponentsCount}</div>
              <div class="health-stat-label">Unique components</div>
            </div>
            <div class="health-stat">
              <div class="health-stat-value">{scanResult.libraryHealth.remoteInstancesCount}</div>
              <div class="health-stat-label">Library (remote)</div>
            </div>
            <div class="health-stat">
              <div class="health-stat-value">{scanResult.libraryHealth.localInstancesCount}</div>
              <div class="health-stat-label">Local</div>
            </div>
          </div>

          {scanResult.libraryHealth.deprecatedInstances.length > 0 ? (
            <div class="health-deprecated-list">
              <h2 class="health-group-heading health-tone-warning-text">
                <IconWarningSmall24 />
                Deprecated components ({scanResult.libraryHealth.deprecatedInstances.length})
              </h2>
              {scanResult.libraryHealth.deprecatedInstances.map((notice) => (
                <div class="health-deprecated-card" key={notice.nodeId}>
                  <div class="health-deprecated-info">
                    <button
                      class="health-node-link"
                      onClick={() => props.onFocusNode(notice.nodeId)}
                      title="Show on canvas — the audited selection stays unchanged"
                      type="button"
                    >
                      {notice.instanceName}
                    </button>
                    <p class="health-deprecated-component">
                      Component: <strong>{notice.componentName}</strong>
                    </p>
                    <p class="health-deprecated-notice">{notice.deprecationNotice}</p>
                  </div>
                  <div class="health-deprecated-actions">
                    <Button onClick={() => props.onFocusNode(notice.nodeId)} secondary>
                      Focus
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div class="health-empty-note">
              <h3 class="health-empty-heading">No deprecated components</h3>
              <p>
                No deprecation markers were found. Native library update availability is not exposed
                by Figma's public plugin API.
              </p>
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
