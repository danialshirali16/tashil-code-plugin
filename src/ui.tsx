import {
  Banner,
  Button,
  Checkbox,
  Container,
  Dropdown,
  IconApprovedCheckmark24,
  IconBackwardSmall24,
  IconCheck24,
  IconButton,
  IconCodeSnippet24,
  IconCopySmall24,
  IconFolder24,
  IconHelp16,
  IconNewTab24,
  IconRefresh16,
  IconSearchSmall24,
  IconTimeSmall24,
  IconWarningSmall24,
  LoadingIndicator,
  RadioButtons,
  render,
  SearchTextbox,
  SegmentedControl,
  Stack,
  Text,
  Textbox,
  TextboxNumeric,
  Toggle,
  useWindowResize,
  VerticalSpace,
} from '@create-figma-plugin/ui';
import { emit } from '@create-figma-plugin/utilities';
import { Fragment, h } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import '!./ui.css';
import type { ConnectionHealth } from './connection-health';
import { normalizeHttpUrl } from './external-url';
import { MappingEditorView } from './mapping-editor-view';
import { isMappingDocument } from './mapping-document';
import { SemanticMappingView } from './semantic-editor-view';
import { SEMANTIC_CONNECT_AUTHORING_ENABLED } from './semantic/flags';
import type {
  ReconciliationAction,
  ReconciliationProposal,
} from './semantic/reconcile';
import type { SemanticConnectionRecipe } from './semantic/types';
import { copyToClipboard } from './ui-clipboard';
import { downloadBlob } from './ui-download';
import { selectCopyContent, type OutputPreferences } from './output-preferences';
import {
  IconDetach48,
  IconInteractionClickSmall48,
  REFERENCE_ICONS,
} from './ui-assets';
import { useConnectionController } from './ui-controller';
import {
  FORM_FIELD_IDS,
  formatConnectionUpdatedAt,
  getConnectionStatusSummary,
  getCopyFeedback,
  type CopyStatus,
  type FormErrors,
  type FormField,
  type PendingMutation,
} from './ui-state';
import {
  type ComponentInventoryState,
  type ConnectionImportPlanEntry,
  type ConnectionIssue,
  type ConnectionReferences,
  type InspectCodeState,
  type OpenExternalHandler,
  type ResizeWindowHandler,
  type UiTargetState,
} from './types';
import type {
  ColorFormat,
  ExportFile,
  ExportOptions,
  NameStyle,
  OutputFormat,
  TokenCollectionSummary,
} from './sync-tokens/types';
import type {
  DocDriftReport,
  DocFrameMetadata,
  DocSourcePreview,
} from './documentation/types';
import { formatCssBlock } from './inspect/css-partition';
import { formatUsageSnippet } from './inspect/usage-snippet';
import type { FrameInspection } from './inspect/types';
import type { ReactLayoutResult } from './layout/types';
import type { VariantLogicResult } from './layout/variant-logic';

/** Insert a text-style comment into the Style CSS block after the last `color:` declaration. */
function insertTextStyleComment(css: string, textStyleName?: string): string {
  if (!textStyleName || css.length === 0) {
    return css;
  }
  const comment = `/* Text style: "${textStyleName}" */`;
  const lines = css.split('\n');
  let lastColorIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('color:')) {
      lastColorIndex = i;
    }
  }
  if (lastColorIndex === -1) {
    return `${comment}\n${css}`;
  }
  lines.splice(lastColorIndex + 1, 0, comment);
  return lines.join('\n');
}

export function Plugin(): h.JSX.Element {
  const [view, setView] = useState<'connect' | 'help'>('connect');
  const [workflowTab, setWorkflowTab] = useState<'connect' | 'generate' | 'sync-tokens' | 'docs' | 'settings'>('connect');
  const [inventoryFilter, setInventoryFilter] = useState<
    'all' | 'not-connected' | 'connected'
  >('all');
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [hideDotPrefixedComponents, setHideDotPrefixedComponents] = useState(true);
  const inventoryScrollRef = useRef<HTMLDivElement>(null);
  const inventoryScrollPositionRef = useRef(0);
  const returnTargetTokenRef = useRef<string>();
  const {
    activePendingOperation,
    cancelClear: handleCancelClear,
    clear: handleClear,
    clearCancelButtonRef,
    closeTarget,
    errorMessage,
    fieldErrors,
    formValues,
    inspectCodeState,
    inventoryState,
    connectionImportEntries,
    connectionPortabilityMessage,
    exportConnections,
    previewConnectionImport,
    applyConnectionImport,
    generateStories,
    generateCodeConnect,
    storybookGeneration,
    outputPreferences,
    outputPreferencesMessage,
    setOutputPreferences,
    isClearConfirmationOpen,
    isDirty,
    isReady,
    isSourceUploading,
    connectionHealth,
    openInventoryTarget,
    reconcileFigma,
    removeStaleMapping,
    rescanComponents,
    save: handleSave,
    scaffold: handleScaffold,
    targetOrigin,
    targetState,
    targetStatusAnnouncement,
    semanticRecipe,
    semanticProposals,
    applySemanticProposal,
    exportDebugBundle,
    exportReport,
    isSourceReplacementPending,
    sourceReplacementCancelRef,
    confirmSourceReplacement,
    cancelSourceReplacement,
    setCustomPropMappings,
    setFormField,
    setMappedProperty,
    setMappedValue,
    setSemanticOption,
    setSemanticRepeatedInstances,
    setSemanticValueMapping,
    statusMessage,
    uploadSourceFiles,
    tokenCollections,
    tokenCollectionsStatus,
    tokenCollectionsError,
    tokensExportStatus,
    tokensExportError,
    tokensExportSuccess,
    tokensPreviewStatus,
    tokensPreviewError,
    tokensPreviewFiles,
    loadTokenCollections,
    exportTokens,
    previewTokens,
    selectedDocFrame,
    docGenerationStatus,
    docGenerationMessage,
    docProgress,
    docSourcePreview,
    docSourcePreviewError,
    docSourcePreviewStatus,
    cancelDocGeneration,
    loadDocSourcePreview,
    generateTokenDocs,
    updateDocsInPlace,
    generateComponentDocs,
  } = useConnectionController();

  function handleOpenInventoryTarget(targetToken: string): void {
    inventoryScrollPositionRef.current = inventoryScrollRef.current?.scrollTop ?? 0;
    returnTargetTokenRef.current = targetToken;
    openInventoryTarget(targetToken);
  }

  function handleBackToInventory(): void {
    const targetToken = returnTargetTokenRef.current;
    closeTarget();
    window.setTimeout(() => {
      if (inventoryScrollRef.current) {
        inventoryScrollRef.current.scrollTop = inventoryScrollPositionRef.current;
      }
      if (targetToken) {
        document.getElementById(`tashil-component-${targetToken}`)?.focus();
      }
    }, 0);
  }

  useEffect(() => {
    document.documentElement.lang = 'en';
  }, []);

  useEffect(() => {
    if (view === 'help') {
      document.getElementById('tashil-help-heading')?.focus();
    }
  }, [view]);

  const resizeWindow = useCallback((size: { width: number; height: number }) => {
    emit<ResizeWindowHandler>('RESIZE_WINDOW', size);
  }, []);

  useWindowResize(resizeWindow, {
    minHeight: 480,
    minWidth: 360,
    resizeDirection: 'both',
  });

  // WAI-ARIA tabs pattern: Arrow keys move between tabs, Home/End jump to the ends.
  function handleTabKeyDown(event: h.JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
    const tabs: Array<'connect' | 'generate' | 'sync-tokens' | 'docs' | 'settings'> = [
      'connect',
      'generate',
      'sync-tokens',
      'docs',
      'settings',
    ];
    const tabIds: Record<typeof workflowTab, string> = {
      connect: 'tashil-tab-connect',
      generate: 'tashil-tab-generate',
      'sync-tokens': 'tashil-tab-sync-tokens',
      docs: 'tashil-tab-docs',
      settings: 'tashil-tab-settings',
    };
    const currentIndex = tabs.indexOf(workflowTab);

    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    setWorkflowTab(nextTab);
    document.getElementById(tabIds[nextTab])?.focus();
  }

  function openHelp(): void {
    setView('help');
  }

  function closeHelp(): void {
    setView('connect');
    window.setTimeout(() => {
      document.getElementById('tashil-help-button')?.focus();
    }, 0);
  }

  const hasFooter = view === 'connect'
    && workflowTab === 'connect'
    && isReady
    && targetOrigin !== undefined;

  return (
    <div class={hasFooter ? 'root' : 'root root-no-footer'}>
      <header class="header">
        <Container space="medium">
          <div class="top-bar">
            {view === 'help' ? (
              <Button
                aria-label="Back to connect component"
                onClick={closeHelp}
                secondary
                title="Back"
              >
                <span class="button-content">
                  <IconBackwardSmall24 />
                  Back
                </span>
              </Button>
            ) : (
              <div class="reference-tabs" onKeyDown={handleTabKeyDown} role="tablist" aria-label="Tashil Code workflow">
                <button
                  aria-controls="tashil-tabpanel-connect"
                  aria-selected={workflowTab === 'connect'}
                  class={workflowTab === 'connect' ? 'reference-tab reference-tab-active' : 'reference-tab'}
                  id="tashil-tab-connect"
                  onClick={() => setWorkflowTab('connect')}
                  role="tab"
                  tabIndex={workflowTab === 'connect' ? 0 : -1}
                  type="button"
                >
                  Components
                </button>
                <button
                  aria-controls="tashil-tabpanel-generate"
                  aria-selected={workflowTab === 'generate'}
                  class={workflowTab === 'generate' ? 'reference-tab reference-tab-active' : 'reference-tab'}
                  id="tashil-tab-generate"
                  onClick={() => setWorkflowTab('generate')}
                  role="tab"
                  tabIndex={workflowTab === 'generate' ? 0 : -1}
                  type="button"
                >
                  Inspect Code
                </button>
                <button
                  aria-controls="tashil-tabpanel-sync-tokens"
                  aria-selected={workflowTab === 'sync-tokens'}
                  class={workflowTab === 'sync-tokens' ? 'reference-tab reference-tab-active' : 'reference-tab'}
                  id="tashil-tab-sync-tokens"
                  onClick={() => setWorkflowTab('sync-tokens')}
                  role="tab"
                  tabIndex={workflowTab === 'sync-tokens' ? 0 : -1}
                  type="button"
                >
                  Sync Tokens
                </button>
                <button
                  aria-controls="tashil-tabpanel-docs"
                  aria-selected={workflowTab === 'docs'}
                  class={workflowTab === 'docs' ? 'reference-tab reference-tab-active' : 'reference-tab'}
                  id="tashil-tab-docs"
                  onClick={() => setWorkflowTab('docs')}
                  role="tab"
                  tabIndex={workflowTab === 'docs' ? 0 : -1}
                  type="button"
                >
                  Docs
                </button>
                <button
                  aria-controls="tashil-tabpanel-settings"
                  aria-selected={workflowTab === 'settings'}
                  class={workflowTab === 'settings' ? 'reference-tab reference-tab-active' : 'reference-tab'}
                  id="tashil-tab-settings"
                  onClick={() => setWorkflowTab('settings')}
                  role="tab"
                  tabIndex={workflowTab === 'settings' ? 0 : -1}
                  type="button"
                >
                  Settings
                </button>
              </div>
            )}
            {view !== 'help' ? (
              <IconButton
                aria-label="Open how it works"
                id="tashil-help-button"
                onClick={openHelp}
                title="How it works"
              >
                <IconHelp16 />
              </IconButton>
            ) : null}
          </div>
        </Container>
      </header>

      <div
        aria-atomic="true"
        aria-live="polite"
        class="visually-hidden"
        role="status"
      >
        {targetStatusAnnouncement}
      </div>

      {view === 'connect' && workflowTab === 'connect' ? (
        <div
          aria-labelledby="tashil-tab-connect"
          class="tabpanel"
          id="tashil-tabpanel-connect"
          role="tabpanel"
        >
          {targetOrigin ? (
            <Fragment>
              <div class="detail-navigation">
                <button
                  class="detail-back"
                  onClick={handleBackToInventory}
                  type="button"
                >
                  <IconBackwardSmall24 />
                  <span>Back to components</span>
                </button>
                {targetState.status === 'ready' ? (
                  <span class="detail-component-name">{targetState.componentName}</span>
                ) : null}
              </div>
              {targetState.status === 'ready' && targetState.existingConnection ? (
                <StorybookGenerator
                  copyMode={outputPreferences.copyMode}
                  generation={storybookGeneration}
                  onGenerateCodeConnect={() => generateCodeConnect(targetState.targetToken)}
                  onGenerate={(selectedVariantTokens) => generateStories(targetState.targetToken, selectedVariantTokens)}
                />
              ) : null}
              <ConnectComponentView
            componentName={formValues.componentName}
            figmaComponentName={formValues.figmaComponentName}
            connectionHealth={connectionHealth}
            customPropMappings={formValues.customPropMappings}
            clearCancelButtonRef={(element) => {
              clearCancelButtonRef.current = element;
            }}
            errorMessage={errorMessage}
            fieldErrors={fieldErrors}
            handleCancelClear={handleCancelClear}
            handleClear={handleClear}
            handleSave={handleSave}
            handleScaffold={handleScaffold}
            importPath={formValues.importPath}
            intentionalFigmaPropertyPrefixes={formValues.intentionalFigmaPropertyPrefixes}
            isClearConfirmationOpen={isClearConfirmationOpen}
            isDirty={isDirty}
            isReady={isReady}
            isSourceUploading={isSourceUploading}
            pendingOperation={activePendingOperation}
            mappingDocument={formValues.mappingDocument}
            previewDirection={outputPreferences.previewDirection}
            propMappings={formValues.propMappings}
            targetState={targetState}
            setCustomPropMappings={setCustomPropMappings}
            setComponentName={(value) => setFormField('componentName', value)}
            setImportPath={(value) => setFormField('importPath', value)}
            setIntentionalFigmaPropertyPrefixes={(value) => setFormField('intentionalFigmaPropertyPrefixes', value)}
            setMappedProperty={setMappedProperty}
            setMappedValue={setMappedValue}
            semanticRecipe={semanticRecipe}
            semanticProposals={semanticProposals}
            applySemanticProposal={applySemanticProposal}
            exportDebugBundle={exportDebugBundle}
            exportReport={exportReport}
            isSourceReplacementPending={isSourceReplacementPending}
            sourceReplacementCancelRef={(element) => {
              sourceReplacementCancelRef.current = element;
            }}
            confirmSourceReplacement={confirmSourceReplacement}
            cancelSourceReplacement={cancelSourceReplacement}
            setSemanticOption={setSemanticOption}
            setSemanticRepeatedInstances={setSemanticRepeatedInstances}
            setSemanticValueMapping={setSemanticValueMapping}
            reconcileFigma={reconcileFigma}
            removeStaleMapping={removeStaleMapping}
            setPropMappings={(value) => setFormField('propMappings', value)}
            setSourcePath={(value) => setFormField('sourcePath', value)}
            setSourceUrl={(value) => setFormField('sourceUrl', value)}
            setStorybookUrl={(value) => setFormField('storybookUrl', value)}
            sourcePath={formValues.sourcePath}
            sourceUrl={formValues.sourceUrl}
            statusMessage={statusMessage}
            storybookUrl={formValues.storybookUrl}
                uploadSourceFiles={uploadSourceFiles}
              />
            </Fragment>
          ) : (
            <ComponentInventoryView
              filter={inventoryFilter}
              hideDotPrefixed={hideDotPrefixedComponents}
              inventoryState={inventoryState}
              importEntries={connectionImportEntries}
              portabilityMessage={connectionPortabilityMessage}
              onApplyImport={applyConnectionImport}
              onExport={exportConnections}
              onFilterChange={setInventoryFilter}
              onHideDotPrefixedChange={setHideDotPrefixedComponents}
              onOpenTarget={handleOpenInventoryTarget}
              onPreviewImport={previewConnectionImport}
              onQueryChange={setInventoryQuery}
              onRescan={rescanComponents}
              query={inventoryQuery}
              scrollRef={inventoryScrollRef}
            />
          )}
        </div>
      ) : null}
      {view === 'connect' && workflowTab === 'generate' ? (
        <div
          aria-labelledby="tashil-tab-generate"
          class="tabpanel"
          id="tashil-tabpanel-generate"
          role="tabpanel"
        >
          <InspectCodeView
            copyMode={outputPreferences.copyMode}
            inspectCodeState={inspectCodeState}
            onGoToConnect={() => setWorkflowTab('connect')}
            previewDirection={outputPreferences.previewDirection}
          />
        </div>
      ) : null}
      {view === 'connect' && workflowTab === 'sync-tokens' ? (
        <div
          aria-labelledby="tashil-tab-sync-tokens"
          class="tabpanel"
          id="tashil-tabpanel-sync-tokens"
          role="tabpanel"
        >
          <SyncTokensView
            collections={tokenCollections}
            collectionsStatus={tokenCollectionsStatus}
            collectionsError={tokenCollectionsError}
            exportStatus={tokensExportStatus}
            exportError={tokensExportError}
            exportSuccess={tokensExportSuccess}
            previewStatus={tokensPreviewStatus}
            previewError={tokensPreviewError}
            previewFiles={tokensPreviewFiles}
            onLoadCollections={loadTokenCollections}
            onExport={exportTokens}
            onPreview={previewTokens}
          />
        </div>
      ) : null}
      {view === 'connect' && workflowTab === 'docs' ? (
        <div
          aria-labelledby="tashil-tab-docs"
          class="tabpanel"
          id="tashil-tabpanel-docs"
          role="tabpanel"
        >
          <DocumentationView
            docGenerationMessage={docGenerationMessage}
            docGenerationStatus={docGenerationStatus}
            docProgress={docProgress}
            docSourcePreview={docSourcePreview}
            docSourcePreviewError={docSourcePreviewError}
            docSourcePreviewStatus={docSourcePreviewStatus}
            inventoryState={inventoryState}
            onCancelDocGeneration={cancelDocGeneration}
            onGenerateComponentDocs={generateComponentDocs}
            onGenerateTokenDocs={generateTokenDocs}
            onRefreshComponents={() => rescanComponents(false)}
            onLoadTokenCollections={loadTokenCollections}
            onLoadSourcePreview={loadDocSourcePreview}
            onUpdateDocsInPlace={updateDocsInPlace}
            selectedDocFrame={selectedDocFrame}
            tokenCollections={tokenCollections}
            tokenCollectionsStatus={tokenCollectionsStatus}
          />
        </div>
      ) : null}
      {view === 'connect' && workflowTab === 'settings' ? (
        <div aria-labelledby="tashil-tab-settings" class="tabpanel" id="tashil-tabpanel-settings" role="tabpanel">
          <OutputSettingsView
            message={outputPreferencesMessage}
            onChange={setOutputPreferences}
            preferences={outputPreferences}
          />
        </div>
      ) : null}
      {view === 'help' ? (
        <HowItWorksView />
      ) : null}
      <div aria-hidden="true" class="resize-corner" />
    </div>
  );
}

function StorybookGenerator(props: {
  copyMode: OutputPreferences['copyMode'];
  generation: ReturnType<typeof useConnectionController>['storybookGeneration'];
  onGenerateCodeConnect: () => void;
  onGenerate: (selectedVariantTokens?: string[]) => void;
}): h.JSX.Element {
  const [selected, setSelected] = useState<string[]>([]);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (props.generation.status === 'select') setSelected([]);
    setFeedback('');
  }, [props.generation.status, props.generation.variants]);

  return (
    <section aria-labelledby="storybook-generator-heading" class="storybook-generator">
      <div>
        <h2 id="storybook-generator-heading">Storybook stories</h2>
        <p>Generate deterministic CSF 3 stories from the saved connection and Figma variants.</p>
      </div>
      <Button onClick={props.onGenerateCodeConnect} secondary>Download Code Connect</Button>
      {props.generation.status === 'idle' || props.generation.status === 'error' ? (
        <Button onClick={() => props.onGenerate()} secondary>Generate stories</Button>
      ) : null}
      {props.generation.status === 'loading' ? <span role="status">Generating…</span> : null}
      {props.generation.message ? <p class="storybook-message" role="status">{props.generation.message}</p> : null}
      {props.generation.status === 'select' && props.generation.variants ? (
        <div class="storybook-variant-picker">
          <p>{`${selected.length} of 32 selected`}</p>
          <div class="storybook-variant-list">
            {props.generation.variants.map((variant) => {
              const checked = selected.includes(variant.targetToken);
              return (
                <label key={variant.targetToken}>
                  <input
                    checked={checked}
                    disabled={!checked && selected.length >= 32}
                    onChange={() => setSelected(checked
                      ? selected.filter((token) => token !== variant.targetToken)
                      : [...selected, variant.targetToken])}
                    type="checkbox"
                  />
                  {variant.label}
                </label>
              );
            })}
          </div>
          <Button disabled={selected.length === 0} onClick={() => props.onGenerate(selected)}>Generate selected stories</Button>
        </div>
      ) : null}
      {props.generation.status === 'ready' && props.generation.code ? (
        <div class="storybook-result">
          <Button onClick={() => {
            void copyToClipboard(selectCopyContent(props.generation.code!, props.copyMode)).then(() => setFeedback('Copied stories.')).catch(() => setFeedback('Could not copy stories.'));
          }} secondary>Copy</Button>
          <Button onClick={() => downloadBlob(
            new Blob([props.generation.code!], { type: 'text/typescript' }),
            props.generation.fileName ?? 'Component.stories.tsx',
          )}>Download</Button>
{feedback ? <span aria-live="polite" role="status">{feedback}</span> : null}
        </div>
      ) : null}
    </section>
  );
}

function DocumentationView(props: {
  docGenerationMessage: string;
  docGenerationStatus: 'error' | 'idle' | 'running' | 'success';
  docProgress: { message: string; percent: number } | null;
  docSourcePreview: DocSourcePreview | null;
  docSourcePreviewError: string;
  docSourcePreviewStatus: 'error' | 'idle' | 'loading';
  inventoryState: ComponentInventoryState;
  onCancelDocGeneration: () => void;
  onGenerateComponentDocs: (targetToken: string, targetFormat?: 'canvas' | 'markdown') => void;
  onGenerateTokenDocs: (collectionId: string, targetFormat?: 'canvas' | 'markdown') => void;
  onRefreshComponents: () => void;
  onLoadSourcePreview: (scope: 'components' | 'tokens', targetId: string) => void;
  onLoadTokenCollections: () => void;
  onUpdateDocsInPlace: (frameNodeId: string) => void;
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
    onCancelDocGeneration,
    onGenerateComponentDocs,
    onGenerateTokenDocs,
    onRefreshComponents,
    onLoadSourcePreview,
    onLoadTokenCollections,
    onUpdateDocsInPlace,
    selectedDocFrame,
    tokenCollections,
    tokenCollectionsStatus,
  } = props;

  const [scope, setScope] = useState<'tokens' | 'components'>('tokens');
  const [tokenSearchQuery, setTokenSearchQuery] = useState('');
  const [componentSearchQuery, setComponentSearchQuery] = useState('');
  const [showHiddenComponents, setShowHiddenComponents] = useState(false);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [selectedTargetToken, setSelectedTargetToken] = useState<string | null>(null);

  useEffect(() => {
    if (tokenCollections.length === 0 && tokenCollectionsStatus === 'idle') {
      onLoadTokenCollections();
    }
  }, []);

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
    const targetId = scope === 'tokens' ? selectedCollectionId : selectedTargetToken;
    if (targetId) {
      onLoadSourcePreview(scope, targetId);
    }
  }, [scope, selectedCollectionId, selectedTargetToken]);

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

  const isRunning = docGenerationStatus === 'running';
  const hasSelectedSource = scope === 'tokens' ? Boolean(selectedCollectionId) : Boolean(selectedTargetToken);
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
            onClick={scope === 'tokens' ? onLoadTokenCollections : onRefreshComponents}
            secondary
          >
            <span class="button-content"><IconRefresh16 />Refresh</span>
          </Button>
        </header>

        <div class="docs-library-scope">
          <SegmentedControl
            onValueChange={(value) => setScope(value as 'tokens' | 'components')}
            options={[
              { children: 'Design tokens', value: 'tokens' },
              { children: 'Components', value: 'components' },
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
          ) : (
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
          )}
        </div>

        {selectedDocFrame?.metadata && selectedDocFrame.frameNodeId ? (
          <section class="docs-library-reconcile" aria-label="Selected documentation status">
            <div class="docs-library-banner-row">
              <Banner
                icon={selectedDocFrame.drift?.hasDrift ? <IconWarningSmall24 /> : <IconApprovedCheckmark24 />}
                variant={selectedDocFrame.drift?.hasDrift ? 'warning' : 'success'}
              >
                {selectedDocFrame.drift?.hasDrift
                  ? `Selected document “${selectedDocFrame.metadata.targetName}” has ${selectedDocChangeCount || 1} source change${selectedDocChangeCount === 1 ? '' : 's'}.`
                  : `Selected document “${selectedDocFrame.metadata.targetName}” is up to date.`}
              </Banner>
              <div class="docs-library-row-actions">
                {selectedDocFrame.metadata.docType === 'tokens' ? (
                  <Button
                    disabled={isRunning}
                    onClick={() => onGenerateTokenDocs(selectedDocFrame.metadata!.targetId, 'markdown')}
                    secondary
                  >
                    Export Markdown
                  </Button>
                ) : null}
                <Button
                  disabled={isRunning}
                  onClick={() => onUpdateDocsInPlace(selectedDocFrame.frameNodeId!)}
                >
                  Update in place
                </Button>
              </div>
            </div>
            <p class="docs-library-selected-meta">
              Generated {selectedDocFrame.metadata.generatedAt
                ? new Date(selectedDocFrame.metadata.generatedAt).toLocaleDateString()
                : 'on an unknown date'} · {selectedDocFrame.metadata.docType}
            </p>
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
          ) : filteredComponents.length > 0 ? (
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
          )}
        </section>

        {docSourcePreviewStatus !== 'idle' || docSourcePreview ? (
          <section
            aria-label="Documentation preview"
            aria-live="polite"
            class="docs-library-preview"
            role="region"
          >
            <h2>Documentation preview</h2>
            {docSourcePreviewStatus === 'loading' ? (
              <div class="docs-library-preview-loading">
                <LoadingIndicator />
                <span>Calculating a lightweight preview…</span>
              </div>
            ) : docSourcePreviewStatus === 'error' ? (
              <p class="docs-library-preview-error">{docSourcePreviewError}</p>
            ) : docSourcePreview?.scope === 'tokens' ? (
              <div class="docs-library-preview-content">
                <strong>{docSourcePreview.groupCount} group{docSourcePreview.groupCount === 1 ? '' : 's'} will be generated</strong>
                <span>
                  {docSourcePreview.groupNames.join(' · ')}
                  {docSourcePreview.groupCount > docSourcePreview.groupNames.length
                    ? ` · +${docSourcePreview.groupCount - docSourcePreview.groupNames.length} more`
                    : ''}
                </span>
                <small>{docSourcePreview.tokenCount} tokens · {docSourcePreview.modeCount} modes</small>
              </div>
            ) : docSourcePreview?.scope === 'components' ? (
              <div class="docs-library-preview-content">
                <strong>{docSourcePreview.combinationCount.toLocaleString()} variant combination{docSourcePreview.combinationCount === 1 ? '' : 's'} will be generated</strong>
                <span>{docSourcePreview.propertyCount} variant propert{docSourcePreview.propertyCount === 1 ? 'y' : 'ies'}</span>
                <small>{docSourcePreview.sourceName}</small>
              </div>
            ) : null}
          </section>
        ) : null}

        {isRunning || docProgress ? (
          <div aria-live="polite" class="docs-library-progress">
            <LoadingIndicator />
            <div class="docs-library-progress-copy">
              <strong>{docProgress?.message || docGenerationMessage || 'Processing…'}</strong>
              <progress aria-label="Documentation generation progress" max={100} value={docProgress?.percent ?? 0} />
            </div>
            <span>{docProgress?.percent ?? 0}%</span>
            <Button onClick={onCancelDocGeneration} secondary>Cancel</Button>
          </div>
        ) : docGenerationMessage ? (
          <div aria-live="polite" class="docs-library-result">
            <Banner
              icon={docGenerationStatus === 'error' ? <IconWarningSmall24 /> : <IconApprovedCheckmark24 />}
              variant={docGenerationStatus === 'error' ? 'warning' : 'success'}
            >
              {docGenerationMessage}
            </Banner>
          </div>
        ) : null}
      </div>

      <footer class="sync-tokens-footer">
        <div class="spacer" />
        <div class="primary-actions">
          <Button
            disabled={!hasSelectedSource || isRunning}
            onClick={() => {
              if (scope === 'tokens' && selectedCollectionId) {
                onGenerateTokenDocs(selectedCollectionId, 'canvas');
              } else if (scope === 'components' && selectedTargetToken) {
                onGenerateComponentDocs(selectedTargetToken, 'canvas');
              }
            }}
          >
            {scope === 'tokens' ? 'Generate page' : 'Generate variants'}
          </Button>
        </div>
      </footer>
    </main>
  );
}

function OutputSettingsView(props: {
  message: string;
  onChange: (preferences: OutputPreferences) => void;
  preferences: OutputPreferences;
}): h.JSX.Element {
  const update = <K extends keyof OutputPreferences>(key: K, value: OutputPreferences[K]): void => {
    props.onChange({ ...props.preferences, [key]: value });
  };
  return (
    <main aria-labelledby="output-settings-heading" class="output-settings-view">
      <h1 id="output-settings-heading">Output settings</h1>
      <p>Stored for your Figma user only. Defaults preserve existing generated output.</p>
      <div class="output-settings-grid">
        <Field id="output-quote-style" label="Quote style">
          <SegmentedControl
            onValueChange={(value) => update('quoteStyle', value as OutputPreferences['quoteStyle'])}
            options={[{ value: 'double', children: 'Double' }, { value: 'single', children: 'Single' }]}
            value={props.preferences.quoteStyle}
          />
        </Field>
        <Field id="output-indentation" label="Indentation">
          <Dropdown
            onValueChange={(value) => update('indentation', value as OutputPreferences['indentation'])}
            options={[{ value: '2', text: '2 spaces' }, { value: '4', text: '4 spaces' }, { value: 'tab', text: 'Tabs' }]}
            value={props.preferences.indentation}
          />
        </Field>
        <Field id="output-copy-mode" label="Copy mode">
          <Dropdown
            onValueChange={(value) => update('copyMode', value as OutputPreferences['copyMode'])}
            options={[{ value: 'full', text: 'Full output' }, { value: 'without-imports', text: 'Without imports' }, { value: 'imports-only', text: 'Imports only' }]}
            value={props.preferences.copyMode}
          />
        </Field>
        <Field id="output-preview-direction" label="Preview direction">
          <SegmentedControl
            onValueChange={(value) => update('previewDirection', value as OutputPreferences['previewDirection'])}
            options={[{ value: 'ltr', children: 'LTR' }, { value: 'rtl', children: 'RTL' }]}
            value={props.preferences.previewDirection}
          />
        </Field>
        <Field id="output-styled-pattern" label="Styled-component naming pattern">
          <Textbox
            onValueInput={(value) => { if (value.includes('{Name}')) update('styledComponentPattern', value); }}
            value={props.preferences.styledComponentPattern}
          />
        </Field>
        <Toggle onValueChange={(value) => update('semicolons', value)} value={props.preferences.semicolons}>Semicolons</Toggle>
        <Toggle onValueChange={(value) => update('trailingComma', value)} value={props.preferences.trailingComma}>Trailing commas</Toggle>
      </div>
      <p aria-live="polite" role="status">{props.message}</p>
    </main>
  );
}

type InventoryFilter = 'all' | 'not-connected' | 'connected';

function ComponentInventoryView(props: {
  filter: InventoryFilter;
  hideDotPrefixed: boolean;
  inventoryState: ComponentInventoryState;
  importEntries: readonly ConnectionImportPlanEntry[];
  portabilityMessage: string;
  onApplyImport: (choices: Array<{ action: 'overwrite' | 'skip'; imported: ConnectionImportPlanEntry['imported']; targetToken: string }>) => void;
  onExport: () => void;
  onFilterChange: (filter: InventoryFilter) => void;
  onHideDotPrefixedChange: (hide: boolean) => void;
  onOpenTarget: (targetToken: string) => void;
  onPreviewImport: (file: File) => Promise<void>;
  onQueryChange: (query: string) => void;
  onRescan: () => void;
  query: string;
  scrollRef: { current: HTMLDivElement | null };
}): h.JSX.Element {
  const state = props.inventoryState;

  if (state.status === 'scanning') {
    const progress = state.totalPages > 0
      ? Math.round((state.scannedPages / state.totalPages) * 100)
      : 0;
    return (
      <main
        aria-busy="true"
        aria-label="Scanning components"
        class="inventory-state"
      >
        <div aria-hidden="true" class="inventory-spinner" />
        <h1 class="inventory-state-title">Scanning main components of this file…</h1>
        <p class="inventory-state-copy">
          {state.totalPages > 0
            ? `Page ${state.scannedPages} of ${state.totalPages}`
            : 'Preparing scan…'}
        </p>
        <div
          aria-label={`${progress}% complete`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={progress}
          class="inventory-progress"
          role="progressbar"
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <div aria-live="polite" class="visually-hidden" role="status">
          {state.totalPages > 0
            ? `Scanned ${state.scannedPages} of ${state.totalPages} pages.`
            : 'Scanning started.'}
        </div>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <InventoryMessage
        actionLabel="Scan again"
        message={state.message}
        onAction={() => props.onRescan()}
        title="Components could not be scanned"
      />
    );
  }

  const hiddenDotPrefixedCount = state.items.filter(
    (item) => item.componentName.startsWith('.'),
  ).length;
  const items = props.hideDotPrefixed
    ? state.items.filter((item) => !item.componentName.startsWith('.'))
    : state.items;
  const counts = {
    all: items.length,
    connected: items.filter((item) => item.status === 'connected').length,
    notConnected: items.filter((item) => item.status !== 'connected').length,
  };
  const normalizedQuery = props.query.trim().toLocaleLowerCase();
  const visibleItems = items.filter((item) => {
    const matchesFilter = props.filter === 'all'
      || (props.filter === 'connected' && item.status === 'connected')
      || (props.filter === 'not-connected' && item.status !== 'connected');
    const matchesQuery = normalizedQuery === ''
      || item.componentName.toLocaleLowerCase().includes(normalizedQuery)
      || item.pageName.toLocaleLowerCase().includes(normalizedQuery);
    return matchesFilter && matchesQuery;
  });

  return (
    <main aria-label="Components inventory" class="inventory" ref={props.scrollRef}>
      <Container space="medium">
        <VerticalSpace space="medium" />
        <div class="inventory-heading-row">
          <div>
            <h1 class="inventory-heading">Main components</h1>
            <p class="inventory-subheading">Choose a component to connect it to code.</p>
          </div>
          <Button onClick={() => props.onRescan()} secondary>Scan coverage</Button>
        </div>

        <div class="connection-portability-actions">
          <Button onClick={props.onExport} secondary>Export connections</Button>
          <label class="connection-import-button">
            Import connections
            <input
              accept="application/json,.json"
              class="visually-hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void props.onPreviewImport(file);
                event.currentTarget.value = '';
              }}
              type="file"
            />
          </label>
        </div>
        {props.portabilityMessage ? (
          <p aria-live="polite" class="connection-portability-message" role="status">
            {props.portabilityMessage}
          </p>
        ) : null}
        {props.importEntries.length > 0 ? (
          <ConnectionImportPreview
            entries={props.importEntries}
            onApply={props.onApplyImport}
          />
        ) : null}

        {state.coverage ? <ConnectionCoveragePanel coverage={state.coverage} /> : null}

        {state.status === 'partial' ? (
          <div class="inventory-notice" role="status">
            <strong>Partial scan.</strong> {state.message}
          </div>
        ) : null}

        {items.length > 0 ? (
          <Fragment>
            <div aria-label="Filter components" class="inventory-filters" role="group">
              <InventoryFilterButton
                count={counts.all}
                label="All"
                onClick={() => props.onFilterChange('all')}
                pressed={props.filter === 'all'}
              />
              <InventoryFilterButton
                count={counts.notConnected}
                label="Not connected"
                onClick={() => props.onFilterChange('not-connected')}
                pressed={props.filter === 'not-connected'}
              />
              <InventoryFilterButton
                count={counts.connected}
                label="Connected"
                onClick={() => props.onFilterChange('connected')}
                pressed={props.filter === 'connected'}
              />
            </div>
            <label class="visually-hidden" htmlFor="tashil-component-search">
              Search components
            </label>
            <input
              class="inventory-search"
              id="tashil-component-search"
              onInput={(event) => {
                props.onQueryChange(event.currentTarget.value);
              }}
              placeholder="Search components or pages"
              type="search"
              value={props.query}
            />
            <button
              aria-pressed={props.hideDotPrefixed}
              class={props.hideDotPrefixed
                ? 'inventory-dot-filter inventory-dot-filter-active'
                : 'inventory-dot-filter'}
              onClick={() => {
                props.onHideDotPrefixedChange(!props.hideDotPrefixed);
              }}
              type="button"
            >
              <span aria-hidden="true" class="inventory-dot-filter-check">
                {props.hideDotPrefixed ? '✓' : ''}
              </span>
              <span>Hide names starting with .</span>
              {hiddenDotPrefixedCount > 0 ? (
                <span class="inventory-dot-filter-count">
                  {hiddenDotPrefixedCount}
                </span>
              ) : null}
            </button>

            {visibleItems.length > 0 ? (
              <div class="inventory-list" role="list">
                {visibleItems.map((item) => (
                  <div key={item.targetToken} role="listitem">
                    <button
                      class="inventory-row"
                      id={`tashil-component-${item.targetToken}`}
                      onClick={() => props.onOpenTarget(item.targetToken)}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        class={`inventory-status inventory-status-${item.status}`}
                      >
                        {item.status === 'connected'
                          ? '✓'
                          : item.status === 'needs-attention' ? '!' : '○'}
                      </span>
                      <span class="inventory-row-copy">
                        <span class="inventory-component-name">{item.componentName}</span>
                        <span class="inventory-page-name">{item.pageName}</span>
                        {item.instanceCount === undefined ? null : (
                          <span class="inventory-instance-count">
                            {`${item.instanceCount} instance${item.instanceCount === 1 ? '' : 's'}`}
                          </span>
                        )}
                      </span>
                      {item.status === 'needs-attention' ? (
                        <span class="inventory-warning-badge">Needs attention</span>
                      ) : null}
                      <span aria-hidden="true" class="inventory-chevron">›</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div class="inventory-no-results" role="status">
                <strong>No matching components</strong>
                <span>Try another search or filter.</span>
              </div>
            )}
            <div aria-live="polite" class="visually-hidden" role="status">
              {`${visibleItems.length} component${visibleItems.length === 1 ? '' : 's'} shown.`}
            </div>
          </Fragment>
        ) : (
          <div class="inventory-no-results" role="status">
            <strong>No local main components found</strong>
            <span>This file does not contain any standalone components or component sets.</span>
          </div>
        )}
        <VerticalSpace space="medium" />
      </Container>
    </main>
  );
}

function ConnectionCoveragePanel(props: {
  coverage: NonNullable<Extract<ComponentInventoryState, { status: 'ready' | 'partial' }>['coverage']>;
}): h.JSX.Element {
  const coveragePercent = props.coverage.totalInstanceCount === 0
    ? 0
    : Math.round((props.coverage.connectedInstanceCount / props.coverage.totalInstanceCount) * 100);
  return (
    <section aria-labelledby="connection-coverage-heading" class="connection-coverage">
      <div class="connection-coverage-heading">
        <h2 id="connection-coverage-heading">Connection coverage</h2>
        <strong>{coveragePercent}%</strong>
      </div>
      <div aria-label={`${coveragePercent}% of instances connected`} class="connection-coverage-bar" role="img">
        <span style={{ width: `${coveragePercent}%` }} />
      </div>
      <p>
        {`${props.coverage.connectedInstanceCount} of ${props.coverage.totalInstanceCount} instances use connected components.`}
      </p>
      {props.coverage.brokenInstanceCount > 0 ? (
        <details class="connection-broken-instances">
          <summary>{`${props.coverage.brokenInstanceCount} broken instance${props.coverage.brokenInstanceCount === 1 ? '' : 's'}`}</summary>
          <ul>
            {props.coverage.brokenInstances.map((instance, index) => (
              <li key={`${instance.pageName}-${instance.layerPath}-${index}`}>
                <strong>{instance.pageName}</strong>: {instance.layerPath}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function ConnectionImportPreview(props: {
  entries: readonly ConnectionImportPlanEntry[];
  onApply: (choices: Array<{ action: 'overwrite' | 'skip'; imported: ConnectionImportPlanEntry['imported']; targetToken: string }>) => void;
}): h.JSX.Element {
  type ImportChoice = 'keep' | 'overwrite' | 'skip';
  const [choices, setChoices] = useState<Record<number, ImportChoice>>({});

  useEffect(() => {
    setChoices(Object.fromEntries(props.entries.map((entry, index) => [
      index,
      entry.status === 'matched' ? 'overwrite' : 'keep',
    ])));
  }, [props.entries]);

  const applicable = props.entries.filter((entry) => entry.targetToken);
  return (
    <section aria-labelledby="connection-import-heading" class="connection-import-preview">
      <h2 id="connection-import-heading">Import preview</h2>
      <p>No document data changes until you confirm below.</p>
      <div class="connection-import-list">
        {props.entries.map((entry, index) => (
          <div class="connection-import-row" key={`${entry.componentName}-${index}`}>
            <span>
              <strong>{entry.componentName}</strong>
              <small>{entry.status === 'matched' ? 'Ready to import' : entry.status === 'conflict' ? 'Existing connection found' : 'Component not found'}</small>
            </span>
            {entry.targetToken ? (
              <select
                aria-label={`Import action for ${entry.componentName}`}
                onChange={(event) => setChoices({ ...choices, [index]: event.currentTarget.value as ImportChoice })}
                value={choices[index] ?? (entry.status === 'matched' ? 'overwrite' : 'keep')}
              >
                {entry.status === 'conflict' ? <option value="keep">Keep existing</option> : null}
                <option value="overwrite">{entry.status === 'conflict' ? 'Overwrite with imported' : 'Import'}</option>
                <option value="skip">Skip</option>
              </select>
            ) : <span class="connection-import-missing">Missing</span>}
          </div>
        ))}
      </div>
      <Button
        disabled={applicable.length === 0}
        onClick={() => props.onApply(props.entries.flatMap((entry, index) => entry.targetToken ? [{
          action: choices[index] === 'overwrite' ? 'overwrite' as const : 'skip' as const,
          imported: entry.imported,
          targetToken: entry.targetToken,
        }] : []))}
      >
        Confirm import
      </Button>
    </section>
  );
}

function InventoryFilterButton(props: {
  count: number;
  label: string;
  onClick: () => void;
  pressed: boolean;
}): h.JSX.Element {
  return (
    <button
      aria-pressed={props.pressed}
      class={props.pressed
        ? 'inventory-filter inventory-filter-active'
        : 'inventory-filter'}
      onClick={props.onClick}
      type="button"
    >
      <strong>{props.count}</strong>
      <span>{props.label}</span>
    </button>
  );
}

function InventoryMessage(props: {
  actionLabel: string;
  message: string;
  onAction: () => void;
  title: string;
}): h.JSX.Element {
  return (
    <main class="inventory-state" role="alert">
      <h1 class="inventory-state-title">{props.title}</h1>
      <p class="inventory-state-copy">{props.message}</p>
      <Button onClick={props.onAction}>{props.actionLabel}</Button>
    </main>
  );
}

function ConnectComponentView(props: {
  clearCancelButtonRef: (element: HTMLButtonElement | null) => void;
  componentName: string;
  connectionHealth?: ConnectionHealth;
  customPropMappings: string;
  errorMessage: string;
  fieldErrors: FormErrors;
  figmaComponentName: string;
  handleCancelClear: () => void;
  handleClear: () => void;
  handleSave: () => void;
  handleScaffold: () => void;
  importPath: string;
  intentionalFigmaPropertyPrefixes: string;
  isClearConfirmationOpen: boolean;
  isDirty: boolean;
  isReady: boolean;
  isSourceUploading: boolean;
  mappingDocument: string;
  previewDirection: OutputPreferences['previewDirection'];
  pendingOperation?: PendingMutation['operation'];
  propMappings: string;
  targetState: UiTargetState;
  setCustomPropMappings: (value: string) => void;
  setComponentName: (value: string) => void;
  setImportPath: (value: string) => void;
  setIntentionalFigmaPropertyPrefixes: (value: string) => void;
  setMappedProperty: (sourcePropName: string, figmaPropertyId: string) => void;
  setMappedValue: (
    sourcePropName: string,
    sourceValue: string | number | boolean,
    figmaValue: string,
  ) => void;
  semanticRecipe?: SemanticConnectionRecipe;
  semanticProposals: ReconciliationProposal[];
  applySemanticProposal: (
    proposal: ReconciliationProposal,
    action: ReconciliationAction,
  ) => void;
  exportDebugBundle: () => void;
  exportReport: (format: 'markdown' | 'json') => void;
  isSourceReplacementPending: boolean;
  sourceReplacementCancelRef: (element: HTMLButtonElement | null) => void;
  confirmSourceReplacement: () => void;
  cancelSourceReplacement: () => void;
  setSemanticOption: (
    targetPath: readonly string[],
    optionId: string,
    staticValue?: string | number | boolean,
  ) => void;
  setSemanticRepeatedInstances: (
    targetPath: readonly string[],
    orderedOptionIds: readonly string[],
  ) => void;
  setSemanticValueMapping: (
    targetPath: readonly string[],
    sourceValue: string | number | boolean,
    figmaOption: string,
  ) => void;
  reconcileFigma: () => void;
  removeStaleMapping: (sourcePropName: string) => void;
  setPropMappings: (value: string) => void;
  setSourcePath: (value: string) => void;
  setSourceUrl: (value: string) => void;
  setStorybookUrl: (value: string) => void;
  sourcePath: string;
  sourceUrl: string;
  statusMessage: string;
  storybookUrl: string;
  uploadSourceFiles: (files: readonly File[]) => Promise<void>;
}): h.JSX.Element {
  if (!props.isReady) {
    return (
      <EmptyComponentSelectionState message={props.targetState.message} />
    );
  }

  // One mapping card, never two: the semantic editor takes over completely
  // once a source contract exists, otherwise the legacy editor is the upload
  // entry point and mapping surface.
  const semanticOwnsMapping = SEMANTIC_CONNECT_AUTHORING_ENABLED
    && props.semanticRecipe?.sourceContract !== undefined;

  const existingConnection = props.targetState.status === 'ready'
    ? props.targetState.existingConnection
    : undefined;
  const connectionIssue = props.targetState.status === 'ready'
    ? props.targetState.connectionIssue
    : undefined;
  const sourceDocumentation = readSourceDocumentation(props.mappingDocument);
  const figmaDescription = props.targetState.status === 'ready'
    ? props.targetState.figmaSnapshot?.description
    : undefined;

  return (
    <Fragment>
      <main
        aria-busy={props.pendingOperation ? 'true' : 'false'}
        aria-label="Connect component setup"
        class="fields"
      >
        <Container space="medium">
          <VerticalSpace space="medium" />
          <ConnectionStatusPanel
            connectionIssue={connectionIssue}
            hasConnection={existingConnection !== undefined}
            isDirty={props.isDirty}
            updatedAt={existingConnection?.updatedAt}
          />
          <VerticalSpace space="medium" />

          <section class="setup-step" aria-labelledby="tashil-step-code-target">
            <div class="setup-step-heading">
              <span class="setup-step-number" aria-hidden="true">1</span>
              <div>
                <h2 class="setup-step-title" id="tashil-step-code-target">Code component</h2>
                <p class="setup-step-help">
                  The exported React component this Figma component becomes.
                </p>
              </div>
            </div>
          <div class="form-stack">
            <Field
              id={FORM_FIELD_IDS.figmaComponentName}
              label="Figma component name"
            >
              <Textbox
                disabled
                id={FORM_FIELD_IDS.figmaComponentName}
                value={props.figmaComponentName}
              />
            </Field>
            <Field
              id={FORM_FIELD_IDS.intentionalFigmaPropertyPrefixes}
              label="Intentional Figma property prefixes"
            >
              <Textbox
                disabled={!props.isReady}
                id={FORM_FIELD_IDS.intentionalFigmaPropertyPrefixes}
                onValueInput={props.setIntentionalFigmaPropertyPrefixes}
                placeholder="e.g., prototype/, internal/"
                value={props.intentionalFigmaPropertyPrefixes}
              />
            </Field>
            <small class="field-hint">
              Comma-separated prefixes ignored when newly added Figma properties are reviewed.
            </small>
            <small class="field-hint">
              The selected Figma main component or component set used by this connection.
            </small>

            <Field
              error={props.fieldErrors.componentName}
              id={FORM_FIELD_IDS.componentName}
              label="Source component name"
            >
              <Textbox
                aria-describedby={getFieldErrorId('componentName', props.fieldErrors)}
                aria-invalid={Boolean(props.fieldErrors.componentName)}
                aria-required="true"
                disabled={!props.isReady}
                id={FORM_FIELD_IDS.componentName}
                onValueInput={props.setComponentName}
                placeholder="e.g., Button"
                value={props.componentName}
              />
            </Field>
            <small class="field-hint">
              The exported React component used by generated code. Source upload
              detects this name independently from the Figma component name.
            </small>

            <Field
              error={props.fieldErrors.importPath}
              id={FORM_FIELD_IDS.importPath}
              label="Import path"
            >
              <Textbox
                aria-describedby={getFieldErrorId('importPath', props.fieldErrors)}
                aria-invalid={Boolean(props.fieldErrors.importPath)}
                aria-required="true"
                disabled={!props.isReady}
                id={FORM_FIELD_IDS.importPath}
                onValueInput={props.setImportPath}
                placeholder="e.g., tashil-ui"
                value={props.importPath}
              />
            </Field>
          </div>
          {figmaDescription || sourceDocumentation ? (
            <section class="description-panel" aria-label="Component documentation">
              {figmaDescription ? <Fragment><h3>Figma description</h3><p>{figmaDescription}</p></Fragment> : null}
              {sourceDocumentation?.component ? <Fragment><h3>Source documentation</h3><p>{sourceDocumentation.component}</p></Fragment> : null}
              {sourceDocumentation?.props.length ? (
                <dl class="description-props">
                  {sourceDocumentation.props.map((item) => (
                    <Fragment key={item.name}><dt>{item.name}</dt><dd>{item.description}</dd></Fragment>
                  ))}
                </dl>
              ) : null}
            </section>
          ) : null}
          </section>

          <section class="setup-step" aria-labelledby="tashil-step-mapping">
            <div class="setup-step-heading">
              <span class="setup-step-number" aria-hidden="true">2</span>
              <div>
                <h2 class="setup-step-title" id="tashil-step-mapping">Props &amp; mapping</h2>
                <p class="setup-step-help">
                  Upload the component source, then connect each code prop to the
                  design value that feeds it.
                </p>
              </div>
            </div>
          <div class="form-stack">
            <details class="advanced-mappings">
              <summary>References (optional)</summary>
            <Field
              error={props.fieldErrors.storybookUrl}
              id={FORM_FIELD_IDS.storybookUrl}
              label="Storybook URL"
            >
              <Textbox
                aria-describedby={getFieldErrorId('storybookUrl', props.fieldErrors)}
                aria-invalid={Boolean(props.fieldErrors.storybookUrl)}
                disabled={!props.isReady}
                id={FORM_FIELD_IDS.storybookUrl}
                onValueInput={props.setStorybookUrl}
                placeholder="e.g., https://storybook.example.com/?path=/story/..."
                value={props.storybookUrl}
              />
            </Field>

            <Field id={FORM_FIELD_IDS.sourcePath} label="Source path">
              <Textbox
                disabled={!props.isReady}
                id={FORM_FIELD_IDS.sourcePath}
                onValueInput={props.setSourcePath}
                placeholder="e.g., src/components/Button/Button.tsx"
                value={props.sourcePath}
              />
            </Field>

            <Field
              error={props.fieldErrors.sourceUrl}
              id={FORM_FIELD_IDS.sourceUrl}
              label="Source URL"
            >
              <Textbox
                aria-describedby={getFieldErrorId('sourceUrl', props.fieldErrors)}
                aria-invalid={Boolean(props.fieldErrors.sourceUrl)}
                disabled={!props.isReady}
                id={FORM_FIELD_IDS.sourceUrl}
                onValueInput={props.setSourceUrl}
                placeholder="e.g., https://github.com/org/repo/blob/main/src/..."
                value={props.sourceUrl}
              />
            </Field>
            </details>

            {semanticOwnsMapping ? null : (
            <MappingEditorView
              disabled={!props.isReady || props.pendingOperation !== undefined}
              connectionHealth={props.connectionHealth}
              customPropMappings={props.customPropMappings}
              customPropMappingsError={props.fieldErrors.customPropMappings}
              mappingDocument={props.mappingDocument}
              mappingDocumentError={props.fieldErrors.mappingDocument}
              onCustomJsonInput={props.setCustomPropMappings}
              onFilesSelected={(files) => { void props.uploadSourceFiles(files); }}
              onLegacyJsonInput={props.setPropMappings}
              onPropertyChange={props.setMappedProperty}
              onReconcileFigma={props.reconcileFigma}
              onRemoveStaleMapping={props.removeStaleMapping}
              onScaffold={props.handleScaffold}
              onValueChange={props.setMappedValue}
              propMappings={props.propMappings}
              propMappingsError={props.fieldErrors.propMappings}
              scaffoldPending={props.pendingOperation === 'scaffold'}
              sourceUploading={props.isSourceUploading}
            />
            )}

            {props.isSourceReplacementPending ? (
              <div class="connection-health connection-health-needs-review" role="alertdialog" aria-labelledby="tashil-replace-source-heading">
                <div class="connection-health-heading">
                  <strong id="tashil-replace-source-heading">Replace uploaded source?</strong>
                </div>
                <small>Replacing the source may change or invalidate your current mappings.</small>
                <div class="connection-health-actions">
                  <button onClick={props.confirmSourceReplacement} type="button">Replace source</button>
                  <button ref={props.sourceReplacementCancelRef} onClick={props.cancelSourceReplacement} type="button">Keep current</button>
                </div>
              </div>
            ) : null}

            {semanticOwnsMapping ? (
              <SemanticMappingView
                componentName={props.componentName}
                disabled={!props.isReady || props.pendingOperation !== undefined}
                error={props.fieldErrors.semanticRecipe}
                figmaSnapshot={props.targetState.status === 'ready'
                  ? props.targetState.figmaSnapshot
                  : undefined}
                importPath={props.importPath}
                previewDirection={props.previewDirection}
                onApplyProposal={props.applySemanticProposal}
                onExportDebugBundle={props.exportDebugBundle}
                onExportReport={props.exportReport}
                onFilesSelected={(files) => { void props.uploadSourceFiles(files); }}
                onOptionChange={props.setSemanticOption}
                onRepeatedInstancesChange={props.setSemanticRepeatedInstances}
                onValueMappingChange={props.setSemanticValueMapping}
                sourceUploading={props.isSourceUploading}
                proposals={props.semanticProposals}
                recipe={props.semanticRecipe}
              />
            ) : null}
          </div>
          </section>
          {props.errorMessage ? (
            <Fragment>
              <VerticalSpace space="small" />
              <div class="form-error" role="alert">
                {props.errorMessage}
              </div>
            </Fragment>
          ) : null}
          <div aria-atomic="true" aria-live="polite" class="form-status" role="status">
            {props.statusMessage}
          </div>
          <VerticalSpace space="medium" />
        </Container>
      </main>

      <div class="footer">
        <div class="actions">
          {props.isClearConfirmationOpen ? (
            <Fragment>
              <div
                aria-atomic="true"
                aria-live="assertive"
                class="footer-confirmation-copy"
                role="alert"
              >
                <div class="clear-confirmation-title">Clear connection?</div>
                <div>Deletes shared Storybook metadata.</div>
              </div>
              <div class="clear-confirmation-actions">
                <Button
                  disabled={props.pendingOperation !== undefined}
                  onClick={props.handleCancelClear}
                  ref={props.clearCancelButtonRef}
                  secondary
                >
                  Cancel
                </Button>
                <Button
                  disabled={props.pendingOperation !== undefined}
                  onClick={props.handleClear}
                >
                  {props.pendingOperation === 'clear' ? 'Clearing…' : 'Clear connection'}
                </Button>
              </div>
            </Fragment>
          ) : (
            <Fragment>
              <div class="spacer" />
              <div class="primary-actions">
                {existingConnection && !connectionIssue ? (
                  <Button
                    disabled={!props.isReady || props.pendingOperation !== undefined}
                    id="tashil-clear-button"
                    onClick={props.handleClear}
                    secondary
                  >
                    {props.pendingOperation === 'clear' ? 'Clearing…' : 'Clear'}
                  </Button>
                ) : null}
                <Button
                  disabled={
                    !props.isReady
                    || !props.isDirty
                    || props.connectionHealth?.status === 'broken'
                    || connectionIssue !== undefined
                    || props.pendingOperation !== undefined
                  }
                  loading={props.pendingOperation === 'save'}
                  onClick={props.handleSave}
                >
                  {props.pendingOperation === 'save' ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </Fragment>
          )}
        </div>
      </div>
    </Fragment>
  );
}

function readSourceDocumentation(raw: string): {
  component?: string;
  props: Array<{ description: string; name: string }>;
} | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isMappingDocument(value) || !value.sourceSnapshot) return undefined;
    const props = value.sourceSnapshot.props.flatMap(({ description, name }) => (
      description ? [{ description, name }] : []
    ));
    return value.sourceSnapshot.description || props.length > 0
      ? { component: value.sourceSnapshot.description, props }
      : undefined;
  } catch {
    return undefined;
  }
}

function ConnectionStatusPanel(props: {
  connectionIssue?: ConnectionIssue;
  hasConnection: boolean;
  isDirty: boolean;
  updatedAt?: string;
}): h.JSX.Element {
  const summary = getConnectionStatusSummary(props.hasConnection, props.isDirty);
  const connectionLabel = props.connectionIssue
    ? 'Stored connection needs attention'
    : summary.connectionLabel;
  const unsavedLabel = props.connectionIssue ? undefined : summary.unsavedLabel;
  const updatedAt = formatConnectionUpdatedAt(props.updatedAt);
  const className = props.connectionIssue
    ? 'connection-status connection-status-issue'
    : props.hasConnection
      ? 'connection-status connection-status-connected'
      : 'connection-status connection-status-not-connected';

  return (
    <section
      aria-labelledby="tashil-connection-status-heading"
      class={className}
    >
      <div class="connection-status-header">
        <span aria-hidden="true" class="connection-status-indicator" />
        <h1 class="connection-status-title" id="tashil-connection-status-heading">
          {connectionLabel}
        </h1>
        {unsavedLabel ? (
          <span class="connection-unsaved-label">{unsavedLabel}</span>
        ) : null}
      </div>
      {props.connectionIssue ? (
        <div class="connection-issue-message">
          {props.connectionIssue.message}
        </div>
      ) : props.hasConnection ? (
        <div class="connection-updated-at">
          Last updated:{' '}
          {updatedAt ? (
            <time dateTime={updatedAt.dateTime}>{updatedAt.label}</time>
          ) : (
            'Not available'
          )}
        </div>
      ) : null}
    </section>
  );
}

function EmptyComponentSelectionState(props: { message: string }): h.JSX.Element {
  const lines = props.message.split('\n');

  return (
    <main aria-label="Connect component selection" class="connect-empty">
      <div aria-hidden="true" class="inspect-empty-icon">
        <IconInteractionClickSmall48 />
      </div>
      <div class="inspect-empty-label">
        {lines.map((line, index) => (
          <Text key={index}>{line}</Text>
        ))}
      </div>
    </main>
  );
}

/**
 * Sync Tokens tab: pick which Variable collections to export as CSS, with
 * output settings (mode, px→rem, color format, name style). Export delivers
 * one CSS file per collection, zipped when there are several.
 */
function tokenFileSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function boundedCssPreview(css: string, maximumLines = 14): string {
  const lines = css.split('\n');
  if (lines.length <= maximumLines) {
    return css;
  }
  const hiddenLineCount = lines.length - maximumLines + 1;
  return [
    ...lines.slice(0, maximumLines - 2),
    `  /* … ${hiddenLineCount} more declarations */`,
    lines[lines.length - 1],
  ].join('\n');
}

function SyncTokensView(props: {
  collections: readonly TokenCollectionSummary[];
  collectionsStatus: 'idle' | 'loading' | 'error';
  collectionsError: string;
  exportStatus: 'idle' | 'exporting' | 'error';
  exportError: string;
  exportSuccess: string;
  previewStatus: 'idle' | 'loading' | 'error';
  previewError: string;
  previewFiles: readonly ExportFile[];
  onLoadCollections: () => void;
  onExport: (collectionIds: readonly string[], options: ExportOptions) => void;
  onPreview: (collectionIds: readonly string[], options: ExportOptions) => void;
}): h.JSX.Element {
  const {
    collections,
    collectionsStatus,
    collectionsError,
    exportStatus,
    exportError,
    exportSuccess,
    previewStatus,
    previewError,
    previewFiles,
    onLoadCollections,
    onExport,
    onPreview,
  } = props;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Per-collection selected mode ids. Empty = "default mode only".
  const [modesByCollection, setModesByCollection] = useState<Record<string, Set<string>>>({});
  const [query, setQuery] = useState('');
  const [convertPxToRem, setConvertPxToRem] = useState(true);
  const [rootFontSize, setRootFontSize] = useState<number>(16);
  const [colorFormat, setColorFormat] = useState<ColorFormat>('hex');
  const [nameStyle, setNameStyle] = useState<NameStyle>('lower-hyphen');
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('css');
  const [aliasModeOverrides, setAliasModeOverrides] = useState<
    Record<string, Record<string, Record<string, string>>>
  >({});

  // Load once on mount.
  useEffect(() => {
    if (collections.length === 0 && collectionsStatus === 'idle') {
      onLoadCollections();
    }
  }, []); // ponytail: mount-only; status read at fire time, not a dep.

  const busy = collectionsStatus === 'loading' || exportStatus === 'exporting';

  function modesFor(collection: TokenCollectionSummary): Set<string> {
    const chosen = modesByCollection[collection.id];
    if (chosen && chosen.size > 0) {
      return chosen;
    }
    return new Set([collection.defaultModeId]);
  }

  function toggleCollection(collection: TokenCollectionSummary): void {
    const selecting = !selected.has(collection.id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(collection.id)) {
        next.delete(collection.id);
      } else {
        next.add(collection.id);
      }
      return next;
    });
    if (selecting && modesByCollection[collection.id] === undefined) {
      setModesByCollection((prev) => ({
        ...prev,
        [collection.id]: new Set([collection.defaultModeId]),
      }));
    }
  }

  function selectAll(): void {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const collection of filteredCollections) {
        if (allSelected) {
          next.delete(collection.id);
        } else {
          next.add(collection.id);
        }
      }
      return next;
    });
    if (!allSelected) {
      setModesByCollection((prev) => {
        const next = { ...prev };
        for (const collection of filteredCollections) {
          if (next[collection.id] === undefined) {
            next[collection.id] = new Set([collection.defaultModeId]);
          }
        }
        return next;
      });
    }
  }

  function toggleMode(collection: TokenCollectionSummary, modeId: string): void {
    setModesByCollection((prev) => {
      const current = new Set(modesFor(collection));
      if (current.has(modeId)) {
        if (current.size > 1) {
          current.delete(modeId);
        }
      } else {
        current.add(modeId);
      }
      return { ...prev, [collection.id]: current };
    });
  }

  function handleExport(): void {
    if (selected.size === 0) {
      return;
    }
    const payloadModes: Record<string, readonly string[]> = {};
    for (const collection of collections) {
      if (selected.has(collection.id)) {
        payloadModes[collection.id] = [...modesFor(collection)];
      }
    }
    onExport([...selected], {
      modesByCollection: payloadModes,
      aliasModeOverridesByCollectionMode: aliasModeOverrides,
      convertPxToRem,
      rootFontSize: rootFontSize > 0 ? rootFontSize : 16,
      colorFormat,
      nameStyle,
      outputFormat,
    });
  }

  function clearAllSelections(): void {
    setSelected(new Set());
  }

  function setAliasModeOverride(
    sourceCollectionId: string,
    sourceModeId: string,
    targetCollectionId: string,
    targetModeId: string,
  ): void {
    setAliasModeOverrides((previous) => ({
      ...previous,
      [sourceCollectionId]: {
        ...previous[sourceCollectionId],
        [sourceModeId]: {
          ...previous[sourceCollectionId]?.[sourceModeId],
          [targetCollectionId]: targetModeId,
        },
      },
    }));
  }

  const selectedCollectionIds = collections
    .filter((collection) => selected.has(collection.id))
    .map((collection) => collection.id);
  const previewModes: Record<string, readonly string[]> = {};
  for (const collection of collections) {
    if (selected.has(collection.id)) {
      previewModes[collection.id] = [...modesFor(collection)];
    }
  }
  const previewOptions: ExportOptions = {
    modesByCollection: previewModes,
    aliasModeOverridesByCollectionMode: aliasModeOverrides,
    convertPxToRem,
    rootFontSize: rootFontSize > 0 ? rootFontSize : 16,
    colorFormat,
    nameStyle,
    outputFormat,
  };
  const previewRequestKey = JSON.stringify({
    collectionIds: selectedCollectionIds,
    options: previewOptions,
  });

  useEffect(() => {
    onPreview(selectedCollectionIds, previewOptions);
  }, [previewRequestKey]);

  if (collections.length === 0) {
    if (collectionsStatus === 'error') {
      return (
        <EmptyInspectState
          actionLabel="Retry"
          icon={<IconDetach48 />}
          label={collectionsError || 'Could not load variable collections.'}
          onAction={onLoadCollections}
        />
      );
    }
    return (
      <EmptyInspectState
        icon={<IconFolder24 />}
        label={busy ? 'Loading collections…' : 'No variable collections in this file.'}
      />
    );
  }

  const needle = query.trim().toLowerCase();
  const filteredCollections = needle.length === 0
    ? collections
    : collections.filter((c) => c.name.toLowerCase().includes(needle));
  const allSelected = filteredCollections.length > 0
    && filteredCollections.every((c) => selected.has(c.id));
  const bulkSelectionLabel = needle.length === 0
    ? allSelected ? 'Clear all' : 'Select all'
    : `${allSelected ? 'Clear' : 'Select'} ${filteredCollections.length} ${
      filteredCollections.length === 1 ? 'result' : 'results'
    }`;
  const selectedTokenCount = collections
    .filter((c) => selected.has(c.id))
    .reduce((sum, c) => sum + c.tokenCount, 0);
  const selectedCollections = collections.filter((collection) => selected.has(collection.id));
  const outputFileCount = selectedCollections.reduce(
    (sum, collection) => sum + modesFor(collection).size,
    0,
  );
  const previewDeclarationCount = previewFiles.reduce(
    (sum, file) => sum + file.declarationCount,
    0,
  );
  const previewWarningCount = previewFiles.reduce(
    (sum, file) => sum + file.warnings.length,
    0,
  );
  const previewIsCurrent = previewStatus === 'idle'
    && previewFiles.length === outputFileCount
    && outputFileCount > 0;

  return (
    <main aria-labelledby="tashil-sync-tokens-heading" class="sync-tokens-view">
      <div class="sync-tokens-scroll">
        <section class="sync-tokens-intro">
          <h1 id="tashil-sync-tokens-heading">Sync tokens</h1>
          <p>Select collections, modes, and a format to generate token files.</p>
        </section>

        <div class="sync-tokens-toolbar">
          <SearchTextbox
            aria-label="Search collections"
            onValueInput={setQuery}
            placeholder="Search collections"
            value={query}
          />
          <Button
            disabled={filteredCollections.length === 0}
            onClick={selectAll}
            secondary
          >
            {bulkSelectionLabel}
          </Button>
        </div>
        {selected.size > 0 ? (
          <div class="sync-tokens-selection-summary" role="status">
            <span>
              {selected.size} {selected.size === 1 ? 'collection' : 'collections'} selected
            </span>
            <Button onClick={clearAllSelections} secondary>Clear all</Button>
          </div>
        ) : null}

        <section class="sync-tokens-step">
          <h2>1. Choose collections</h2>
          {filteredCollections.length === 0 ? (
            <div class="sync-tokens-empty-result">No collections match “{query}”.</div>
          ) : (
            <div class="sync-tokens-collection-list">
              {filteredCollections.map((collection) => {
                const isSelected = selected.has(collection.id);
                return (
                  <div
                    class={`sync-tokens-collection-row${isSelected ? ' sync-tokens-row-selected' : ''}`}
                    key={collection.id}
                  >
                    <Checkbox
                      onValueChange={() => toggleCollection(collection)}
                      value={isSelected}
                    >
                      <span class="sync-tokens-collection-name">{collection.name}</span>
                      <span class="sync-tokens-count">({collection.tokenCount})</span>
                    </Checkbox>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section class="sync-tokens-step">
          <h2>2. Output files</h2>
          {selectedCollections.length === 0 ? (
            <div class="sync-tokens-output-empty">
              Select a collection to configure its output.
            </div>
          ) : (
            <div class="sync-tokens-output-panel">
              {selectedCollections.map((collection) => {
                const chosenModes = modesFor(collection);
                const includeModeSuffix = collection.modes.length > 1;
                const collectionSlug = tokenFileSlug(collection.name) || collection.id;
                return (
                  <section class="sync-tokens-output-group" key={collection.id}>
                    <div class="sync-tokens-output-heading">
                      <div>
                        <h3>{collection.name}</h3>
                        <p>Choose one or more modes to export.</p>
                      </div>
                      <span>{collection.tokenCount} variables</span>
                    </div>
                    <div class="sync-tokens-mode-list">
                      {collection.modes.map((mode) => {
                        const active = chosenModes.has(mode.modeId);
                        const modeSuffix = includeModeSuffix
                          ? `-${tokenFileSlug(mode.name)}`
                          : '';
                        const fileName = `${collectionSlug}${modeSuffix}.${tokenOutputExtension(outputFormat)}`;
                        return (
                          <div
                            class={`sync-tokens-mode-row${active ? ' sync-tokens-row-selected' : ''}`}
                            key={mode.modeId}
                          >
                            <div class="sync-tokens-mode-control">
                              <Checkbox
                                disabled={collection.modes.length === 1}
                                onValueChange={() => toggleMode(collection, mode.modeId)}
                                value={active}
                              >
                                {mode.name}
                              </Checkbox>
                            </div>
                            <span class="sync-tokens-file-name">{fileName}</span>
                            {active ? (
                              <CopyButton text={fileName} title={fileName} />
                            ) : (
                              <span aria-hidden="true" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </section>

        <section class="sync-tokens-step">
          <h2>3. Output settings</h2>
          <div class="sync-tokens-settings-panel">
            <div class="sync-tokens-unit-settings">
              <Toggle
                onValueChange={setConvertPxToRem}
                value={convertPxToRem}
              >
                Convert px to rem
              </Toggle>

              {convertPxToRem ? (
                <Field id="tashil-root-font-size" label="Root font size">
                  <div class="sync-tokens-number-input">
                    <TextboxNumeric
                      aria-label="Root font size in pixels"
                      onNumericValueInput={(value) =>
                        setRootFontSize(value === null ? 16 : value)
                      }
                      minimum={1}
                      integer
                      value={String(rootFontSize)}
                    />
                    <span>px</span>
                  </div>
                </Field>
              ) : null}
            </div>

            <div class="sync-tokens-format-settings">
              <Field id="tashil-output-format" label="Output format">
                <Dropdown
                  aria-label="Output format"
                  onValueChange={(value) => setOutputFormat(value as OutputFormat)}
                  options={[
                    { value: 'css', text: 'CSS variables' },
                    { value: 'json-flat', text: 'JSON — flat' },
                    { value: 'json-dtcg', text: 'JSON — W3C DTCG' },
                    { value: 'markdown', text: 'Markdown — raw token list' },
                    { value: 'scss', text: 'SCSS variables + map' },
                    { value: 'tailwind-theme', text: 'Tailwind theme extension' },
                  ]}
                  value={outputFormat}
                />
              </Field>
              <Field id="tashil-color-format" label="Color format">
                <SegmentedControl
                  onValueChange={(value) => setColorFormat(value as ColorFormat)}
                  options={[
                    { value: 'hex', children: 'HEX' },
                    { value: 'rgb', children: 'RGB' },
                    { value: 'rgba', children: 'RGBA' },
                    { value: 'variable', children: 'Variable' },
                  ]}
                  value={colorFormat}
                />
              </Field>

              <Field id="tashil-name-style" label="Token name">
                <div class="sync-tokens-name-style">
                  <SegmentedControl
                    onValueChange={(value) => setNameStyle(value as NameStyle)}
                    options={[
                      { value: 'default', children: 'Default' },
                      { value: 'title-slash', children: 'A/A' },
                      { value: 'lower-slash', children: 'a/a' },
                      { value: 'title-dot', children: 'A.A' },
                      { value: 'lower-dot', children: 'a.a' },
                      { value: 'title-hyphen', children: 'A-A' },
                      { value: 'lower-hyphen', children: 'a-a' },
                      { value: 'title-underscore', children: 'A_A' },
                      { value: 'lower-underscore', children: 'a_a' },
                    ]}
                    value={nameStyle}
                  />
                </div>
              </Field>
            </div>

            <div class="sync-tokens-preview">
              <div class="sync-tokens-preview-heading">
                <strong>Output preview</strong>
                <span>
                  {previewStatus === 'loading'
                    ? 'Updating from Figma variables…'
                    : 'Generated from the selected output files'}
                </span>
              </div>
              <div
                aria-label="Token output preview"
                class="sync-tokens-preview-files"
                role="region"
              >
                {selected.size === 0 ? (
                  <div class="sync-tokens-preview-empty">
                    Select a collection to preview its generated token output.
                  </div>
                ) : null}
                {selected.size > 0 && previewStatus === 'loading'
                  && previewFiles.length === 0 ? (
                    <div class="sync-tokens-preview-empty">Generating preview…</div>
                  ) : null}
                {selected.size > 0 && previewStatus === 'idle'
                  && previewFiles.length === 0 ? (
                    <div class="sync-tokens-preview-empty">
                      No exportable declarations were found for this selection.
                    </div>
                  ) : null}
                {previewStatus === 'error' ? (
                  <div class="field-error" role="alert">
                    {previewError || 'Could not preview tokens.'}
                  </div>
                ) : null}
                {previewFiles.map((file) => (
                  <section class="sync-tokens-preview-file" key={file.name}>
                    <div class="sync-tokens-preview-file-heading">
                      <strong>{file.name}</strong>
                      <span>
                        {file.sourceVariableCount} variables → {file.declarationCount} declarations
                        {file.warnings.length > 0
                          ? ` · ${file.warnings.length} warning${file.warnings.length === 1 ? '' : 's'}`
                          : ''}
                      </span>
                    </div>
                    <pre aria-label={`${file.name} preview`} tabIndex={0}>
                      <code>{boundedCssPreview(file.css)}</code>
                    </pre>
                    {file.diff ? (
                      <div class="sync-tokens-diff" role="status">
                        {`${file.diff.added} added · ${file.diff.changed} changed · ${file.diff.removed} removed · ${file.diff.unchanged} unchanged`}
                      </div>
                    ) : null}
                    {file.warnings.some((warning) =>
                      warning.code === 'mode-fallback'
                      && warning.sourceCollectionId
                      && warning.sourceModeId
                      && warning.targetCollectionId
                    ) ? (
                      <div class="sync-tokens-mode-overrides">
                        {file.warnings.map((warning, index) => {
                          if (
                            warning.code !== 'mode-fallback'
                            || warning.sourceCollectionId === undefined
                            || warning.sourceModeId === undefined
                            || warning.targetCollectionId === undefined
                          ) {
                            return null;
                          }
                          const targetCollection = collections.find(
                            (collection) => collection.id === warning.targetCollectionId,
                          );
                          if (targetCollection === undefined) {
                            return null;
                          }
                          const selectedModeId =
                            aliasModeOverrides[warning.sourceCollectionId]
                              ?.[warning.sourceModeId]
                              ?.[warning.targetCollectionId]
                            ?? warning.fallbackModeId
                            ?? targetCollection.defaultModeId;
                          return (
                            <div
                              class="sync-tokens-mode-override"
                              key={`${warning.targetCollectionId}-${index}`}
                            >
                              <div>
                                <strong>Alias mode for {targetCollection.name}</strong>
                                <span>{warning.message}</span>
                              </div>
                              <Dropdown
                                aria-label={`Alias mode for ${targetCollection.name}`}
                                onValueChange={(targetModeId) =>
                                  setAliasModeOverride(
                                    warning.sourceCollectionId as string,
                                    warning.sourceModeId as string,
                                    warning.targetCollectionId as string,
                                    targetModeId,
                                  )
                                }
                                options={targetCollection.modes.map((mode) => ({
                                  value: mode.modeId,
                                  text: mode.name,
                                }))}
                                value={selectedModeId}
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {file.warnings.some((warning) => warning.code !== 'mode-fallback') ? (
                      <ul class="sync-tokens-preview-warnings">
                        {file.warnings
                          .filter((warning) => warning.code !== 'mode-fallback')
                          .slice(0, 3)
                          .map((warning, index) => (
                          <li key={`${warning.code}-${warning.tokenName ?? index}`}>
                            {warning.tokenName ? `${warning.tokenName}: ` : ''}
                            {warning.message}
                          </li>
                        ))}
                        {file.warnings.filter((warning) =>
                          warning.code !== 'mode-fallback'
                        ).length > 3 ? (
                          <li>
                            +{file.warnings.filter((warning) =>
                              warning.code !== 'mode-fallback'
                            ).length - 3} more warnings
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </section>
                ))}
              </div>
            </div>
          </div>
        </section>

        {exportSuccess ? (
          <div class="sync-tokens-success" role="status">{exportSuccess}</div>
        ) : null}
        {exportStatus === 'error' && exportError ? (
          <div class="field-error" role="alert">{exportError}</div>
        ) : null}
        {collectionsStatus === 'error' && collectionsError ? (
          <div class="field-error" role="alert">{collectionsError}</div>
        ) : null}
      </div>

      <footer class="sync-tokens-footer">
        <div class="sync-tokens-export-summary">
          <IconCodeSnippet24 />
          <div>
            <strong>
              {outputFileCount} {outputFileCount === 1 ? 'file' : 'files'}
              {' · '}
              {selectedTokenCount} variables
              {previewIsCurrent ? ` → ${previewDeclarationCount} declarations` : ''}
            </strong>
            <span>
              {outputFileCount === 0
                ? 'Select a collection to continue'
                : previewStatus === 'loading'
                  ? 'Analyzing output'
                  : previewWarningCount > 0
                    ? `${previewWarningCount} export warning${previewWarningCount === 1 ? '' : 's'}`
                    : 'Ready to export'}
            </span>
          </div>
        </div>
        <Button
          disabled={selected.size === 0 || busy}
          loading={exportStatus === 'exporting'}
          onClick={handleExport}
        >
          {exportStatus === 'exporting'
            ? 'Exporting'
            : `Export ${outputFileCount || ''} ${outputFileCount === 1 ? 'file' : 'files'}`.replace('  ', ' ')}
        </Button>
      </footer>
    </main>
  );
}

function tokenOutputExtension(format: OutputFormat): string {
  if (format === 'markdown') return 'md';
  if (format === 'scss') return 'scss';
  if (format === 'tailwind-theme') return 'ts';
  if (format === 'json-flat' || format === 'json-dtcg') return 'json';
  return 'css';
}

function InspectCodeView(props: {
  copyMode: OutputPreferences['copyMode'];
  inspectCodeState: InspectCodeState;
  onGoToConnect: () => void;
  previewDirection: OutputPreferences['previewDirection'];
}): h.JSX.Element {
  const { inspectCodeState } = props;

  if (inspectCodeState.status === 'invalid-selection') {
    return (
      <EmptyInspectState
        icon={<IconInteractionClickSmall48 />}
        label={inspectCodeState.message || 'Select a layer to inspect it'}
      />
    );
  }

  if (inspectCodeState.status === 'not-connected') {
    return (
      <EmptyInspectState
        actionLabel="Go to Connect Component"
        icon={<IconDetach48 />}
        label="This component isn't connected"
        onAction={props.onGoToConnect}
      />
    );
  }

  if (inspectCodeState.status === 'connection-issue') {
    return (
      <EmptyInspectState
        icon={<IconDetach48 />}
        label={inspectCodeState.message || 'Stored connection needs attention'}
      />
    );
  }

  if (inspectCodeState.status === 'inspection') {
    return <InspectionView copyMode={props.copyMode} inspection={inspectCodeState.inspection} />;
  }

  if (inspectCodeState.status === 'layout') {
    return (
      <ReactLayoutView
        inspection={inspectCodeState.inspection}
        copyMode={props.copyMode}
        layout={inspectCodeState.layout}
        showUnconnectedComponents={inspectCodeState.showUnconnectedComponents}
        variantLogic={inspectCodeState.variantLogic}
      />
    );
  }

  // status === 'connected' — a single connected component.
  const output = inspectCodeState.output;
  return (
    <main aria-labelledby="tashil-inspect-code-heading" class="inspect-content">
      <h1 class="visually-hidden" id="tashil-inspect-code-heading">Inspect code</h1>
      {output.deprecation ? (
        <div class="connection-health connection-health-needs-review" role="note">
          <div class="connection-health-heading">
            <strong>⚠️ Deprecated</strong>
          </div>
          <small>{output.deprecation}</small>
        </div>
      ) : null}
      <CodeBlock
        code={output.code}
        copyText={selectCopyContent(output.code, props.copyMode)}
        direction={props.previewDirection}
        title="Code"
      />
      {output.runtimeRequirements ? (
        <CodeBlock
          code={output.runtimeRequirements}
          title="Set in application"
        />
      ) : null}
      {output.diagnostics ? (
        <CodeBlock
          code={output.diagnostics}
          title="Mapping diagnostics"
        />
      ) : null}
      {output.explanation ? (
        <CodeBlock
          code={output.explanation}
          title="Why this structure?"
        />
      ) : null}
      <ConnectionReferencesPanel references={output.references || {}} />
    </main>
  );
}

/** Full selected-tree styled-components React output. */
function ReactLayoutView(props: {
  copyMode: OutputPreferences['copyMode'];
  inspection?: FrameInspection;
  layout: ReactLayoutResult;
  showUnconnectedComponents?: boolean;
  variantLogic?: VariantLogicResult;
}): h.JSX.Element {
  const {
    inspection,
    layout,
    showUnconnectedComponents = false,
    variantLogic,
  } = props;
  const layoutCss = inspection ? formatCssBlock(inspection.css.layout) : '';
  const styleCss = inspection
    ? insertTextStyleComment(formatCssBlock(inspection.css.style), inspection.textStyleName)
    : '';
  const unconnectedComponents = showUnconnectedComponents
    ? Array.from(new Set(
        [...layout.diagnostics, ...(inspection?.diagnostics ?? [])]
          .filter((diagnostic) => diagnostic.reason === 'unconnected-instance')
          .map((diagnostic) => {
            const path = diagnostic.layerPath ?? [];
            return path[path.length - 1];
          })
          .filter((name): name is string => Boolean(name)),
      ))
    : [];

  return (
    <main aria-labelledby="tashil-inspect-code-heading" class="inspect-content">
      <h1 class="visually-hidden" id="tashil-inspect-code-heading">
        Generated React layout
      </h1>
      <AccessibilityBadges findings={inspection?.accessibility ?? []} />

      <section class="layout-card" aria-labelledby="tashil-layout-name">
        <div class="layout-card-topline">
          <div>
            <div class="eyebrow">
              {showUnconnectedComponents ? 'React frame structure' : 'React layout'}
            </div>
            <h2 class="layout-card-name" id="tashil-layout-name">{layout.nodeName}</h2>
          </div>
          <span class="layout-status-pill">{layout.nodeType}</span>
        </div>
        {unconnectedComponents.length > 0 ? (
          <div
            aria-label="Component connection status"
            class="layout-component-list"
          >
            {unconnectedComponents.map((componentName) => (
              <div class="layout-component-row" key={componentName}>
                <span class="layout-component-name">{componentName}</span>
                <span class="layout-connection-pill">Not connected</span>
              </div>
            ))}
          </div>
        ) : null}
        <div class="layout-summary-row">
          <span>Connected components</span>
          <span class="layout-summary-value">{layout.componentCount}</span>
        </div>
        <div class="layout-summary-row">
          <span>Generated wrappers</span>
          <span class="layout-summary-value">{layout.wrapperCount}</span>
        </div>
        <div class="layout-summary-row">
          <span>Unresolved components</span>
          <span class="layout-summary-value">{layout.fidelity?.unresolvedComponents ?? 0}</span>
        </div>
        <div class="layout-summary-row">
          <span>Unsupported assets</span>
          <span class="layout-summary-value">{layout.fidelity?.unsupportedAssets ?? 0}</span>
        </div>
        <div class="layout-summary-row">
          <span>Omitted declarations</span>
          <span class="layout-summary-value">{layout.fidelity?.omittedDeclarations ?? 0}</span>
        </div>
        {variantLogic ? (
          <Fragment>
            <div class="layout-summary-row">
              <span>Variant axes</span>
              <span class="layout-summary-value">{variantLogic.axisCount}</span>
            </div>
            <div class="layout-summary-row">
              <span>Valid combinations</span>
              <span class="layout-summary-value">{variantLogic.combinationCount}</span>
            </div>
          </Fragment>
        ) : null}
      </section>

      {layoutCss ? <CodeBlock code={layoutCss} title="Layout" copyLabel="Copy Layout CSS" /> : null}
      {styleCss ? <CodeBlock code={styleCss} title="Style" copyLabel="Copy Style CSS" /> : null}

      <CodeBlock
        code={layout.tsx}
        copyText={selectCopyContent(layout.tsx, props.copyMode)}
        copyLabel="Copy generated React"
        title={`${layout.componentName}.tsx`}
      />

      {variantLogic ? (
        <CodeBlock
          code={variantLogic.code}
          copyLabel="Copy variant logic"
          title="Variant logic"
        />
      ) : null}

      {(layout.runtimeRequirements?.length ?? 0) > 0 ? (
        <CodeBlock
          code={layout.runtimeRequirements?.join('\n') ?? ''}
          title="Set in application"
        />
      ) : null}

      {layout.diagnostics.length > 0 ? (
        <section class="layout-section" aria-labelledby="tashil-layout-notes-heading">
          <h3 class="layout-section-heading" id="tashil-layout-notes-heading">
            Generation notes
          </h3>
          <ul class="layout-diagnostics">
            {layout.diagnostics.map((diagnostic, index) => (
              <li
                key={index}
                class={`layout-diagnostic layout-diagnostic-${diagnostic.severity}`}
              >
                <span class="layout-diagnostic-icon" aria-hidden="true">
                  {diagnostic.severity === 'error' ? '⛔' : diagnostic.severity === 'warning' ? '⚠️' : 'ℹ️'}
                </span>
                <span class="layout-diagnostic-message">{diagnostic.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

/**
 * Dev-Mode-parity inspection view: the selected node's Layout and Style CSS
 * sections plus its connected components with copyable usage snippets.
 */
function InspectionView(props: { copyMode: OutputPreferences['copyMode']; inspection: FrameInspection }): h.JSX.Element {
  const { inspection } = props;
  const layoutCss = formatCssBlock(inspection.css.layout);
  const styleCss = insertTextStyleComment(
    formatCssBlock(inspection.css.style),
    inspection.textStyleName,
  );
  const componentCount = inspection.connectedComponents.length;

  return (
    <main aria-labelledby="tashil-inspect-code-heading" class="inspect-content">
      <h1 class="visually-hidden" id="tashil-inspect-code-heading">Inspect code</h1>
      <AccessibilityBadges findings={props.inspection.accessibility ?? []} />

      <section class="layout-card" aria-labelledby="tashil-inspection-name">
        <div class="layout-card-topline">
          <div>
            <div class="eyebrow">Inspecting</div>
            <h2 class="layout-card-name" id="tashil-inspection-name">{inspection.nodeName}</h2>
          </div>
          <span class="layout-status-pill">{inspection.nodeType}</span>
        </div>
        <div class="layout-summary-row">
          <span>Connected components</span>
          <span class="layout-summary-value">
            {componentCount === 0 ? 'None' : componentCount}
          </span>
        </div>
      </section>

      {layoutCss ? <CodeBlock code={layoutCss} title="Layout" copyLabel="Copy Layout CSS" /> : null}
      {styleCss ? <CodeBlock code={styleCss} title="Style" copyLabel="Copy Style CSS" /> : null}

      {componentCount > 0 ? (
        <section class="layout-section" aria-labelledby="tashil-inspection-components-heading">
          <h3 class="layout-section-heading" id="tashil-inspection-components-heading">
            Connected components
          </h3>
          <ul class="inspect-entries">
            {inspection.connectedComponents.map((entry) => (
              <li key={entry.nodeId} class="inspect-entry">
                <div class="inspect-entry-path">{entry.layerPath.join(' / ')}</div>
                <CodeBlock
                  code={formatUsageSnippet(entry.usage)}
                  copyText={selectCopyContent(formatUsageSnippet(entry.usage), props.copyMode)}
                  title={entry.componentName}
                  copyLabel={`Copy ${entry.componentName}`}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {inspection.diagnostics.length > 0 ? (
        <section class="layout-section" aria-labelledby="tashil-inspection-notes-heading">
          <h3 class="layout-section-heading" id="tashil-inspection-notes-heading">Notes</h3>
          <ul class="layout-diagnostics">
            {inspection.diagnostics.map((diagnostic, index) => (
              <li
                key={index}
                class={`layout-diagnostic layout-diagnostic-${diagnostic.severity}`}
              >
                <span class="layout-diagnostic-icon" aria-hidden="true">
                  {diagnostic.severity === 'error' ? '⛔' : diagnostic.severity === 'warning' ? '⚠️' : 'ℹ️'}
                </span>
                <span class="layout-diagnostic-message">{diagnostic.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

function AccessibilityBadges(props: { findings: NonNullable<FrameInspection['accessibility']> }): h.JSX.Element | null {
  if (props.findings.length === 0) return null;
  return (
    <section aria-label="Accessibility checks" class="accessibility-checks">
      <h2>Accessibility</h2>
      <div class="accessibility-badges">
        {props.findings.map((finding) => (
          <span class={`accessibility-badge accessibility-badge-${finding.status}`} key={finding.check} title={finding.message}>
            {finding.status === 'pass' ? '✓' : '⚠'} {finding.check.replace('-', ' ')}
          </span>
        ))}
      </div>
      {props.findings.filter((finding) => finding.status === 'warning').map((finding) => (
        <p key={`${finding.check}-warning`}>{finding.message}</p>
      ))}
    </section>
  );
}

function ConnectionReferencesPanel(props: {
  references: ConnectionReferences;
}): h.JSX.Element {
  const references = props.references;
  const updatedAt = formatConnectionUpdatedAt(references.updatedAt);
  const hasReferences = Boolean(
    references.storybookUrl
    || references.sourcePath
    || references.sourceUrl
    || references.updatedAt,
  );

  return (
    <section aria-labelledby="tashil-references-heading" class="reference-section">
      <h2 class="reference-section-heading" id="tashil-references-heading">References</h2>
      {hasReferences ? (
        <dl class="reference-list">
          {references.storybookUrl ? (
            <ReferenceUrlRow
              label="Storybook"
              target="storybook"
              url={references.storybookUrl}
            />
          ) : null}
          {references.sourceUrl ? (
            <ReferenceUrlRow
              label="Source URL"
              target="source"
              url={references.sourceUrl}
            />
          ) : null}
          {references.sourcePath ? (
            <div class="reference-row">
              <ReferenceIcon source="folder" />
              <div class="reference-copy">
                <dt class="reference-label">Source path</dt>
                <dd class="reference-value reference-path">{references.sourcePath}</dd>
              </div>
            </div>
          ) : null}
          {references.updatedAt ? (
            <div class="reference-row">
              <ReferenceIcon source="time" />
              <div class="reference-copy">
                <dt class="reference-label">Last updated</dt>
                <dd class="reference-value reference-date">
                  {updatedAt ? (
                    <time dateTime={updatedAt.dateTime}>{updatedAt.label}</time>
                  ) : (
                    'Not available'
                  )}
                </dd>
              </div>
            </div>
          ) : null}
        </dl>
      ) : (
        <p class="reference-empty">No references saved.</p>
      )}
    </section>
  );
}

function ReferenceUrlRow(props: {
  label: string;
  target: 'source' | 'storybook';
  url: string;
}): h.JSX.Element {
  const url = normalizeHttpUrl(props.url);

  return (
    <div class="reference-row">
      <ReferenceIcon source={props.target} />
      <div class="reference-copy">
        <dt class="reference-label">{props.label}</dt>
        <dd class="reference-value">
          <span class="reference-url">{props.url}</span>
          {!url ? (
            <span class="reference-warning">
              This saved URL is not a valid HTTP(S) address. Update it in Connect Component.
            </span>
          ) : null}
        </dd>
      </div>
      {url ? (
        <button
          aria-label={`Open ${props.label} in browser`}
          class="reference-open-button"
          onClick={() => {
            emit<OpenExternalHandler>('OPEN_EXTERNAL', {
              target: props.target,
              url,
            });
          }}
          title={`Open ${props.label} in browser`}
          type="button"
        >
          <IconNewTab24 />
        </button>
      ) : null}
    </div>
  );
}

function ReferenceIcon(props: {
  source: 'folder' | 'source' | 'storybook' | 'time';
}): h.JSX.Element {
  if (props.source === 'folder') {
    return <span aria-hidden="true" class="reference-icon"><IconFolder24 /></span>;
  }
  if (props.source === 'time') {
    return <span aria-hidden="true" class="reference-icon"><IconTimeSmall24 /></span>;
  }

  return (
    <span
      aria-hidden="true"
      class={`reference-icon reference-icon-${props.source}`}
    >
      <img alt="" src={REFERENCE_ICONS[props.source]} />
    </span>
  );
}

function EmptyInspectState(props: {
  actionLabel?: string;
  icon: h.JSX.Element;
  label: string;
  onAction?: () => void;
}): h.JSX.Element {
  return (
    <main class="inspect-empty">
      <div aria-hidden="true" class="inspect-empty-icon">
        {props.icon}
      </div>
      <h1 class="inspect-empty-label">{props.label}</h1>
      {props.actionLabel && props.onAction ? (
        <Button onClick={props.onAction}>
          {props.actionLabel}
        </Button>
      ) : null}
    </main>
  );
}


function CodeBlock(props: {
  code: string;
  copyText?: string;
  direction?: OutputPreferences['previewDirection'];
  title: string;
  /** Label for the copy button; defaults to the title. */
  copyLabel?: string;
  /** Optional explicit region label (defaults to `${title} code, horizontally scrollable`). */
  regionLabel?: string;
}): h.JSX.Element {
  const lines = props.code.length > 0 ? props.code.split('\n') : [''];
  const headingId = props.title === 'Code'
    ? 'tashil-generated-code-heading'
    : props.title === 'Mapping diagnostics'
      ? 'tashil-mapping-diagnostics-heading'
      : `tashil-code-heading-${props.title.toLowerCase()}`;
  const regionLabel = props.regionLabel
    ?? (props.title === 'Code'
      ? 'Generated TSX code, horizontally scrollable'
      : props.title === 'Mapping diagnostics'
        ? 'Prop mapping diagnostics, horizontally scrollable'
        : `${props.title} code, horizontally scrollable`);
  const copyLabel = props.copyLabel ?? props.title;

  return (
    <section class="code-section">
      <div class="code-section-header">
        <h2 class="code-section-heading" id={headingId}>{props.title}</h2>
        <CopyButton text={props.copyText ?? props.code} title={copyLabel} />
      </div>
      <pre aria-label={regionLabel} class="code-block" dir={props.direction} role="region" tabIndex={0}>
        <code>
          {lines.map((line, index) => (
            <span class="code-line" key={`${props.title}-${index}`}>
              <span aria-hidden="true" class="code-line-number">{index + 1}</span>
              <span class="code-line-content">{renderCodeLine(line)}</span>
            </span>
          ))}
        </code>
      </pre>
    </section>
  );
}

function CopyButton(props: { text: string; title: string }): h.JSX.Element {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const resetCopyStatusTimerRef = useRef<number>();
  const copyFeedback = getCopyFeedback(copyStatus, props.title);

  useEffect(() => () => {
    if (resetCopyStatusTimerRef.current !== undefined) {
      window.clearTimeout(resetCopyStatusTimerRef.current);
    }
  }, []);

  async function handleCopy(): Promise<void> {
    if (resetCopyStatusTimerRef.current !== undefined) {
      window.clearTimeout(resetCopyStatusTimerRef.current);
    }

    try {
      await copyToClipboard(props.text);
      setCopyStatus('copied');
    } catch (_error) {
      setCopyStatus('error');
    }

    resetCopyStatusTimerRef.current = window.setTimeout(() => {
      setCopyStatus('idle');
    }, 3000);
  }

  return (
    <Fragment>
      <IconButton
        aria-label={copyFeedback.ariaLabel}
        onClick={() => {
          void handleCopy();
        }}
        title={copyFeedback.ariaLabel}
      >
        {copyStatus === 'copied' ? <IconCheck24 /> : <IconCopySmall24 />}
      </IconButton>
      <span aria-atomic="true" aria-live="polite" class="visually-hidden" role="status">
        {copyFeedback.message}
      </span>
    </Fragment>
  );
}

function renderCodeLine(line: string): Array<h.JSX.Element | string> | string {
  if (line.length === 0) {
    return ' ';
  }

  // Tokenize braces separately so JSX nested inside a prop expression keeps its
  // own tag, attribute, and string colors instead of becoming one expression.
  const tokens = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|default|export|from|function|import|let|return|var)\b|<\/?[A-Z][A-Za-z0-9.:-]*(?=[\s>/])|[A-Za-z_$][A-Za-z0-9_$-]*(?=\s*=)|[{}]|\/?>)/g;
  const parts: Array<h.JSX.Element | string> = [];
  const expressionContainsJsx: boolean[] = [];
  let cursor = 0;
  let match = tokens.exec(line);

  while (match !== null) {
    const token = match[0];

    if (match.index > cursor) {
      parts.push(line.slice(cursor, match.index));
    }

    if (/^<\/?[A-Z]/.test(token) && expressionContainsJsx.length > 0) {
      expressionContainsJsx[expressionContainsJsx.length - 1] = true;
    }

    const isScalarExpressionValue = expressionContainsJsx.length > 0
      && !expressionContainsJsx[expressionContainsJsx.length - 1];

    parts.push(
      <span
        class={getSyntaxClassName(token, isScalarExpressionValue)}
        key={`${match.index}-${token}`}
      >
        {token}
      </span>
    );

    if (token === '{') {
      expressionContainsJsx.push(false);
    } else if (token === '}') {
      expressionContainsJsx.pop();
    }

    cursor = match.index + token.length;
    match = tokens.exec(line);
  }

  if (cursor < line.length) {
    parts.push(line.slice(cursor));
  }

  return parts;
}

function getSyntaxClassName(token: string, isScalarExpressionValue = false): string {
  if (isScalarExpressionValue && /^["'`]/.test(token)) {
    return 'syntax-expression';
  }
  if (/^["'`]/.test(token)) {
    return 'syntax-string';
  }
  if (/^(const|default|export|from|function|import|let|return|var)$/.test(token)) {
    return 'syntax-keyword';
  }
  if (/^<\/?[A-Z]/.test(token)) {
    return 'syntax-tag';
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(token)) {
    return 'syntax-attribute';
  }
  if (/^[{}]$/.test(token)) {
    return 'syntax-expression';
  }
  return 'syntax-punctuation';
}

function HowItWorksView(): h.JSX.Element {
  return (
    <main aria-labelledby="tashil-help-heading" class="help-page">
      <Container space="medium">
        <VerticalSpace space="medium" />
        <div class="section-heading">
          <h1 class="page-heading" id="tashil-help-heading" tabIndex={-1}>Workflow</h1>
          <Text>Use setup in Design mode, then copy generated code in Dev Mode.</Text>
        </div>
        <VerticalSpace space="medium" />
        <Stack space="large">
          <HelpSection title="What this plugin does">
            <Text>
              Tashil Code connects a Figma main component or component set to Storybook/source metadata.
              After saving the connection, developers can select an instance in Dev Mode and copy the
              generated Tashil UI usage snippet from the Code panel.
            </Text>
          </HelpSection>

          <HelpSection title="Connect a component">
            <ol class="help-list">
              <li>Select a main component, component set, or component instance in Figma.</li>
              <li>Open Plugins, Tashil Code, Connect component.</li>
              <li>Confirm the Figma name, then enter the Source component name and Import path.</li>
              <li>Add optional Storybook and source references.</li>
              <li>Upload the component's .ts/.tsx source files.</li>
              <li>Connect each code prop and value to its matching Figma property and variant.</li>
              <li>Click Save. The data is stored on the selected main component as shared plugin data.</li>
            </ol>
          </HelpSection>

          <HelpSection title="Use it in Dev Mode">
            <ol class="help-list">
              <li>Switch to Dev Mode and select a connected component instance.</li>
              <li>Open the Code section and choose Tashil UI.</li>
              <li>Copy the generated TSX, open reference links, and copy the source path.</li>
            </ol>
          </HelpSection>

          <HelpSection title="Connection fields">
            <div class="help-table">
              <HelpRow label="Figma component name" value="Selected design component used as the connection reference." />
              <HelpRow label="Source component name" value="React component export used in generated code, for example Button." />
              <HelpRow label="Import path" value="Package import path, for example tashil-ui." />
              <HelpRow label="Storybook URL" value="The matching Storybook story or docs page." />
              <HelpRow label="Source path" value="The source file path for developer reference." />
              <HelpRow label="Source URL" value="An optional browser link to the source file." />
              <HelpRow label="Source & prop mappings" value="Upload TypeScript and visually connect code props to Figma properties." />
              <HelpRow label="Connection health" value="Re-upload source and review Figma changes before confirming updates." />
              <HelpRow label="Custom mappings" value="Optional wildcard/raw JSON for cases the visual rows cannot represent." />
            </div>
          </HelpSection>

          <HelpSection title="Keep a connection up to date">
            <Text>
              The plugin compares the current Figma component with the saved snapshot. Re-upload
              source after code changes. Review additions, renames, removals, and type changes;
              stale mappings remain visible until you explicitly remove them and save. Healthy,
              Needs review, Broken, and Source refresh required describe the current state.
            </Text>
          </HelpSection>
        </Stack>
        <VerticalSpace space="medium" />
      </Container>
    </main>
  );
}

function HelpSection(props: { children: h.JSX.Element | h.JSX.Element[]; title: string }): h.JSX.Element {
  return (
    <section class="help-section">
      <Stack space="small">
        <h2 class="help-section-heading">{props.title}</h2>
        {props.children}
      </Stack>
    </section>
  );
}

function HelpRow(props: { label: string; value: string }): h.JSX.Element {
  return (
    <div class="help-row">
      <Text>{props.label}</Text>
      <Text>{props.value}</Text>
    </div>
  );
}

function Field(props: {
  children: h.JSX.Element;
  error?: string;
  id: string;
  label: string;
}): h.JSX.Element {
  return (
    <div class="field">
      <label class="field-label" htmlFor={props.id}>
        {props.label}
      </label>
      {props.children}
      {props.error ? (
        <div class="field-error" id={`${props.id}-error`}>
          {props.error}
        </div>
      ) : null}
    </div>
  );
}

function getFieldErrorId(field: FormField, errors: FormErrors): string | undefined {
  return errors[field] ? `${FORM_FIELD_IDS[field]}-error` : undefined;
}

export default render(Plugin);
