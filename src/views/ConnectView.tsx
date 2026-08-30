import {
  Button,
  Container,
  IconSearchSmall24,
  Text,
  Textbox,
  VerticalSpace,
} from '@create-figma-plugin/ui';
import { Fragment, h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { ConnectionHealth } from '../connection-health';
import { isMappingDocument } from '../mapping-document';
import { MappingEditorView } from '../mapping-editor-view';
import { selectCopyContent, type OutputPreferences } from '../output-preferences';
import { SemanticMappingView } from '../semantic-editor-view';
import { SEMANTIC_CONNECT_AUTHORING_ENABLED } from '../semantic/flags';
import type {
  ReconciliationAction,
  ReconciliationProposal,
} from '../semantic/reconcile';
import type { SemanticConnectionRecipe } from '../semantic/types';
import type {
  ComponentInventoryState,
  ConnectionImportPlanEntry,
  ConnectionIssue,
  UiTargetState,
} from '../types';
import { copyToClipboard } from '../ui-clipboard';
import { downloadBlob } from '../ui-download';
import {
  FORM_FIELD_IDS,
  formatConnectionUpdatedAt,
  getConnectionStatusSummary,
  type FormErrors,
  type PendingMutation,
} from '../ui-state';
import { type useConnectionController } from '../ui-controller';
import { IconInteractionClickSmall48 } from '../ui-assets';
import { Field, getFieldErrorId } from '../components/common';

export function StorybookGenerator(props: {
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
            {props.generation.variants.map((variant: { label: string; targetToken: string }) => {
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

export type InventoryFilter = 'all' | 'not-connected' | 'connected';

export function ComponentInventoryView(props: {
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
            <div class="inventory-search">
              <Textbox
                aria-label="Search components"
                icon={<IconSearchSmall24 />}
                onValueInput={props.onQueryChange}
                placeholder="Search components or pages"
                value={props.query}
              />
            </div>
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

export function ConnectionCoveragePanel(props: {
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

export function ConnectionImportPreview(props: {
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

export function InventoryFilterButton(props: {
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

export function InventoryMessage(props: {
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

export function ConnectComponentView(props: {
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

export function readSourceDocumentation(raw: string): {
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

export function ConnectionStatusPanel(props: {
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

export function EmptyComponentSelectionState(props: { message: string }): h.JSX.Element {
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
