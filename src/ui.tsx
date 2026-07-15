import {
  Button,
  Container,
  IconBackwardSmall24,
  IconCheck24,
  IconButton,
  IconCopySmall24,
  IconHelp16,
  render,
  SegmentedControl,
  Stack,
  Text,
  Textbox,
  TextboxMultiline,
  useWindowResize,
  VerticalSpace,
} from '@create-figma-plugin/ui';
import { emit } from '@create-figma-plugin/utilities';
import { Fragment, h } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import '!./ui.css';
import { normalizeHttpUrl } from './external-url';
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
  type ChildrenMode,
  type ConnectionIssue,
  type ConnectionReferences,
  type InspectCodeState,
  type OpenExternalHandler,
  type ResizeWindowHandler,
  type UiSelectionState,
} from './types';

const CHILDREN_MODE_OPTIONS = [
  { children: 'Text', value: 'text' },
  { children: 'Icon', value: 'icon-only' },
  { children: 'None', value: 'none' },
];

const PROP_MAPPINGS_PLACEHOLDER = `e.g.,
{
  "intent": {
    "primary": { "prop": "intent", "value": "primary" },
    "neutral": { "prop": "intent", "value": "neutral" },
    "positive": { "prop": "intent", "value": "success" },
    "negative": { "prop": "intent", "value": "error" }
  },
  "style": {
    "solid": { "prop": "variant", "value": "solid" },
    "tonal": { "prop": "variant", "value": "tonal" },
    "outline": { "prop": "variant", "value": "outline" },
    "ghost": { "prop": "variant", "value": "ghost" },
    "link": { "prop": "variant", "value": "link" }
  },
  "state": {
    "loading": { "prop": "loading", "value": true },
    "disabled": { "prop": "disabled", "value": true }
  },
  "size": {
    "md": { "prop": "size", "value": "md" },
    "sm": { "prop": "size", "value": "sm" }
  },
  "hasLeadingIcon": {
    "true": { "prop": "leadingIcon", "value": "<Icon />", "raw": true }
  },
  "hasTrailingIcon": {
    "true": { "prop": "trailingIcon", "value": "<Icon />", "raw": true }
  }
}`;

export function Plugin(): h.JSX.Element {
  const [view, setView] = useState<'connect' | 'help'>('connect');
  const [workflowTab, setWorkflowTab] = useState<'connect' | 'generate'>('connect');
  const {
    activePendingOperation,
    cancelClear: handleCancelClear,
    clear: handleClear,
    clearCancelButtonRef,
    errorMessage,
    fieldErrors,
    formValues,
    inspectCodeState,
    isClearConfirmationOpen,
    isDirty,
    isReady,
    save: handleSave,
    scaffold: handleScaffold,
    selectionState,
    selectionStatusAnnouncement,
    setChildrenMode,
    setFormField,
    statusMessage,
  } = useConnectionController();

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
    const tabs: Array<'connect' | 'generate'> = ['connect', 'generate'];
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
    const tabId = nextTab === 'connect' ? 'tashil-tab-connect' : 'tashil-tab-generate';
    document.getElementById(tabId)?.focus();
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

  const hasFooter = view === 'connect' && workflowTab === 'connect' && isReady;

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
                  Connect Component
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
        {selectionStatusAnnouncement}
      </div>

      {view === 'connect' && workflowTab === 'connect' ? (
        <div
          aria-labelledby="tashil-tab-connect"
          class="tabpanel"
          id="tashil-tabpanel-connect"
          role="tabpanel"
        >
          <ConnectComponentView
            childrenMode={formValues.childrenMode}
            childrenTextProperty={formValues.childrenTextProperty}
            componentName={formValues.componentName}
            clearCancelButtonRef={(element) => {
              clearCancelButtonRef.current = element;
            }}
            errorMessage={errorMessage}
            fieldErrors={fieldErrors}
            handleCancelClear={handleCancelClear}
            handleClear={handleClear}
            handleSave={handleSave}
            handleScaffold={handleScaffold}
            iconComponentName={formValues.iconComponentName}
            iconImportPath={formValues.iconImportPath}
            importPath={formValues.importPath}
            isClearConfirmationOpen={isClearConfirmationOpen}
            isDirty={isDirty}
            isReady={isReady}
            pendingOperation={activePendingOperation}
            propMappings={formValues.propMappings}
            selectionState={selectionState}
            setChildrenMode={setChildrenMode}
            setChildrenTextProperty={(value) => setFormField('childrenTextProperty', value)}
            setComponentName={(value) => setFormField('componentName', value)}
            setIconComponentName={(value) => setFormField('iconComponentName', value)}
            setIconImportPath={(value) => setFormField('iconImportPath', value)}
            setImportPath={(value) => setFormField('importPath', value)}
            setPropMappings={(value) => setFormField('propMappings', value)}
            setSourcePath={(value) => setFormField('sourcePath', value)}
            setSourceUrl={(value) => setFormField('sourceUrl', value)}
            setStorybookUrl={(value) => setFormField('storybookUrl', value)}
            sourcePath={formValues.sourcePath}
            sourceUrl={formValues.sourceUrl}
            statusMessage={statusMessage}
            storybookUrl={formValues.storybookUrl}
          />
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
      {view === 'help' ? (
        <HowItWorksView />
      ) : null}
      <div aria-hidden="true" class="resize-corner" />
    </div>
  );
}

function ConnectComponentView(props: {
  childrenMode: ChildrenMode;
  childrenTextProperty: string;
  clearCancelButtonRef: (element: HTMLButtonElement | null) => void;
  componentName: string;
  errorMessage: string;
  fieldErrors: FormErrors;
  handleCancelClear: () => void;
  handleClear: () => void;
  handleSave: () => void;
  handleScaffold: () => void;
  iconComponentName: string;
  iconImportPath: string;
  importPath: string;
  isClearConfirmationOpen: boolean;
  isDirty: boolean;
  isReady: boolean;
  pendingOperation?: PendingMutation['operation'];
  propMappings: string;
  selectionState: UiSelectionState;
  setChildrenMode: (value: ChildrenMode) => void;
  setChildrenTextProperty: (value: string) => void;
  setComponentName: (value: string) => void;
  setIconComponentName: (value: string) => void;
  setIconImportPath: (value: string) => void;
  setImportPath: (value: string) => void;
  setPropMappings: (value: string) => void;
  setSourcePath: (value: string) => void;
  setSourceUrl: (value: string) => void;
  setStorybookUrl: (value: string) => void;
  sourcePath: string;
  sourceUrl: string;
  statusMessage: string;
  storybookUrl: string;
}): h.JSX.Element {
  if (!props.isReady) {
    return (
      <EmptyComponentSelectionState message={props.selectionState.message} />
    );
  }

  const existingConnection = props.selectionState.status === 'ready'
    ? props.selectionState.existingConnection
    : undefined;
  const connectionIssue = props.selectionState.status === 'ready'
    ? props.selectionState.connectionIssue
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

            <fieldset class="children-mode-fieldset">
              <legend class="field-label">Children</legend>
              <SegmentedControl
                disabled={!props.isReady}
                onValueChange={(value) => {
                  if (value === 'text' || value === 'icon-only' || value === 'none') {
                    props.setChildrenMode(value);
                  }
                }}
                options={CHILDREN_MODE_OPTIONS}
                value={props.childrenMode}
              />
            </fieldset>

            {props.childrenMode !== 'none' ? (
              <Field
                error={props.fieldErrors.childrenTextProperty}
                id={FORM_FIELD_IDS.childrenTextProperty}
                label={props.childrenMode === 'icon-only'
                  ? 'Accessible label property'
                  : 'Figma text property'}
              >
                <Textbox
                  aria-describedby={getFieldErrorId(
                    'childrenTextProperty',
                    props.fieldErrors,
                  )}
                  aria-invalid={Boolean(props.fieldErrors.childrenTextProperty)}
                  aria-required="true"
                  disabled={!props.isReady}
                  id={FORM_FIELD_IDS.childrenTextProperty}
                  onValueInput={props.setChildrenTextProperty}
                  placeholder="e.g., label or Button Text"
                  value={props.childrenTextProperty}
                />
              </Field>
            ) : null}

            {props.childrenMode === 'icon-only' ? (
              <Fragment>
                <Field
                  error={props.fieldErrors.iconComponentName}
                  id={FORM_FIELD_IDS.iconComponentName}
                  label="Icon component"
                >
                  <Textbox
                    aria-describedby={getFieldErrorId(
                      'iconComponentName',
                      props.fieldErrors,
                    )}
                    aria-invalid={Boolean(props.fieldErrors.iconComponentName)}
                    aria-required="true"
                    disabled={!props.isReady}
                    id={FORM_FIELD_IDS.iconComponentName}
                    onValueInput={props.setIconComponentName}
                    placeholder="e.g., TrashIcon"
                    value={props.iconComponentName}
                  />
                </Field>
                <Field
                  error={props.fieldErrors.iconImportPath}
                  id={FORM_FIELD_IDS.iconImportPath}
                  label="Icon import path"
                >
                  <Textbox
                    aria-describedby={getFieldErrorId('iconImportPath', props.fieldErrors)}
                    aria-invalid={Boolean(props.fieldErrors.iconImportPath)}
                    aria-required="true"
                    disabled={!props.isReady}
                    id={FORM_FIELD_IDS.iconImportPath}
                    onValueInput={props.setIconImportPath}
                    placeholder="e.g., tashil-ui/icons"
                    value={props.iconImportPath}
                  />
                </Field>
              </Fragment>
            ) : null}

            <div class="field">
              <div class="field-label-row">
                <label class="field-label" htmlFor={FORM_FIELD_IDS.propMappings}>
                  Prop mappings JSON
                </label>
                <Button
                  disabled={!props.isReady || props.pendingOperation !== undefined}
                  onClick={props.handleScaffold}
                  secondary
                >
                  {props.pendingOperation === 'scaffold'
                    ? 'Generating…'
                    : 'Generate from component'}
                </Button>
              </div>
              <TextboxMultiline
                aria-describedby={getFieldErrorId('propMappings', props.fieldErrors)}
                aria-invalid={Boolean(props.fieldErrors.propMappings)}
                disabled={!props.isReady}
                grow
                id={FORM_FIELD_IDS.propMappings}
                onValueInput={props.setPropMappings}
                rows={9}
                spellCheck={false}
                value={props.propMappings}
                placeholder={PROP_MAPPINGS_PLACEHOLDER}
              />
              {props.fieldErrors.propMappings ? (
                <div class="field-error" id={`${FORM_FIELD_IDS.propMappings}-error`}>
                  {props.fieldErrors.propMappings}
                </div>
              ) : null}
            </div>
          </div>
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

function InspectCodeView(props: {
  inspectCodeState: InspectCodeState;
  onGoToConnect: () => void;
}): h.JSX.Element {
  if (props.inspectCodeState.status === 'invalid-selection') {
    return (
      <EmptyInspectState
        icon={<IconInteractionClickSmall48 />}
        label={props.inspectCodeState.message || 'Select a component'}
      />
    );
  }

  if (props.inspectCodeState.status === 'not-connected') {
    return (
      <EmptyInspectState
        actionLabel="Go to Connect Component"
        icon={<IconDetach48 />}
        label="This component isn't connected"
        onAction={props.onGoToConnect}
      />
    );
  }

  if (props.inspectCodeState.status === 'connection-issue') {
    return (
      <EmptyInspectState
        icon={<IconDetach48 />}
        label={props.inspectCodeState.message || 'Stored connection needs attention'}
      />
    );
  }

  return (
    <main aria-labelledby="tashil-inspect-code-heading" class="inspect-content">
      <h1 class="visually-hidden" id="tashil-inspect-code-heading">Inspect code</h1>
      <CodeBlock
        code={props.inspectCodeState.code || ''}
        title="Code"
      />
      {props.inspectCodeState.diagnostics ? (
        <CodeBlock
          code={props.inspectCodeState.diagnostics}
          title="Mapping diagnostics"
        />
      ) : null}
      <ConnectionReferencesPanel references={props.inspectCodeState.references || {}} />
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
              label="Source"
              target="source"
              url={references.sourceUrl}
            />
          ) : null}
          {references.sourcePath ? (
            <div class="reference-row">
              <dt class="reference-label-row">
                <span>Source path</span>
                <CopyButton text={references.sourcePath} title="source path" />
              </dt>
              <dd class="reference-value reference-path">{references.sourcePath}</dd>
            </div>
          ) : null}
          {references.updatedAt ? (
            <div class="reference-row">
              <dt class="reference-label">Last updated</dt>
              <dd class="reference-value">
                {updatedAt ? (
                  <time dateTime={updatedAt.dateTime}>{updatedAt.label}</time>
                ) : (
                  'Not available'
                )}
              </dd>
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
      <dt class="reference-label">{props.label}</dt>
      <dd class="reference-value">
        <span class="reference-url">{props.url}</span>
        {url ? (
          <button
            class="reference-open-button"
            onClick={() => {
              emit<OpenExternalHandler>('OPEN_EXTERNAL', {
                target: props.target,
                url,
              });
            }}
            type="button"
          >
            Open {props.label} in browser
          </button>
        ) : (
          <span class="reference-warning">
            This saved URL is not a valid HTTP(S) address. Update it in Connect Component.
          </span>
        )}
      </dd>
    </div>
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

function CodeBlock(props: { code: string; title: string }): h.JSX.Element {
  const lines = props.code.length > 0 ? props.code.split('\n') : [''];
  const headingId = props.title === 'Code'
    ? 'tashil-generated-code-heading'
    : 'tashil-mapping-diagnostics-heading';
  const regionLabel = props.title === 'Code'
    ? 'Generated TSX code, horizontally scrollable'
    : 'Prop mapping diagnostics, horizontally scrollable';

  return (
    <section class="code-section">
      <div class="code-section-header">
        <h2 class="code-section-heading" id={headingId}>{props.title}</h2>
        <CopyButton text={props.code} title={props.title} />
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

  const tokens = /("[^"]*"|'[^']*'|\b(?:const|default|export|from|function|import|let|return|var)\b|<\/?[A-Z][A-Za-z0-9.]*(?=[\s>/])|[A-Za-z][A-Za-z0-9]*(?==)|\{[^}]*\}|\/?>)/g;
  const parts: Array<h.JSX.Element | string> = [];
  let cursor = 0;
  let match = tokens.exec(line);

  while (match !== null) {
    const token = match[0];

    if (match.index > cursor) {
      parts.push(line.slice(cursor, match.index));
    }

    parts.push(
      <span class={getSyntaxClassName(token)} key={`${match.index}-${token}`}>
        {token}
      </span>
    );
    cursor = match.index + token.length;
    match = tokens.exec(line);
  }

  if (cursor < line.length) {
    parts.push(line.slice(cursor));
  }

  return parts;
}

function getSyntaxClassName(token: string): string {
  if (/^["']/.test(token)) {
    return 'syntax-string';
  }
  if (/^(const|default|export|from|function|import|let|return|var)$/.test(token)) {
    return 'syntax-keyword';
  }
  if (/^<\/?[A-Z]/.test(token)) {
    return 'syntax-tag';
  }
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(token)) {
    return 'syntax-attribute';
  }
  if (/^\{/.test(token)) {
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
              <li>Fill Component name and Import path, then choose how children render.</li>
              <li>Add optional Storybook and source references.</li>
              <li>Adjust Prop mappings JSON so Figma properties map to React props.</li>
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
              <HelpRow label="Children" value="Render text, a configured imported icon, or no children." />
              <HelpRow label="Storybook URL" value="The matching Storybook story or docs page." />
              <HelpRow label="Source path" value="The source file path for developer reference." />
              <HelpRow label="Source URL" value="An optional browser link to the source file." />
              <HelpRow label="Prop mappings JSON" value="Maps Figma component properties to TSX props." />
            </div>
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
