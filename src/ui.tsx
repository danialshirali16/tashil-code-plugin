import {
  Button,
  Checkbox,
  Container,
  Dropdown,
  IconBackwardSmall24,
  IconCheck24,
  IconButton,
  IconCodeSnippet24,
  IconCopySmall24,
  IconFolder24,
  IconHelp16,
  IconNewTab24,
  IconTimeSmall24,
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
import { SemanticMappingView } from './semantic-editor-view';
import { SEMANTIC_CONNECT_AUTHORING_ENABLED } from './semantic/flags';
import type {
  ReconciliationAction,
  ReconciliationProposal,
} from './semantic/reconcile';
import type { SemanticConnectionRecipe } from './semantic/types';
import { copyToClipboard } from './ui-clipboard';
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
  TokenCollectionSummary,
} from './sync-tokens/types';
import { formatCssBlock } from './inspect/css-partition';
import { formatUsageSnippet } from './inspect/usage-snippet';
import type { FrameInspection } from './inspect/types';
import type { ReactLayoutResult } from './layout/types';

const REFERENCE_ICONS = {
  source: 'data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgdmlld0JveD0iMCAwIDE2IDE2IiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8ZyBpZD0iR3JvdXAgMSI+CjxwYXRoIGlkPSJWZWN0b3IiIGQ9Ik0wLjMzNDQ5MiA4LjgwNzU1Qy0wLjExMTQ5NyA4LjM2MTU1IC0wLjExMTQ5NyA3LjYzODQ2IDAuMzM0NDkyIDcuMTkyNDZMNy4xOTI0NiAwLjMzNDQ5MkM3LjYzODQ2IC0wLjExMTQ5NyA4LjM2MTU1IC0wLjExMTQ5NyA4LjgwNzU1IDAuMzM0NDkyTDE1LjY2NTUgNy4xOTI0NkMxNi4xMTE1IDcuNjM4NDYgMTYuMTExNSA4LjM2MTU1IDE1LjY2NTUgOC44MDc1NUw4LjgwNzU1IDE1LjY2NTVDOC4zNjE1NSAxNi4xMTE1IDcuNjM4NDYgMTYuMTExNSA3LjE5MjQ2IDE1LjY2NTVMMC4zMzQ0OTIgOC44MDc1NVoiIGZpbGw9IiNFRTUxM0IiLz4KPHBhdGggaWQ9IlZlY3Rvcl8yIiBkPSJNNS43OTk0NCAxLjc0OTQzTDUuMTA0OTggMi40NDM5MUw2Ljg5ODY0IDQuMjM3NTdDNi44MjYwNyA0LjM5MzI0IDYuNzg1NTUgNC41NjY4NiA2Ljc4NTU1IDQuNzQ5OTRDNi43ODU1NSA1LjI2OTcxIDcuMTEyMTIgNS43MTMxOSA3LjU3MTI3IDUuODg2MzlWMTAuMjc0MkM3LjExMjEyIDEwLjQ0NzQgNi43ODU1NSAxMC44OTA5IDYuNzg1NTUgMTEuNDEwNkM2Ljc4NTU1IDEyLjA4MTMgNy4zMjkyMSAxMi42MjQ5IDcuOTk5ODQgMTIuNjI0OUM4LjY3MDQ3IDEyLjYyNDkgOS4yMTQxMyAxMi4wODEzIDkuMjE0MTMgMTEuNDEwNkM5LjIxNDEzIDEwLjkzOTQgOC45NDU3MyAxMC41MzA5IDguNTUzNDQgMTAuMzI5NlY1Ljg5MjM5TDEwLjI2OCA3LjYwNjk3QzEwLjE5OSA3Ljc1OTQ4IDEwLjE2MDYgNy45Mjg4IDEwLjE2MDYgOC4xMDcwOEMxMC4xNjA2IDguNzc3NzEgMTAuNzA0MiA5LjMyMTM3IDExLjM3NDkgOS4zMjEzN0MxMi4wNDU1IDkuMzIxMzcgMTIuNTg5MiA4Ljc3NzcxIDEyLjU4OTIgOC4xMDcwOEMxMi41ODkyIDcuNDM2NDUgMTIuMDQ1NSA2Ljg5Mjc5IDExLjM3NDkgNi44OTI3OUMxMS4yNDQ1IDYuODkyNzkgMTEuMTE5IDYuOTEzMzEgMTEuMDAxMyA2Ljk1MTMxTDkuMTU5OSA1LjEwOTg4QzkuMTk1MTUgNC45OTYxNiA5LjIxNDEzIDQuODc1MjUgOS4yMTQxMyA0Ljc0OTk0QzkuMjE0MTMgNC4wNzkyOSA4LjY3MDQ3IDMuNTM1NjQgNy45OTk4NCAzLjUzNTY0QzcuODc0NTIgMy41MzU2NCA3Ljc1MzY3IDMuNTU0NjMgNy42Mzk5IDMuNTg5ODhMNS43OTk0NCAxLjc0OTQzWiIgZmlsbD0id2hpdGUiLz4KPC9nPgo8L3N2Zz4=',
  storybook: 'data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgdmlld0JveD0iMCAwIDEyLjA3MzcgMTUuMDQyNSIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGcgaWQ9Ikdyb3VwIj4KPHBhdGggaWQ9IlZlY3RvciIgZD0iTTAuNDY2NTk1IDEzLjg2MTFMMC4wMDA2MTA2OTYgMS40NDQ3NUMtMC4wMTQ3Nzg5IDEuMDM0NjggMC4yOTk2NDMgMC42ODcxNTcgMC43MDkxOTcgMC42NjE1NkwxMS4yNzAyIDAuMDAxNDk4NDlDMTEuNjg3MSAtMC4wMjQ1NTYzIDEyLjA0NjEgMC4yOTIyNjcgMTIuMDcyMiAwLjcwOTE0NEMxMi4wNzMyIDAuNzI0ODUgMTIuMDczNyAwLjc0MDU4MyAxMi4wNzM3IDAuNzU2MzJWMTQuMjg2MUMxMi4wNzM3IDE0LjcwMzggMTEuNzM1MSAxNS4wNDI0IDExLjMxNzQgMTUuMDQyNEMxMS4zMDYgMTUuMDQyNCAxMS4yOTQ3IDE1LjA0MjIgMTEuMjgzNCAxNS4wNDE3TDEuMTg4NDIgMTQuNTg4M0MwLjc5NTI2MyAxNC41NzA2IDAuNDgxMzU0IDE0LjI1NDQgMC40NjY1OTUgMTMuODYxMVoiIGZpbGw9IiNGRjQ3ODUiLz4KPGcgaWQ9Ik1hc2sgZ3JvdXAiPgo8bWFzayBpZD0ibWFzazBfMF80IiBzdHlsZT0ibWFzay10eXBlOmx1bWluYW5jZSIgbWFza1VuaXRzPSJ1c2VyU3BhY2VPblVzZSIgeD0iMCIgeT0iMCIgd2lkdGg9IjEzIiBoZWlnaHQ9IjE2Ij4KPGcgaWQ9Ikdyb3VwXzIiPgo8cGF0aCBpZD0iVmVjdG9yXzIiIGQ9Ik0wLjQ2NjU5NSAxMy44NjExTDAuMDAwNjEwNjk2IDEuNDQ0NzVDLTAuMDE0Nzc4OSAxLjAzNDY4IDAuMjk5NjQzIDAuNjg3MTU3IDAuNzA5MTk3IDAuNjYxNTZMMTEuMjcwMiAwLjAwMTQ5ODQ5QzExLjY4NzEgLTAuMDI0NTU2MyAxMi4wNDYxIDAuMjkyMjY3IDEyLjA3MjIgMC43MDkxNDRDMTIuMDczMiAwLjcyNDg1IDEyLjA3MzcgMC43NDA1ODMgMTIuMDczNyAwLjc1NjMyVjE0LjI4NjFDMTIuMDczNyAxNC43MDM4IDExLjczNTEgMTUuMDQyNCAxMS4zMTc0IDE1LjA0MjRDMTEuMzA2IDE1LjA0MjQgMTEuMjk0NyAxNS4wNDIyIDExLjI4MzQgMTUuMDQxN0wxLjE4ODQyIDE0LjU4ODNDMC43OTUyNjMgMTQuNTcwNiAwLjQ4MTM1NCAxNC4yNTQ0IDAuNDY2NTk1IDEzLjg2MTFaIiBmaWxsPSJ3aGl0ZSIvPgo8L2c+CjwvbWFzaz4KPGcgbWFzaz0idXJsKCNtYXNrMF8wXzQpIj4KPHBhdGggaWQ9IlZlY3Rvcl8zIiBkPSJNOC45MTU1MSAxLjg0ODk2TDguOTg3NjUgMC4xMTM5NTlMMTAuNDM4IDMuMTc4NzVlLTA2TDEwLjUwMDUgMS43ODkyNUMxMC41MDI2IDEuODUxNTIgMTAuNDUzOSAxLjkwMzc2IDEwLjM5MTcgMS45MDU5NEMxMC4zNjUgMS45MDY4NyAxMC4zMzg5IDEuODk4MzIgMTAuMzE3OSAxLjg4MTgxTDkuNzU4NjEgMS40NDEyMUw5LjA5NjQyIDEuOTQzNTNDOS4wNDY3NyAxLjk4MTE5IDguOTc2IDEuOTcxNDcgOC45MzgzNSAxLjkyMTgzQzguOTIyNSAxLjkwMDkzIDguOTE0NDIgMS44NzUxNiA4LjkxNTUxIDEuODQ4OTZaTTcuMDYwNjYgNS42Njk3MUM3LjA2MDY2IDUuOTYzOTUgOS4wNDI2NCA1LjgyMjkyIDkuMzA4NzEgNS42MTYyNEM5LjMwODcxIDMuNjEyNTIgOC4yMzM1NiAyLjU1OTU5IDYuMjY0NzcgMi41NTk1OUM0LjI5NTk5IDIuNTU5NTkgMy4xOTI5MSAzLjYyODkgMy4xOTI5MSA1LjIzMjg2QzMuMTkyOTEgOC4wMjY0MyA2Ljk2MjkyIDguMDc5ODkgNi45NjI5MiA5LjYwMzY1QzYuOTYyOTIgMTAuMDMxNCA2Ljc1MzQ4IDEwLjI4NTMgNi4yOTI3IDEwLjI4NTNDNS42OTIyOSAxMC4yODUzIDUuNDU0OTIgOS45Nzg3MSA1LjQ4Mjg1IDguOTM2MTNDNS40ODI4NSA4LjcwOTk2IDMuMTkyOTEgOC42Mzk0NSAzLjEyMzEgOC45MzYxM0MyLjk0NTMyIDExLjQ2MjcgNC41MTk0IDEyLjE5MTQgNi4zMjA2MyAxMi4xOTE0QzguMDY2IDEyLjE5MTQgOS40MzQzNyAxMS4yNjExIDkuNDM0MzcgOS41NzY5MkM5LjQzNDM3IDYuNTgyODYgNS42MDg1MSA2LjY2MzA2IDUuNjA4NTEgNS4xNzkzOUM1LjYwODUxIDQuNTc3OTEgNi4wNTUzMyA0LjQ5NzcxIDYuMzIwNjMgNC40OTc3MUM2LjU5OTg5IDQuNDk3NzEgNy4xMDI1NSA0LjU0NjkzIDcuMDYwNjYgNS42Njk3MVoiIGZpbGw9IndoaXRlIi8+CjwvZz4KPC9nPgo8L2c+Cjwvc3ZnPgo=',
} as const;

export function Plugin(): h.JSX.Element {
  const [view, setView] = useState<'connect' | 'help'>('connect');
  const [workflowTab, setWorkflowTab] = useState<'connect' | 'generate' | 'sync-tokens'>('connect');
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
    isSourceReplacementPending,
    sourceReplacementCancelRef,
    confirmSourceReplacement,
    cancelSourceReplacement,
    setCustomPropMappings,
    setFormField,
    setMappedProperty,
    setMappedValue,
    setSemanticOption,
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
    const tabs: Array<'connect' | 'generate' | 'sync-tokens'> = ['connect', 'generate', 'sync-tokens'];
    const tabIds: Record<typeof workflowTab, string> = {
      connect: 'tashil-tab-connect',
      generate: 'tashil-tab-generate',
      'sync-tokens': 'tashil-tab-sync-tokens',
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
              <ConnectComponentView
            componentName={formValues.componentName}
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
            isClearConfirmationOpen={isClearConfirmationOpen}
            isDirty={isDirty}
            isReady={isReady}
            isSourceUploading={isSourceUploading}
            pendingOperation={activePendingOperation}
            mappingDocument={formValues.mappingDocument}
            propMappings={formValues.propMappings}
            targetState={targetState}
            setCustomPropMappings={setCustomPropMappings}
            setComponentName={(value) => setFormField('componentName', value)}
            setImportPath={(value) => setFormField('importPath', value)}
            setMappedProperty={setMappedProperty}
            setMappedValue={setMappedValue}
            semanticRecipe={semanticRecipe}
            semanticProposals={semanticProposals}
            applySemanticProposal={applySemanticProposal}
            exportDebugBundle={exportDebugBundle}
            isSourceReplacementPending={isSourceReplacementPending}
            sourceReplacementCancelRef={(element) => {
              sourceReplacementCancelRef.current = element;
            }}
            confirmSourceReplacement={confirmSourceReplacement}
            cancelSourceReplacement={cancelSourceReplacement}
            setSemanticOption={setSemanticOption}
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
              onFilterChange={setInventoryFilter}
              onHideDotPrefixedChange={setHideDotPrefixedComponents}
              onOpenTarget={handleOpenInventoryTarget}
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
            inspectCodeState={inspectCodeState}
            onGoToConnect={() => setWorkflowTab('connect')}
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
      {view === 'help' ? (
        <HowItWorksView />
      ) : null}
      <div aria-hidden="true" class="resize-corner" />
    </div>
  );
}

type InventoryFilter = 'all' | 'not-connected' | 'connected';

function ComponentInventoryView(props: {
  filter: InventoryFilter;
  hideDotPrefixed: boolean;
  inventoryState: ComponentInventoryState;
  onFilterChange: (filter: InventoryFilter) => void;
  onHideDotPrefixedChange: (hide: boolean) => void;
  onOpenTarget: (targetToken: string) => void;
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
        onAction={props.onRescan}
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
          <Button onClick={props.onRescan} secondary>Rescan</Button>
        </div>

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
  handleCancelClear: () => void;
  handleClear: () => void;
  handleSave: () => void;
  handleScaffold: () => void;
  importPath: string;
  isClearConfirmationOpen: boolean;
  isDirty: boolean;
  isReady: boolean;
  isSourceUploading: boolean;
  mappingDocument: string;
  pendingOperation?: PendingMutation['operation'];
  propMappings: string;
  targetState: UiTargetState;
  setCustomPropMappings: (value: string) => void;
  setComponentName: (value: string) => void;
  setImportPath: (value: string) => void;
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
  isSourceReplacementPending: boolean;
  sourceReplacementCancelRef: (element: HTMLButtonElement | null) => void;
  confirmSourceReplacement: () => void;
  cancelSourceReplacement: () => void;
  setSemanticOption: (
    targetPath: readonly string[],
    optionId: string,
    staticValue?: string | number | boolean,
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
              error={props.fieldErrors.componentName}
              id={FORM_FIELD_IDS.componentName}
              label="Component name"
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
              Also selects the props interface read from uploaded source
              (<code>Button</code> → <code>ButtonProps</code>).
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
                onApplyProposal={props.applySemanticProposal}
                onExportDebugBundle={props.exportDebugBundle}
                onFilesSelected={(files) => { void props.uploadSourceFiles(files); }}
                onOptionChange={props.setSemanticOption}
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
  const [nameStyle, setNameStyle] = useState<NameStyle>('kebab');
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
          <p>Select collections and choose modes to generate CSS files.</p>
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
                        const fileName = `${collectionSlug}${modeSuffix}.css`;
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
                <SegmentedControl
                  onValueChange={(value) => setNameStyle(value as NameStyle)}
                  options={[
                    { value: 'kebab', children: 'kebab' },
                    { value: 'slash', children: 'slash' },
                    { value: 'dot', children: 'dot' },
                    { value: 'snake', children: 'snake' },
                    { value: 'pascal', children: 'pascal' },
                  ]}
                  value={nameStyle}
                />
              </Field>
            </div>

            <div class="sync-tokens-preview">
              <div class="sync-tokens-preview-heading">
                <strong>CSS preview</strong>
                <span>
                  {previewStatus === 'loading'
                    ? 'Updating from Figma variables…'
                    : 'Generated from the selected output files'}
                </span>
              </div>
              <div
                aria-label="CSS token preview"
                class="sync-tokens-preview-files"
                role="region"
              >
                {selected.size === 0 ? (
                  <div class="sync-tokens-preview-empty">
                    Select a collection to preview its generated CSS.
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
                    <pre aria-label={`${file.name} CSS preview`} tabIndex={0}>
                      <code>{boundedCssPreview(file.css)}</code>
                    </pre>
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
            : `Export ${outputFileCount || ''} CSS ${outputFileCount === 1 ? 'file' : 'files'}`.replace('  ', ' ')}
        </Button>
      </footer>
    </main>
  );
}

function InspectCodeView(props: {
  inspectCodeState: InspectCodeState;
  onGoToConnect: () => void;
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
    return <InspectionView inspection={inspectCodeState.inspection} />;
  }

  if (inspectCodeState.status === 'layout') {
    return <ReactLayoutView layout={inspectCodeState.layout} />;
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
function ReactLayoutView(props: { layout: ReactLayoutResult }): h.JSX.Element {
  const { layout } = props;

  return (
    <main aria-labelledby="tashil-inspect-code-heading" class="inspect-content">
      <h1 class="visually-hidden" id="tashil-inspect-code-heading">
        Generated React layout
      </h1>

      <section class="layout-card" aria-labelledby="tashil-layout-name">
        <div class="layout-card-topline">
          <div>
            <div class="eyebrow">React layout</div>
            <h2 class="layout-card-name" id="tashil-layout-name">{layout.nodeName}</h2>
          </div>
          <span class="layout-status-pill">{layout.nodeType}</span>
        </div>
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
      </section>

      <CodeBlock
        code={layout.tsx}
        copyLabel="Copy generated React"
        title={`${layout.componentName}.tsx`}
      />

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
function InspectionView(props: { inspection: FrameInspection }): h.JSX.Element {
  const { inspection } = props;
  const layoutCss = formatCssBlock(inspection.css.layout);
  const styleCss = formatCssBlock(inspection.css.style);
  const componentCount = inspection.connectedComponents.length;

  return (
    <main aria-labelledby="tashil-inspect-code-heading" class="inspect-content">
      <h1 class="visually-hidden" id="tashil-inspect-code-heading">Inspect code</h1>

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

function IconInteractionClickSmall48(): h.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="48"
      viewBox="0 0 48 48"
      width="48"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        clip-rule="evenodd"
        d="M22.5859 22.586C23.1403 22.0315 23.9679 21.8519 24.7021 22.127L36.7021 26.627C37.5217 26.9343 38.0465 27.7394 37.997 28.6133C37.9471 29.4872 37.3344 30.2281 36.4853 30.4404L31.6494 31.6494L30.4404 36.4854C30.2278 37.3344 29.4871 37.9473 28.6132 37.9971C27.7396 38.0464 26.9343 37.5215 26.6269 36.7022L22.1269 24.7022C21.8518 23.9681 22.0317 23.1404 22.5859 22.586ZM28.4999 36L29.9999 30L35.9999 28.5L23.9999 24L28.4999 36Z"
        fill="currentColor"
        fill-rule="evenodd"
      />
      <path d="M19.6552 31.876C19.8588 31.3844 20.4422 31.1846 20.9335 31.3887C21.4246 31.5927 21.7062 32.1494 21.5029 32.6406L19.9492 36.3936C19.7376 36.9033 19.1525 37.1457 18.6425 36.9346C18.1325 36.7233 17.8905 36.1381 18.1015 35.6279L19.6552 31.876Z" fill="currentColor" />
      <path d="M15.3574 26.4961C15.849 26.2924 16.4072 26.574 16.6113 27.0654C16.8151 27.5567 16.6152 28.1401 16.124 28.3438L12.372 29.8985C11.8619 30.1095 11.2768 29.8674 11.0654 29.3574C10.8543 28.8475 11.0966 28.2623 11.6064 28.0508L15.3574 26.4961Z" fill="currentColor" />
      <path d="M11.0654 18.6426C11.2767 18.1324 11.8618 17.8904 12.372 18.1016L16.123 19.6553C16.6146 19.8589 16.8143 20.4421 16.6103 20.9336C16.4062 21.4247 15.8497 21.7063 15.3583 21.5029L11.6064 19.9492C11.0967 19.7378 10.8545 19.1525 11.0654 18.6426Z" fill="currentColor" />
      <path d="M35.6279 18.1016C36.1381 17.8903 36.7232 18.1324 36.9345 18.6426C37.1455 19.1526 36.9034 19.7378 36.3935 19.9492L32.6406 21.5029C32.1495 21.7058 31.5926 21.4243 31.3886 20.9336C31.1847 20.4421 31.3844 19.8581 31.8759 19.6543L35.6279 18.1016Z" fill="currentColor" />
      <path d="M18.6425 11.0654C19.1527 10.8543 19.7378 11.0973 19.9492 11.6074L21.5029 15.3584C21.7061 15.8496 21.4244 16.4063 20.9335 16.6104C20.4425 16.8142 19.8589 16.6151 19.6552 16.124L18.1015 12.3721C17.8903 11.8621 18.1327 11.277 18.6425 11.0654Z" fill="currentColor" />
      <path d="M28.0507 11.6074C28.262 11.0973 28.8472 10.8544 29.3574 11.0654C29.8676 11.2768 30.1096 11.8619 29.8984 12.3721L28.3437 16.124C28.1399 16.615 27.5572 16.8146 27.0664 16.6104C26.5755 16.406 26.2939 15.8487 26.497 15.3574L28.0507 11.6074Z" fill="currentColor" />
    </svg>
  );
}

function IconDetach48(): h.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="48"
      viewBox="0 0 48 48"
      width="48"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M24.7062 32.2927C25.0968 32.6833 25.0968 33.3164 24.7062 33.707L21.7066 36.7066C18.8308 39.5822 14.1684 39.5829 11.2926 36.7073C8.41694 33.8316 8.41703 29.1685 11.2926 26.2927L14.2923 23.293C14.6828 22.9025 15.316 22.9025 15.7065 23.293C16.097 23.6835 16.097 24.3167 15.7065 24.7072L12.7068 27.7069C10.6123 29.8017 10.6122 33.1984 12.7068 35.2931C14.8015 37.3876 18.1976 37.3869 20.2923 35.2924L23.292 32.2927C23.6824 31.9023 24.3157 31.9025 24.7062 32.2927Z" fill="currentColor" />
      <path d="M11.9997 15.4996C12.552 15.4996 13.0003 15.9479 13.0003 16.5002C13.0001 17.0522 12.5524 17.4999 12.0004 17.5001H7.49951C6.94755 17.4999 6.49979 17.0522 6.49962 16.5002C6.49962 15.9479 6.94792 15.4996 7.5002 15.4996H11.9997Z" fill="currentColor" />
      <path d="M31.4997 34.9996C32.052 34.9996 32.5003 35.4479 32.5003 36.0002V40.4997C32.5003 41.052 32.052 41.5003 31.4997 41.5003C30.9477 41.5002 30.5001 41.0524 30.4998 40.5004V35.9995C30.5 35.4475 30.9477 34.9998 31.4997 34.9996Z" fill="currentColor" />
      <path d="M16.4999 6.49991C17.0522 6.49991 17.4998 6.94752 17.4998 7.49981V11.9993C17.4998 12.5516 17.0522 12.9992 16.4999 12.9992C15.9477 12.9992 15.5 12.5516 15.5 11.9993V7.49981C15.5 6.94752 15.9477 6.49992 16.4999 6.49991Z" fill="currentColor" />
      <path d="M40.5001 30.5001C41.0523 30.5002 41.5 30.9478 41.5 31.5C41.5 32.0522 41.0523 32.4998 40.5001 32.4999H36.0006C35.4483 32.4999 35 32.0516 35 31.4993C35.0003 30.9473 35.4479 30.4995 35.9999 30.4994L40.5001 30.5001Z" fill="currentColor" />
      <path d="M36.707 11.2929C39.5825 14.1685 39.583 18.831 36.7077 21.7069L33.7073 24.7072C33.3169 25.0978 32.6837 25.0977 32.2931 24.7072C31.9027 24.3167 31.9027 23.6835 32.2931 23.293L35.2935 20.2926C37.3877 18.1978 37.3873 14.8017 35.2928 12.7071C33.198 10.6124 29.8014 10.6124 27.7066 12.7071L24.7069 15.7068C24.3164 16.0973 23.6832 16.0973 23.2927 15.7068C22.9023 15.3163 22.9022 14.6831 23.2927 14.2926L26.2924 11.2929C29.1682 8.4171 33.8312 8.41713 36.707 11.2929Z" fill="currentColor" />
    </svg>
  );
}

function CodeBlock(props: {
  code: string;
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
        <CopyButton text={props.code} title={copyLabel} />
      </div>
      <pre aria-label={regionLabel} class="code-block" role="region" tabIndex={0}>
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
              <li>Fill Component name and Import path.</li>
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
              <HelpRow label="Component name" value="React component export, for example Button." />
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
