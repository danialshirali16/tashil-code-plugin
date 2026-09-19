import {
  Button,
  Checkbox,
  Dropdown,
  IconButton,
  IconComponent16,
  IconFrame16,
  IconRefresh16,
  IconWarningSmall24,
  LoadingIndicator,
  Textbox,
} from '@create-figma-plugin/ui';
import { Fragment, h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type {
  CompatibilityPlan,
  ComponentReplacementExecutionRequest,
  DesignHealthScanResult,
  TokenBindingRequest,
  TokenPropertyIssue,
  TokenSuggestion,
} from '../design-health/types';
import { filterHighConfidenceIssues } from '../design-health/token-audit';
import {
  EmptyInspectState,
  Field,
} from '../components/common';
import { IconInteractionClickSmall48 } from '../ui-assets';

export interface DesignHealthViewProps {
  scanResult: DesignHealthScanResult | null;
  status: 'idle' | 'scanning' | 'scanned' | 'binding' | 'replacing' | 'error';
  message: string;
  compatibilityPlan: CompatibilityPlan | null;
  compatibilityPlanStatus: 'idle' | 'loading' | 'loaded' | 'error';
  onScan: () => void;
  onApplyTokenBindings: (bindings: TokenBindingRequest[]) => void;
  onLoadCompatibilityPlan: (sourceKey: string, targetKey: string, instancesCount: number) => void;
  onExecuteReplacement: (request: ComponentReplacementExecutionRequest) => void;
  onFocusNode: (nodeId: string) => void;
}

export function DesignHealthView(props: DesignHealthViewProps): h.JSX.Element {
  const [subTab, setSubTab] = useState<'tokens' | 'replacement' | 'library'>('tokens');
  const [propertyFilter, setPropertyFilter] = useState<'all' | 'fill' | 'stroke' | 'cornerRadius' | 'spacing' | 'opacity'>('all');
  const [selectedSourceKey, setSelectedSourceKey] = useState<string>('');
  const [targetComponentKey, setTargetComponentKey] = useState<string>('');
  const [editableOnlyFilter, setEditableOnlyFilter] = useState<boolean>(true);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Record<string, TokenSuggestion>>({});
  const [analyzedSourceKey, setAnalyzedSourceKey] = useState('');
  const [analyzedTargetKey, setAnalyzedTargetKey] = useState('');

  const { scanResult, status, message } = props;

  const isScanning = status === 'scanning';
  const isBinding = status === 'binding';
  const isReplacing = status === 'replacing';

  useEffect(() => {
    setSelectedSuggestions({});
    setAnalyzedSourceKey('');
    setAnalyzedTargetKey('');
  }, [scanResult?.scanId]);

  // If scan failed with an error and no result yet
  if (status === 'error' && !scanResult) {
    return (
      <div class="health-empty-container">
        <div
          class="health-error-banner"
          style={{
            margin: '24px 16px',
            padding: '16px',
            background: 'var(--figma-color-bg-danger-tertiary, #fff0f0)',
            borderRadius: '6px',
            border: '1px solid var(--figma-color-border-danger, #fca5a5)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--figma-color-text-danger, #b91c1c)', fontWeight: 600 }}>
            <IconWarningSmall24 />
            <span>Inspection Error</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--figma-color-text, #333)', lineHeight: '16px' }}>
            {message || 'Unable to inspect the selected layer. Select another layer or retry the audit.'}
          </div>
          <div>
            <Button onClick={props.onScan} secondary>
              Retry Audit
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // If initial scan is in flight and no result yet
  if (!scanResult && isScanning) {
    return (
      <div class="health-loading-container">
        <LoadingIndicator />
        <span class="health-loading-text">Auditing layer design health…</span>
      </div>
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

  const allIssues = scanResult.tokenAudit.issues || [];
  const editableFilteredIssues = allIssues.filter((issue) => (editableOnlyFilter ? issue.isEditableHere : true));
  const displayedIssues = editableFilteredIssues.filter((issue) => {
    if (propertyFilter === 'all') return true;
    if (propertyFilter === 'fill') return issue.property === 'fill';
    if (propertyFilter === 'stroke') return issue.property === 'stroke';
    if (propertyFilter === 'cornerRadius') return issue.property === 'cornerRadius';
    if (propertyFilter === 'spacing') return issue.property === 'spacing' || issue.property === 'gap' || issue.property === 'padding';
    if (propertyFilter === 'opacity') return issue.property === 'opacity';
    return true;
  });

  const highConfidenceIssues = filterHighConfidenceIssues(editableFilteredIssues);

  const handleBindAllHighConfidence = () => {
    const bindings: TokenBindingRequest[] = highConfidenceIssues
      .map((i) => {
        const suggestion = selectedSuggestions[i.id] || i.suggestion;
        return suggestion
          ? {
              nodeId: i.nodeId,
              property: i.property,
              bindingTarget: i.bindingTarget,
              variableId: suggestion.variableId,
            }
          : null;
      })
      .filter((b): b is TokenBindingRequest => b !== null);
    if (bindings.length > 0) {
      props.onApplyTokenBindings(bindings);
    }
  };

  const handleBindSingle = (issue: TokenPropertyIssue) => {
    const suggestion = selectedSuggestions[issue.id] || issue.suggestion;
    if (!suggestion) return;
    props.onApplyTokenBindings([
      {
        nodeId: issue.nodeId,
        property: issue.property,
        bindingTarget: issue.bindingTarget,
        variableId: suggestion.variableId,
      },
    ]);
  };

  const handleRequestPlan = () => {
    if (!selectedSourceKey || !targetComponentKey) return;
    const candidate = scanResult.componentCandidates.find(
      (item) => item.sourceComponentKey === selectedSourceKey,
    );
    if (!candidate) return;

    const normalizedTargetKey = targetComponentKey.trim();
    setAnalyzedSourceKey(selectedSourceKey);
    setAnalyzedTargetKey(normalizedTargetKey);
    props.onLoadCompatibilityPlan(selectedSourceKey, normalizedTargetKey, candidate.instancesCount);
  };

  const isCompatibilityPlanCurrent = Boolean(
    props.compatibilityPlan
    && analyzedSourceKey === selectedSourceKey
    && analyzedTargetKey === targetComponentKey.trim()
    && props.compatibilityPlan.sourceComponentKey === selectedSourceKey,
  );

  const handleExecuteReplacement = () => {
    if (!props.compatibilityPlan || !isCompatibilityPlanCurrent || !selectedSourceKey || !scanResult) return;

    const candidate = scanResult.componentCandidates.find(
      (c) => c.sourceComponentKey === selectedSourceKey,
    );
    if (!candidate) return;

    const propertyMappings: Record<string, string> = {};
    for (const prop of props.compatibilityPlan.properties) {
      if (prop.status === 'preserved' && prop.targetName) {
        propertyMappings[prop.normalizedName] = prop.targetName;
      }
    }

    props.onExecuteReplacement({
      sourceComponentKey: selectedSourceKey,
      targetComponentKey: targetComponentKey.trim(),
      instanceIds: candidate.instanceIds,
      propertyMappings,
    });
  };

  // Score gauge calculation
  const gaugeRadius = 26;
  const gaugeCircumference = 2 * Math.PI * gaugeRadius; // ~163.36
  const coveragePct = Math.round(scanResult.tokenAudit.tokenCoveragePercent);
  const strokeDashoffset = gaugeCircumference * (1 - Math.min(100, Math.max(0, coveragePct)) / 100);
  const strokeColor = coveragePct >= 80 ? '#14ae5c' : coveragePct >= 50 ? '#ffaa00' : '#f24822';

  const isComponentOrInstance = scanResult.targetNode.type === 'COMPONENT' || scanResult.targetNode.type === 'INSTANCE';

  return (
    <div class="design-health-view">
      {/* Top Layer Header */}
      <div class="health-header">
        <div class="health-header-info">
          <div class="health-header-icon">
            {isComponentOrInstance ? <IconComponent16 /> : <IconFrame16 />}
          </div>
          <div class="health-header-titles">
            <div class="health-header-name-row">
              <span class="health-header-name" title={scanResult.targetNode.name}>
                {scanResult.targetNode.name}
              </span>
              <span class="health-header-badge">
                {scanResult.targetNode.type}
              </span>
            </div>
          </div>
        </div>

        <div class="health-header-actions">
          {isScanning ? (
            <span class="health-status-indicator">
              <LoadingIndicator />
              <span>Auditing…</span>
            </span>
          ) : (
            <span class="health-status-indicator health-status-indicator-live">
              <span class="health-status-dot" />
              <span>Auto-Audited</span>
            </span>
          )}

          <IconButton
            onClick={props.onScan}
            title="Re-audit selection"
          >
            <IconRefresh16 />
          </IconButton>
        </div>
      </div>

      {/* Optional Banner Message */}
      {message ? (
        <div
          role="status"
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '11px',
            background: status === 'error' ? 'rgba(242, 72, 34, 0.1)' : 'rgba(13, 153, 255, 0.1)',
            color: status === 'error' ? 'var(--figma-color-text-danger, #f24822)' : 'var(--figma-color-text-brand, #0d99ff)',
            border: '1px solid currentColor',
          }}
        >
          {message}
        </div>
      ) : null}

      {/* Hero Score & Breakdown Card */}
      <div class="health-hero-card">
        <div class="health-score-ring-container">
          <div class="health-score-gauge">
            <svg class="health-gauge-svg" viewBox="0 0 64 64">
              <circle class="health-gauge-track" cx="32" cy="32" r={gaugeRadius} />
              <circle
                class="health-gauge-val"
                cx="32"
                cy="32"
                r={gaugeRadius}
                stroke={strokeColor}
                strokeDasharray={gaugeCircumference}
                strokeDashoffset={strokeDashoffset}
              />
            </svg>
            <div class="health-gauge-center">
              <span class="health-gauge-pct" style={{ color: strokeColor }}>
                {coveragePct}%
              </span>
            </div>
          </div>
          <div class="health-score-label">Token Coverage</div>
        </div>

        <div class="health-metrics-grid">
          <div class="health-metric-item">
            <div class="health-metric-val health-metric-val-success">
              {scanResult.tokenAudit.boundPropertiesCount}
            </div>
            <div class="health-metric-lbl">Bound Tokens</div>
          </div>
          <div class="health-metric-item">
            <div class={`health-metric-val ${scanResult.tokenAudit.unboundPropertiesCount > 0 ? 'health-metric-val-warning' : 'health-metric-val-success'}`}>
              {scanResult.tokenAudit.unboundPropertiesCount}
            </div>
            <div class="health-metric-lbl">Raw Values</div>
          </div>
          <div class="health-metric-item">
            <div class="health-metric-val">
              {scanResult.libraryHealth.totalInstances}
            </div>
            <div class="health-metric-lbl">
              Components{scanResult.libraryHealth.deprecatedInstances.length > 0 ? ` (⚠️ ${scanResult.libraryHealth.deprecatedInstances.length})` : ''}
            </div>
          </div>
        </div>
      </div>

      {/* Sub Navigation Tabs */}
      <div class="health-tabs" role="tablist">
        <button
          aria-selected={subTab === 'tokens'}
          class={`health-tab ${subTab === 'tokens' ? 'health-tab-active' : ''}`}
          onClick={() => setSubTab('tokens')}
          role="tab"
          type="button"
        >
          <span>Tokens</span>
          <span
            class={`health-tab-badge ${(editableOnlyFilter ? editableFilteredIssues.length : scanResult.tokenAudit.unboundPropertiesCount) > 0 ? 'health-tab-badge-warning' : 'health-tab-badge-neutral'}`}
            title={editableOnlyFilter ? `${editableFilteredIssues.length} editable unbound properties (${scanResult.tokenAudit.unboundPropertiesCount} total in tree)` : `${scanResult.tokenAudit.unboundPropertiesCount} total unbound properties in tree`}
          >
            {editableOnlyFilter ? editableFilteredIssues.length : scanResult.tokenAudit.unboundPropertiesCount}
          </span>
        </button>
        <button
          aria-selected={subTab === 'replacement'}
          class={`health-tab ${subTab === 'replacement' ? 'health-tab-active' : ''}`}
          onClick={() => setSubTab('replacement')}
          role="tab"
          type="button"
        >
          <span>Component Swaps</span>
          <span class="health-tab-badge health-tab-badge-info">
            {scanResult.componentCandidates.length}
          </span>
        </button>
        <button
          aria-selected={subTab === 'library'}
          class={`health-tab ${subTab === 'library' ? 'health-tab-active' : ''}`}
          onClick={() => setSubTab('library')}
          role="tab"
          type="button"
        >
          <span>Library Health</span>
          {scanResult.libraryHealth.deprecatedInstances.length > 0 ? (
            <span class="health-tab-badge health-tab-badge-warning">
              ⚠️ {scanResult.libraryHealth.deprecatedInstances.length}
            </span>
          ) : (
            <span class="health-tab-badge health-tab-badge-neutral">
              {scanResult.libraryHealth.totalInstances}
            </span>
          )}
        </button>
      </div>

      {/* TAB 1: TOKEN AUDIT */}
      {subTab === 'tokens' ? (
        <Fragment>
          {/* Action & Filter Row */}
          <div class="health-action-bar">
            <Checkbox
              onValueChange={(val) => setEditableOnlyFilter(val)}
              value={editableOnlyFilter}
            >
              Editable layers only
            </Checkbox>

            {highConfidenceIssues.length > 0 ? (
              <Button onClick={handleBindAllHighConfidence} disabled={isBinding}>
                {isBinding ? 'Binding…' : `Auto-Bind High Confidence (${highConfidenceIssues.length})`}
              </Button>
            ) : null}
          </div>

          {/* Property Category Filter Pills */}
          <div class="health-filter-pills">
            {(['all', 'fill', 'stroke', 'cornerRadius', 'spacing', 'opacity'] as const).map((kind) => {
              const count = kind === 'all'
                ? editableFilteredIssues.length
                : kind === 'fill'
                  ? editableFilteredIssues.filter((i) => i.property === 'fill').length
                  : kind === 'stroke'
                    ? editableFilteredIssues.filter((i) => i.property === 'stroke').length
                    : kind === 'cornerRadius'
                    ? editableFilteredIssues.filter((i) => i.property === 'cornerRadius').length
                      : kind === 'spacing'
                        ? editableFilteredIssues.filter((i) => i.property === 'spacing' || i.property === 'gap' || i.property === 'padding').length
                        : editableFilteredIssues.filter((i) => i.property === 'opacity').length;

              const label = kind === 'all'
                ? `All (${count})`
                : kind === 'fill'
                  ? `Fills (${count})`
                  : kind === 'stroke'
                    ? `Strokes (${count})`
                    : kind === 'cornerRadius'
                    ? `Radius (${count})`
                      : kind === 'spacing'
                        ? `Spacing (${count})`
                        : `Opacity (${count})`;

              return (
                <button
                  class={`health-filter-pill ${propertyFilter === kind ? 'health-filter-pill-active' : ''}`}
                  key={kind}
                  onClick={() => setPropertyFilter(kind)}
                  type="button"
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Issues List */}
          <div class="health-issue-list">
            {displayedIssues.length === 0 ? (
              <div class="health-clean-state">
                <h3>✓ 100% Token Coverage</h3>
                <p>All inspected properties in this scope are linked to design tokens.</p>
              </div>
            ) : (
              displayedIssues.map((issue) => {
                const isColor = issue.property === 'fill' || issue.property === 'stroke';
                const isRadius = issue.property === 'cornerRadius';
                const isSpacing = issue.property === 'spacing' || issue.property === 'gap' || issue.property === 'padding';
                const chosenSuggestion = selectedSuggestions[issue.id] || issue.suggestion;

                return (
                  <div class="health-issue-card" key={issue.id}>
                    {/* Visual Preview */}
                    {isColor ? (
                      <div class="health-issue-swatch" title={`Color: ${String(issue.currentValue)}`}>
                        <div
                          class="health-issue-swatch-color"
                          style={{ backgroundColor: String(issue.currentValue) }}
                        />
                      </div>
                    ) : isRadius ? (
                      <div class="health-issue-icon-badge" title="Corner Radius">R</div>
                    ) : isSpacing ? (
                      <div class="health-issue-icon-badge" title="Spacing / Padding">↔</div>
                    ) : (
                      <div class="health-issue-icon-badge">T</div>
                    )}

                    {/* Issue Details */}
                    <div class="health-issue-content">
                      <div class="health-issue-topline">
                        <button
                          class="health-issue-node-btn"
                          onClick={() => props.onFocusNode(issue.nodeId)}
                          title="Click to focus on canvas"
                          type="button"
                        >
                          {issue.nodeName}
                        </button>
                        <span class="health-issue-prop-tag">
                          {issue.bindingTarget.field}
                        </span>
                        <span class="health-issue-raw-val">
                          {String(issue.currentValue)}
                        </span>
                      </div>

                      {chosenSuggestion ? (
                        <div class="health-issue-suggestion">
                          <span style={{ color: 'var(--figma-color-text-secondary)' }}>➔</span>
                          {issue.alternativeSuggestions && issue.alternativeSuggestions.length > 0 ? (
                            <select
                              aria-label={`Alternative token suggestions for ${issue.nodeName} ${issue.property}`}
                              class="health-issue-alt-select"
                              onChange={(e) => {
                                const target = (e.target || e.currentTarget) as HTMLSelectElement;
                                const selectedId = target?.value;
                                const candidates = [issue.suggestion, ...issue.alternativeSuggestions!].filter(Boolean) as TokenSuggestion[];
                                const matched = candidates.find((c) => c.variableId === selectedId);
                                if (matched) {
                                  setSelectedSuggestions((prev) => ({ ...prev, [issue.id]: matched }));
                                }
                              }}
                              onInput={(e) => {
                                const target = (e.target || e.currentTarget) as HTMLSelectElement;
                                const selectedId = target?.value;
                                const candidates = [issue.suggestion, ...issue.alternativeSuggestions!].filter(Boolean) as TokenSuggestion[];
                                const matched = candidates.find((c) => c.variableId === selectedId);
                                if (matched) {
                                  setSelectedSuggestions((prev) => ({ ...prev, [issue.id]: matched }));
                                }
                              }}
                              value={chosenSuggestion.variableId}
                            >
                              {issue.suggestion ? (
                                <option value={issue.suggestion.variableId}>
                                  {issue.suggestion.variableName} ({issue.suggestion.confidence})
                                </option>
                              ) : null}
                              {issue.alternativeSuggestions.map((alt) => (
                                <option key={alt.variableId} value={alt.variableId}>
                                  {alt.variableName} ({alt.confidence})
                                </option>
                              ))}
                            </select>
                          ) : (
                            <strong style={{ color: 'var(--figma-color-text)' }}>
                              {chosenSuggestion.variableName}
                            </strong>
                          )}
                          <span class={`confidence-chip confidence-${chosenSuggestion.confidence}`}>
                            {chosenSuggestion.confidence}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--figma-color-text-secondary)', fontSize: '10px' }}>
                          No exact token match found
                        </span>
                      )}
                    </div>

                    {/* Action Button */}
                    <div class="health-issue-action">
                      {issue.isEditableHere && chosenSuggestion ? (
                        <Button
                          disabled={isBinding}
                          onClick={() => handleBindSingle(issue)}
                          secondary
                        >
                          Bind
                        </Button>
                      ) : !issue.isEditableHere ? (
                        <span class="health-subtle-tag" title="Inside an instance. Edit in main component.">
                          In Component
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Fragment>
      ) : null}

      {/* TAB 2: COMPONENT REPLACEMENT */}
      {subTab === 'replacement' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div class="health-form-description">
            Safely swap instances of legacy or local components with standardized Tashil components while preserving text overrides, variants, and dimensions.
          </div>

          <Field id="tashil-source-comp" label="Source Component in Selection:">
            <Dropdown
              id="tashil-source-comp"
              onChange={(e) => setSelectedSourceKey(e.currentTarget.value)}
              options={[
                { value: '', text: 'Select component to swap…' },
                ...scanResult.componentCandidates.map((c) => ({
                  value: c.sourceComponentKey,
                  text: `${c.sourceComponentName} (${c.instancesCount} instances)`,
                })),
              ]}
              value={selectedSourceKey}
            />
          </Field>

          <Field id="tashil-target-comp" label="Target Replacement Component Key:">
            <Textbox
              id="tashil-target-comp"
              onInput={(e) => setTargetComponentKey(e.currentTarget.value)}
              placeholder="Paste Tashil component key or ID…"
              value={targetComponentKey}
            />
          </Field>

          <Button
            disabled={!selectedSourceKey || !targetComponentKey.trim() || props.compatibilityPlanStatus === 'loading'}
            onClick={handleRequestPlan}
          >
            {props.compatibilityPlanStatus === 'loading' ? 'Analyzing Compatibility…' : 'Analyze Compatibility'}
          </Button>

          {/* Compatibility Plan Card */}
          {props.compatibilityPlan && isCompatibilityPlanCurrent ? (
            <div class="compatibility-report-card">
              <div class="compatibility-header">
                <strong style={{ fontSize: '12px' }}>Compatibility Report</strong>
                <span
                  class={`confidence-chip ${props.compatibilityPlan.canAutoMigrate ? 'confidence-high' : 'confidence-low'}`}
                >
                  {props.compatibilityPlan.canAutoMigrate ? 'Safe to Migrate' : 'Review Recommended'}
                </span>
              </div>

              <div class="compatibility-stats">
                <span style={{ color: '#14ae5c', fontWeight: 600 }}>
                  ✓ {props.compatibilityPlan.preservedCount} Preserved
                </span>
                <span style={{ color: '#ffaa00', fontWeight: 600 }}>
                  ! {props.compatibilityPlan.needsReviewCount} Needs Review
                </span>
                <span style={{ color: '#f24822', fontWeight: 600 }}>
                  ✕ {props.compatibilityPlan.atRiskCount} At Risk
                </span>
              </div>

              <div class="compatibility-list">
                {props.compatibilityPlan.properties.map((p) => (
                  <div class="compatibility-row" key={p.name}>
                    <span>{p.normalizedName}</span>
                    <span style={{ color: p.status === 'preserved' ? '#14ae5c' : '#ffaa00', fontWeight: 500 }}>
                      {p.status} {p.targetName ? `➔ ${p.targetName}` : ''}
                    </span>
                  </div>
                ))}
              </div>

              <Button
                disabled={isReplacing || !isCompatibilityPlanCurrent}
                onClick={handleExecuteReplacement}
              >
                {isReplacing ? 'Migrating…' : `Replace ${props.compatibilityPlan.instancesCount || 'All'} Instances`}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* TAB 3: LIBRARY HEALTH */}
      {subTab === 'library' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div class="health-metrics-grid" style={{ borderLeft: 0, paddingLeft: 0, gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div class="health-metric-item">
              <div class="health-metric-val">{scanResult.libraryHealth.totalInstances}</div>
              <div class="health-metric-lbl">Total Instances</div>
            </div>
            <div class="health-metric-item">
              <div class="health-metric-val">{scanResult.libraryHealth.uniqueComponentsCount}</div>
              <div class="health-metric-lbl">Unique Components</div>
            </div>
            <div class="health-metric-item">
              <div class="health-metric-val">{scanResult.libraryHealth.remoteInstancesCount}</div>
              <div class="health-metric-lbl">Library (Remote)</div>
            </div>
            <div class="health-metric-item">
              <div class="health-metric-val">{scanResult.libraryHealth.localInstancesCount}</div>
              <div class="health-metric-lbl">Local</div>
            </div>
          </div>

          {scanResult.libraryHealth.deprecatedInstances.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ffaa00', fontWeight: 600, fontSize: '12px' }}>
                <IconWarningSmall24 />
                <span>Deprecated Components ({scanResult.libraryHealth.deprecatedInstances.length})</span>
              </div>

              {scanResult.libraryHealth.deprecatedInstances.map((dep) => (
                <div
                  key={dep.nodeId}
                  style={{
                    background: 'rgba(255, 170, 0, 0.06)',
                    border: '1px solid rgba(255, 170, 0, 0.25)',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <button
                      class="health-issue-node-btn"
                      onClick={() => props.onFocusNode(dep.nodeId)}
                      title="Focus on canvas"
                      type="button"
                    >
                      {dep.instanceName}
                    </button>
                    <div style={{ color: 'var(--figma-color-text-secondary)', fontSize: '10px' }}>
                      Component: <strong>{dep.componentName}</strong>
                    </div>
                    <div style={{ color: '#ffaa00', fontSize: '10px', marginTop: '2px' }}>
                      {dep.deprecationNotice}
                    </div>
                  </div>

                  <Button
                    onClick={() => props.onFocusNode(dep.nodeId)}
                    secondary
                  >
                    Focus
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div class="health-clean-state">
              <h3>✓ No Deprecated Components</h3>
              <p>No deprecation markers were found. Native library update availability is not exposed by Figma's public plugin API.</p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
