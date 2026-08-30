import {
  Button,
  Container,
  IconButton,
  IconBackwardSmall24,
  IconHelp16,
  render,
  useWindowResize,
} from '@create-figma-plugin/ui';
import { emit } from '@create-figma-plugin/utilities';
import { Fragment, h } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import '!./ui.css';
import { useConnectionController } from './ui-controller';
import {
  type ResizeWindowHandler,
} from './types';
import {
  ConnectComponentView,
  ComponentInventoryView,
  StorybookGenerator,
} from './views/ConnectView';
import { InspectCodeView } from './views/InspectView';
import { SyncTokensView } from './views/SyncTokensView';
import { DocumentationView } from './views/DocsView';
import { OutputSettingsView } from './views/SettingsView';
import { HowItWorksView } from './views/HowItWorksView';

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
    docStyleSources,
    docStyleSourcesStatus,
    tokensExportStatus,
    tokensExportError,
    tokensExportSuccess,
    tokensPreviewStatus,
    tokensPreviewError,
    tokensPreviewFiles,
    loadTokenCollections,
    loadDocStyleSources,
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
    generateStyleDocs,
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
            styleSources={docStyleSources}
            styleSourcesStatus={docStyleSourcesStatus}
            onCancelDocGeneration={cancelDocGeneration}
            onGenerateComponentDocs={generateComponentDocs}
            onGenerateTokenDocs={generateTokenDocs}
            onGenerateStyleDocs={generateStyleDocs}
            onRefreshComponents={() => rescanComponents(false)}
            onLoadTokenCollections={loadTokenCollections}
            onLoadStyleSources={loadDocStyleSources}
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

export default render(Plugin);
