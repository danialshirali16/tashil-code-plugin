import {
  Banner,
  Button,
  Checkbox,
  IconApprovedCheckmark24,
  IconComponent16,
  IconFrame16,
  IconLibrary16,
  IconRefresh16,
  IconSearchSmall24,
  IconVariable16,
  IconVisible16,
  IconWarningSmall24,
  LoadingIndicator,
  RadioButtons,
  SegmentedControl,
  Textbox,
} from '@create-figma-plugin/ui';
import { Fragment, h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type {
  DocDriftReport,
  DocFrameMetadata,
  DocSourcePreview,
  DocStyleKind,
  DocStyleSourceSummary,
  TokenGroupingDepth,
} from '../documentation/types';
import type {
  ComponentInventoryState,
} from '../types';
import type {
  TokenCollectionSummary,
} from '../sync-tokens/types';

export function getEstimatedDocFrameWidth(modeCount: number): number {
  if (modeCount <= 1) return 1100;
  if (modeCount === 2) return 1500;
  if (modeCount === 3) return 1900;
  if (modeCount === 4) return 2300;
  return 3000;
}

export function DocumentationView(props: {
  docGenerationMessage: string;
  docGenerationStatus: 'error' | 'idle' | 'running' | 'success';
  docProgress: { message: string; percent: number } | null;
  docSourcePreview: DocSourcePreview | null;
  docSourcePreviewError: string;
  docSourcePreviewStatus: 'error' | 'idle' | 'loading';
  inventoryState: ComponentInventoryState;
  styleSources: readonly DocStyleSourceSummary[];
  styleSourcesStatus: 'error' | 'idle' | 'loading';
  onCancelDocGeneration: () => void;
  onGenerateComponentDocs: (targetToken: string, targetFormat?: 'canvas' | 'markdown') => void;
  onGenerateTokenDocs: (
    collectionId: string,
    targetFormat?: 'canvas' | 'markdown',
    tokenGroupingDepth?: TokenGroupingDepth,
  ) => void;
  onGenerateStyleDocs: (
    styleKind: DocStyleKind,
    tokenGroupingDepth?: TokenGroupingDepth,
  ) => void;
  onRefreshComponents: () => void;
  onLoadSourcePreview: (
    scope: 'components' | 'styles' | 'tokens',
    targetId: string,
    tokenGroupingDepth?: TokenGroupingDepth,
  ) => void;
  onLoadTokenCollections: () => void;
  onLoadStyleSources: () => void;
  onUpdateDocsInPlace: (
    frameNodeId: string,
    tokenGroupingDepth?: TokenGroupingDepth,
  ) => void;
  selectedDocFrame: {
    frameNodeId?: string;
    metadata?: DocFrameMetadata;
    drift?: DocDriftReport;
  } | null;
  tokenCollections: readonly TokenCollectionSummary[];
  tokenCollectionsStatus: 'error' | 'idle' | 'loading';
}): h.JSX.Element {
  const {
    docGenerationMessage,
    docGenerationStatus,
    docProgress,
    docSourcePreview,
    docSourcePreviewError,
    docSourcePreviewStatus,
    inventoryState,
    styleSources,
    styleSourcesStatus,
    onCancelDocGeneration,
    onGenerateComponentDocs,
    onGenerateTokenDocs,
    onGenerateStyleDocs,
    onLoadSourcePreview,
    onLoadTokenCollections,
    onLoadStyleSources,
    onRefreshComponents,
    onUpdateDocsInPlace,
    selectedDocFrame,
    tokenCollections,
    tokenCollectionsStatus,
  } = props;

  const [scope, setScope] = useState<'tokens' | 'components' | 'styles'>('tokens');
  const [tokenSearchQuery, setTokenSearchQuery] = useState('');
  const [componentSearchQuery, setComponentSearchQuery] = useState('');
  const [styleSearchQuery, setStyleSearchQuery] = useState('');
  const [showHiddenComponents, setShowHiddenComponents] = useState(false);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [selectedTargetToken, setSelectedTargetToken] = useState<string | null>(null);
  const [selectedStyleKind, setSelectedStyleKind] = useState<DocStyleKind | null>(null);
  const [tokenGroupingDepth, setTokenGroupingDepth] = useState<TokenGroupingDepth>('3');

  useEffect(() => {
    if (tokenCollections.length === 0 && tokenCollectionsStatus === 'idle') {
      onLoadTokenCollections();
    }
  }, []);

  useEffect(() => {
    if (scope === 'styles' && styleSources.length === 0 && styleSourcesStatus === 'idle') {
      onLoadStyleSources();
    }
  }, [scope, styleSources.length, styleSourcesStatus]);

  useEffect(() => {
    if (tokenCollections.length > 0) {
      if (!selectedCollectionId || !tokenCollections.some((c) => c.id === selectedCollectionId)) {
        setSelectedCollectionId(tokenCollections[0].id);
      }
    } else {
      setSelectedCollectionId(null);
    }
  }, [tokenCollections, selectedCollectionId]);

  useEffect(() => {
    const selectableComponents = inventoryState.status === 'ready'
      ? inventoryState.items.filter((item) => showHiddenComponents || !item.componentName.startsWith('.'))
      : [];
    if (selectableComponents.length > 0) {
      if (!selectedTargetToken || !selectableComponents.some((i) => i.targetToken === selectedTargetToken)) {
        const connected = selectableComponents.find((i) => i.status === 'connected');
        setSelectedTargetToken(connected ? connected.targetToken : selectableComponents[0].targetToken);
      }
    } else {
      setSelectedTargetToken(null);
    }
  }, [inventoryState, selectedTargetToken, showHiddenComponents]);

  useEffect(() => {
    if (styleSources.length > 0) {
      if (!selectedStyleKind || !styleSources.some((source) => source.id === selectedStyleKind)) {
        setSelectedStyleKind(styleSources[0].id);
      }
    } else {
      setSelectedStyleKind(null);
    }
  }, [styleSources, selectedStyleKind]);

  useEffect(() => {
    if (selectedDocFrame?.metadata?.docType === 'tokens' || selectedDocFrame?.metadata?.docType === 'styles') {
      setTokenGroupingDepth(selectedDocFrame.metadata.tokenGroupingDepth ?? 'all');
    }
  }, [selectedDocFrame?.frameNodeId]);

  useEffect(() => {
    const targetId = scope === 'tokens'
      ? selectedCollectionId
      : scope === 'components'
        ? selectedTargetToken
        : selectedStyleKind;
    if (targetId) {
      onLoadSourcePreview(
        scope,
        targetId,
        scope === 'tokens' || scope === 'styles' ? tokenGroupingDepth : undefined,
      );
    }
  }, [scope, selectedCollectionId, selectedTargetToken, selectedStyleKind, tokenGroupingDepth]);

  const filteredCollections = tokenCollections.filter((c) => {
    const q = tokenSearchQuery.trim().toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q);
  });

  const filteredComponents = inventoryState.status === 'ready'
    ? inventoryState.items
      .filter((item) => showHiddenComponents || !item.componentName.startsWith('.'))
      .filter((item) => {
          const q = componentSearchQuery.trim().toLowerCase();
          if (!q) return true;
          return item.componentName.toLowerCase().includes(q);
        })
      .sort((a, b) => a.componentName.localeCompare(
        b.componentName,
        undefined,
        { numeric: true, sensitivity: 'base' },
      ))
    : [];

  const filteredStyleSources = styleSources.filter((source) => {
    const query = styleSearchQuery.trim().toLowerCase();
    return !query || source.name.toLowerCase().includes(query);
  });

  const isRunning = docGenerationStatus === 'running';
  const hasSelectedSource = scope === 'tokens'
    ? Boolean(selectedCollectionId)
    : scope === 'components'
      ? Boolean(selectedTargetToken)
      : Boolean(selectedStyleKind);
  const selectedDocChangeCount = selectedDocFrame?.drift?.changes?.length ?? 0;

  return (
    <main aria-labelledby="docs-heading" class="docs-library-view">
      <div class="docs-library-scroll">
        <header class="docs-library-header">
          <div>
            <h1 id="docs-heading">Documentation library</h1>
            <p>Publish and maintain design-system specifications.</p>
          </div>
          <Button
            onClick={scope === 'tokens'
              ? onLoadTokenCollections
              : scope === 'components'
                ? onRefreshComponents
                : onLoadStyleSources}
            secondary
          >
            <span class="button-content"><IconRefresh16 />Refresh</span>
          </Button>
        </header>

        <div class="docs-library-scope">
          <SegmentedControl
            onValueChange={(value) => setScope(value as 'tokens' | 'components' | 'styles')}
            options={[
              {
                children: (
                  <span class="docs-library-scope-option">
                    <IconVariable16 />
                    <span>Design Tokens</span>
                  </span>
                ),
                value: 'tokens',
              },
              {
                children: (
                  <span class="docs-library-scope-option">
                    <IconLibrary16 />
                    <span>Styles</span>
                  </span>
                ),
                value: 'styles',
              },
              {
                children: (
                  <span class="docs-library-scope-option">
                    <IconComponent16 />
                    <span>Components</span>
                  </span>
                ),
                value: 'components',
              },
            ]}
            value={scope}
          />
        </div>
        <div class="docs-library-toolbar">
          {scope === 'tokens' ? (
            <Textbox
              aria-label="Search token collections"
              icon={<IconSearchSmall24 />}
              onValueInput={setTokenSearchQuery}
              placeholder={tokenCollectionsStatus === 'loading' ? 'Loading collections…' : 'Search token collections…'}
              value={tokenSearchQuery}
            />
          ) : scope === 'components' ? (
            <Fragment>
              <Textbox
                aria-label="Search components"
                icon={<IconSearchSmall24 />}
                onValueInput={setComponentSearchQuery}
                placeholder={inventoryState.status === 'scanning' ? 'Scanning components…' : 'Search components…'}
                value={componentSearchQuery}
              />
              <div class="docs-library-hidden-filter">
                <Checkbox
                  onValueChange={setShowHiddenComponents}
                  value={showHiddenComponents}
                >
                  Show hidden components
                </Checkbox>
              </div>
            </Fragment>
          ) : (
            <Textbox
              aria-label="Search styles"
              icon={<IconSearchSmall24 />}
              onValueInput={setStyleSearchQuery}
              placeholder={styleSourcesStatus === 'loading' ? 'Loading styles…' : 'Search styles…'}
              value={styleSearchQuery}
            />
          )}
        </div>

        {selectedDocFrame?.metadata && selectedDocFrame.frameNodeId ? (
          <section class="docs-library-reconcile" aria-label="Selected documentation status">
            <Banner
              icon={selectedDocFrame.drift?.hasDrift ? <IconWarningSmall24 /> : <IconApprovedCheckmark24 />}
              variant={selectedDocFrame.drift?.hasDrift ? 'warning' : 'success'}
            >
              {selectedDocFrame.drift?.hasDrift
                ? `Selected document “${selectedDocFrame.metadata.targetName}” has ${selectedDocChangeCount || 1} source change${selectedDocChangeCount === 1 ? '' : 's'}.`
                : `Selected document “${selectedDocFrame.metadata.targetName}” is up to date.`}
            </Banner>

            {selectedDocFrame.drift?.hasDrift && selectedDocFrame.drift.changes?.length ? (
              <ul class="docs-library-change-list">
                {selectedDocFrame.drift.changes.slice(0, 4).map((change, index) => (
                  <li key={index}>{change.message}{change.details ? ` (${change.details})` : ''}</li>
                ))}
                {selectedDocFrame.drift.changes.length > 4 ? (
                  <li>…and {selectedDocFrame.drift.changes.length - 4} more</li>
                ) : null}
              </ul>
            ) : null}

            <div class="docs-library-reconcile-footer">
              <span class="docs-library-selected-meta">
                Generated {selectedDocFrame.metadata.generatedAt
                  ? new Date(selectedDocFrame.metadata.generatedAt).toLocaleDateString()
                  : 'on an unknown date'} · {selectedDocFrame.metadata.docType}
              </span>
              <div class="docs-library-row-actions">
                {selectedDocFrame.metadata.docType === 'tokens' ? (
                  <Button
                    disabled={isRunning}
                    onClick={() => onGenerateTokenDocs(
                      selectedDocFrame.metadata!.targetId,
                      'markdown',
                      tokenGroupingDepth,
                    )}
                    secondary
                  >
                    Export Markdown
                  </Button>
                ) : null}
                <Button
                  disabled={isRunning}
                  onClick={() => onUpdateDocsInPlace(
                    selectedDocFrame.frameNodeId!,
                    selectedDocFrame.metadata?.docType === 'tokens' || selectedDocFrame.metadata?.docType === 'styles'
                      ? tokenGroupingDepth
                      : undefined,
                  )}
                  secondary={!selectedDocFrame.drift?.hasDrift}
                >
                  Update in place
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        <section aria-label="Documentation sources" class="docs-library-list" role="radiogroup">
          {scope === 'tokens' ? (
            filteredCollections.length > 0 ? (
              <div class="docs-library-source-options">
                <RadioButtons
                  onValueChange={setSelectedCollectionId}
                  options={filteredCollections.map((collection) => ({
                    children: (
                      <span class="docs-library-source-copy">
                        <strong>{collection.name}</strong>
                        <span>{collection.tokenCount} tokens · {collection.modes.length} modes</span>
                      </span>
                    ),
                    value: collection.id,
                  }))}
                  value={selectedCollectionId}
                />
              </div>
            ) : (
              <div class="docs-library-empty">{tokenCollectionsStatus === 'loading' ? 'Loading token collections…' : 'No token collections found.'}</div>
            )
          ) : scope === 'components' ? (filteredComponents.length > 0 ? (
            <div class="docs-library-source-options">
              <RadioButtons
                onValueChange={setSelectedTargetToken}
                options={filteredComponents.map((item) => {
                  const instanceCount = item.instanceCount;
                  return {
                    children: (
                      <span class="docs-library-source-copy">
                        <strong>{item.componentName}</strong>
                        <span>
                          {instanceCount === undefined
                            ? item.pageName
                            : `${instanceCount} instance${instanceCount === 1 ? '' : 's'} · ${item.pageName}`}
                        </span>
                      </span>
                    ),
                    value: item.targetToken,
                  };
                })}
                value={selectedTargetToken}
              />
            </div>
          ) : (
            <div class="docs-library-empty">{inventoryState.status === 'scanning' ? 'Scanning components…' : 'No matching components in inventory.'}</div>
          )) : filteredStyleSources.length > 0 ? (
            <div class="docs-library-source-options">
              <RadioButtons
                onValueChange={(value) => setSelectedStyleKind(value as DocStyleKind)}
                options={filteredStyleSources.map((source) => ({
                  children: (
                    <span class="docs-library-source-copy">
                      <strong>{source.name}</strong>
                      <span>{source.styleCount} local style{source.styleCount === 1 ? '' : 's'}</span>
                    </span>
                  ),
                  value: source.id,
                }))}
                value={selectedStyleKind}
              />
            </div>
          ) : (
            <div class="docs-library-empty">{styleSourcesStatus === 'loading' ? 'Loading local styles…' : 'No matching local styles.'}</div>
          )}
        </section>

        {scope === 'tokens' || scope === 'styles' ? (
          <section aria-labelledby="docs-grouping-depth-heading" class="docs-library-grouping-depth">
            <div class="docs-library-grouping-depth-heading">
              <div>
                <h2 id="docs-grouping-depth-heading">Grouping depth</h2>
                <p>
                  {scope === 'styles'
                    ? 'How many style path levels should create documentation groups?'
                    : 'How many token path levels should create documentation groups?'}
                </p>
              </div>
              <span>Recommended: 3</span>
            </div>
            <SegmentedControl
              onValueChange={(value) => setTokenGroupingDepth(value as TokenGroupingDepth)}
              options={[
                { children: '1', value: '1' },
                { children: '2', value: '2' },
                { children: '3', value: '3' },
                { children: '4+', value: '4' },
                { children: 'Full', value: 'all' },
              ]}
              value={tokenGroupingDepth}
            />
          </section>
        ) : null}

        {docSourcePreviewStatus !== 'idle' || docSourcePreview ? (
          <section
            aria-label="Documentation preview"
            aria-live="polite"
            class="docs-library-preview"
            role="region"
          >
            {docSourcePreviewStatus === 'loading' ? (
              <div class="docs-library-preview-loading">
                <LoadingIndicator />
                <span>Calculating a lightweight preview…</span>
              </div>
            ) : docSourcePreviewStatus === 'error' ? (
              <p class="docs-library-preview-error">{docSourcePreviewError}</p>
            ) : docSourcePreview?.scope === 'tokens' ? (
              <div class="docs-library-preview-card">
                <div class="docs-library-preview-header">
                  <h3>
                    {docSourcePreview.sourceName
                      ? `${docSourcePreview.sourceName} will generate ${docSourcePreview.groupCount} section${docSourcePreview.groupCount === 1 ? '' : 's'}`
                      : `${docSourcePreview.groupCount} group${docSourcePreview.groupCount === 1 ? '' : 's'} will be generated`}
                  </h3>
                  <span class="docs-library-preview-badge">{docSourcePreview.tokenCount} tokens</span>
                </div>
                <div class="docs-library-preview-rows">
                  <div class="docs-library-preview-row">
                    <span class="docs-library-preview-icon docs-icon-tokens"><IconVariable16 /></span>
                    <span>
                      <strong>{docSourcePreview.tokenCount} Tokens</strong> across <strong>{docSourcePreview.modeCount} Mode{docSourcePreview.modeCount === 1 ? '' : 's'}</strong> · Depth: <strong>{docSourcePreview.groupingDepth === 'all' ? 'Full path' : `${docSourcePreview.groupingDepth} level${docSourcePreview.groupingDepth === '1' ? '' : 's'}`}</strong>
                    </span>
                  </div>
                  <div class="docs-library-preview-row">
                    <span class="docs-library-preview-icon docs-icon-layout"><IconFrame16 /></span>
                    <span>
                      Frame Width: <strong>{getEstimatedDocFrameWidth(docSourcePreview.modeCount)}px</strong> (Auto Fill Container) · Preserves custom edits
                    </span>
                  </div>
                  <div class="docs-library-preview-row">
                    <span class="docs-library-preview-icon docs-icon-sections"><IconVisible16 /></span>
                    <span>
                      Sections: {docSourcePreview.groupNames.map((name, i) => (
                        <Fragment key={i}>
                          {i > 0 ? ', ' : ''}
                          <strong>{name}</strong>
                        </Fragment>
                      ))}
                      {docSourcePreview.groupCount > docSourcePreview.groupNames.length ? (
                        <Fragment>
                          {docSourcePreview.groupNames.length > 0 ? ', and ' : ''}
                          <span class="docs-library-preview-more">+{docSourcePreview.groupCount - docSourcePreview.groupNames.length} more</span>
                        </Fragment>
                      ) : null}
                    </span>
                  </div>
                </div>
              </div>
            ) : docSourcePreview?.scope === 'styles' ? (
              <div class="docs-library-preview-card">
                <div class="docs-library-preview-header">
                  <h3>
                    {docSourcePreview.sourceName
                      ? `${docSourcePreview.sourceName} will document ${docSourcePreview.styleCount} style${docSourcePreview.styleCount === 1 ? '' : 's'}`
                      : `${docSourcePreview.styleCount} style${docSourcePreview.styleCount === 1 ? '' : 's'} will be documented`}
                  </h3>
                  <span class="docs-library-preview-badge">{docSourcePreview.styleCount} styles</span>
                </div>
                <div class="docs-library-preview-rows">
                  <div class="docs-library-preview-row">
                    <span class="docs-library-preview-icon docs-icon-styles"><IconLibrary16 /></span>
                    <span>
                      <strong>{docSourcePreview.styleCount} {docSourcePreview.styleKind === 'typography' ? 'Text' : 'Effect'} Styles</strong> in <strong>{docSourcePreview.groupCount} Section{docSourcePreview.groupCount === 1 ? '' : 's'}</strong> · Depth: <strong>{docSourcePreview.groupingDepth === 'all' ? 'Full path' : `${docSourcePreview.groupingDepth} level${docSourcePreview.groupingDepth === '1' ? '' : 's'}`}</strong>
                    </span>
                  </div>
                  <div class="docs-library-preview-row">
                    <span class="docs-library-preview-icon docs-icon-layout"><IconFrame16 /></span>
                    <span>
                      Frame Width: <strong>1100px</strong> · Standard CSS format · Preserves custom edits
                    </span>
                  </div>
                  <div class="docs-library-preview-row">
                    <span class="docs-library-preview-icon docs-icon-sections"><IconVisible16 /></span>
                    <span>
                      Sections: {docSourcePreview.groupNames.map((name, i) => (
                        <Fragment key={i}>
                          {i > 0 ? ', ' : ''}
                          <strong>{name}</strong>
                        </Fragment>
                      ))}
                      {docSourcePreview.groupCount > docSourcePreview.groupNames.length ? (
                        <Fragment>
                          {docSourcePreview.groupNames.length > 0 ? ', and ' : ''}
                          <span class="docs-library-preview-more">+{docSourcePreview.groupCount - docSourcePreview.groupNames.length} more</span>
                        </Fragment>
                      ) : null}
                    </span>
                  </div>
                </div>
              </div>
            ) : docSourcePreview?.scope === 'components' ? (
              <div class="docs-library-preview-card">
                <div class="docs-library-preview-header">
                  <h3>{docSourcePreview.sourceName} will generate {docSourcePreview.combinationCount.toLocaleString()} variant combination{docSourcePreview.combinationCount === 1 ? '' : 's'}</h3>
                  <span class="docs-library-preview-badge">{docSourcePreview.combinationCount} variants</span>
                </div>
                <div class="docs-library-preview-rows">
                  <div class="docs-library-preview-row">
                    <span class="docs-library-preview-icon docs-icon-components"><IconComponent16 /></span>
                    <span>
                      <strong>{docSourcePreview.propertyCount} Variant Propert{docSourcePreview.propertyCount === 1 ? 'y' : 'ies'}</strong> · <strong>{docSourcePreview.combinationCount.toLocaleString()} Combinations</strong>
                    </span>
                  </div>
                  <div class="docs-library-preview-row">
                    <span class="docs-library-preview-icon docs-icon-layout"><IconFrame16 /></span>
                    <span>
                      Matrix Alignment: <strong>Top-Right Tiers</strong> · Transparent None cells
                    </span>
                  </div>
                  <div class="docs-library-preview-row">
                    <span class="docs-library-preview-icon docs-icon-sections"><IconVisible16 /></span>
                    <span>
                      Target Component: <strong>{docSourcePreview.sourceName}</strong> · Auto Layout Matrix
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {!isRunning && docGenerationMessage && docGenerationStatus === 'error' ? (
          <div aria-live="polite" class="docs-library-result">
            <Banner
              icon={<IconWarningSmall24 />}
              variant="warning"
            >
              {docGenerationMessage}
            </Banner>
          </div>
        ) : null}
      </div>

      <footer class="sync-tokens-footer">
        {isRunning || docProgress ? (
          <div aria-live="polite" class="docs-library-footer-progress">
            <LoadingIndicator />
            <div class="docs-library-progress-copy">
              <strong>{docProgress?.message || docGenerationMessage || 'Processing…'}</strong>
              <progress aria-label="Documentation generation progress" max={100} value={docProgress?.percent ?? 0} />
            </div>
            <span class="docs-library-progress-percent">{docProgress?.percent ?? 0}%</span>
          </div>
        ) : (
          <div class="spacer" />
        )}
        <div class="primary-actions">
          {isRunning || docProgress ? (
            <Button onClick={onCancelDocGeneration} secondary>Cancel</Button>
          ) : (
            <Button
              disabled={!hasSelectedSource}
              onClick={() => {
                if (scope === 'tokens' && selectedCollectionId) {
                  onGenerateTokenDocs(selectedCollectionId, 'canvas', tokenGroupingDepth);
                } else if (scope === 'components' && selectedTargetToken) {
                  onGenerateComponentDocs(selectedTargetToken, 'canvas');
                } else if (scope === 'styles' && selectedStyleKind) {
                  onGenerateStyleDocs(selectedStyleKind, tokenGroupingDepth);
                }
              }}
            >
              Generate Document
            </Button>
          )}
        </div>
      </footer>
    </main>
  );
}
