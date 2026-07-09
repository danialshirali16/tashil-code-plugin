import {
  Button,
  Container,
  IconBackwardSmall24,
  IconCheck24,
  IconButton,
  IconCopySmall24,
  IconHelp16,
  render,
  Stack,
  Text,
  Textbox,
  TextboxMultiline,
  useWindowResize,
  VerticalSpace,
} from '@create-figma-plugin/ui';
import { emit, on } from '@create-figma-plugin/utilities';
import { Fragment, h } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import '!./ui.css';
import {
  CURRENT_SCHEMA_VERSION,
  type ClearConnectionHandler,
  type ConnectionMetadata,
  type InspectCodeState,
  type InspectCodeStateHandler,
  type PropMappings,
  type RefreshSelectionHandler,
  type ResizeWindowHandler,
  type SaveConnectionHandler,
  type SaveResultHandler,
  type ScaffoldPropMappingsHandler,
  type ScaffoldResultHandler,
  type SelectionStateHandler,
  type UiSelectionState,
} from './types';

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
  "isOnlyIcon": {
    "true": { "prop": "iconOnly", "value": true }
  },
  "hasLeadingIcon": {
    "true": { "prop": "leadingIcon", "value": "<Icon />", "raw": true }
  },
  "hasTrailingIcon": {
    "true": { "prop": "trailingIcon", "value": "<Icon />", "raw": true }
  }
}`;

function Plugin(): h.JSX.Element {
  const [view, setView] = useState<'connect' | 'help'>('connect');
  const [workflowTab, setWorkflowTab] = useState<'connect' | 'generate'>('connect');
  const [selectionState, setSelectionState] = useState<UiSelectionState>({
    status: 'empty',
    message: 'Select a component instance or main component.',
  });
  const [componentName, setComponentName] = useState('');
  const [importPath, setImportPath] = useState('');
  const [storybookUrl, setStorybookUrl] = useState('');
  const [sourcePath, setSourcePath] = useState('');
  const [propMappings, setPropMappings] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [inspectCodeState, setInspectCodeState] = useState<InspectCodeState>({
    status: 'invalid-selection',
  });

  const isReady = selectionState.status === 'ready';
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
    // Move focus to the newly selected tab (roving tabindex).
    const tabId = nextTab === 'connect' ? 'tashil-tab-connect' : 'tashil-tab-generate';
    document.getElementById(tabId)?.focus();
  }

  useEffect(() => {
    const offSelectionState = on<SelectionStateHandler>('SELECTION_STATE', (state) => {
      setSelectionState(state);
      setErrorMessage('');
      fillForm(state.existingConnection, state.componentName);
    });

    const offSaveResult = on<SaveResultHandler>('SAVE_RESULT', (result) => {
      setErrorMessage(result.ok ? '' : result.message);
    });

    const offInspectCodeState = on<InspectCodeStateHandler>('INSPECT_CODE_STATE', (state) => {
      setInspectCodeState(state);
    });

    const offScaffoldResult = on<ScaffoldResultHandler>('SCAFFOLD_RESULT', (result) => {
      if (!result.ok) {
        setErrorMessage(result.message || 'Could not scaffold prop mappings.');
        return;
      }

      setErrorMessage('');
      mergePropMappings(result.mappings ?? {});
    });

    emit<RefreshSelectionHandler>('REFRESH_SELECTION');

    return () => {
      offSelectionState();
      offSaveResult();
      offInspectCodeState();
      offScaffoldResult();
    };
  }, []);

  /**
   * Merge scaffolded mappings into the textarea, preserving any manually
   * authored keys. Existing keys win; only new keys are added.
   */
  function mergePropMappings(incoming: PropMappings): void {
    let existing: PropMappings = {};
    try {
      existing = propMappings.trim() === ''
        ? {}
        : JSON.parse(propMappings) as PropMappings;
    } catch (_error) {
      setErrorMessage('Fix the existing prop mappings JSON before scaffolding.');
      return;
    }

    const merged: PropMappings = {
      ...incoming,
      ...existing,
    };

    setPropMappings(JSON.stringify(merged, null, 2));
  }

  function fillForm(connection?: ConnectionMetadata, fallbackComponentName?: string): void {
    setComponentName(connection?.componentName || fallbackComponentName || '');
    setImportPath(connection?.importPath || '');
    setStorybookUrl(connection?.storybookUrl || '');
    setSourcePath(connection?.sourcePath || '');
    setPropMappings(connection?.propMappings
      ? JSON.stringify(connection.propMappings, null, 2)
      : '');
  }

  function handleSave(): void {
    try {
      const parsedPropMappings = propMappings.trim() === ''
        ? {}
        : JSON.parse(propMappings) as ConnectionMetadata['propMappings'];

      emit<SaveConnectionHandler>('SAVE_CONNECTION', {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        componentName: componentName.trim(),
        importPath: importPath.trim(),
        storybookUrl: storybookUrl.trim() || undefined,
        sourcePath: sourcePath.trim() || undefined,
        propMappings: parsedPropMappings,
      });
    } catch (_error) {
      setErrorMessage('Prop mappings must be valid JSON.');
    }
  }

  function handleScaffold(): void {
    emit<ScaffoldPropMappingsHandler>('SCAFFOLD_PROP_MAPPINGS');
  }

  const hasFooter = view === 'connect' && workflowTab === 'connect' && isReady;

  return (
    <div class={hasFooter ? 'root' : 'root root-no-footer'}>
      <div class="header">
        <Container space="medium">
          <div class="top-bar">
            {view === 'help' ? (
              <Button
                aria-label="Back to connect component"
                onClick={() => setView('connect')}
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
            <IconButton
              aria-label={view === 'help' ? 'Back to connect component' : 'Open how it works'}
              onClick={() => setView(view === 'help' ? 'connect' : 'help')}
              title={view === 'help' ? 'Back' : 'How it works'}
            >
              <IconHelp16 />
            </IconButton>
          </div>
        </Container>
      </div>

      {view === 'connect' && workflowTab === 'connect' ? (
        <div
          aria-labelledby="tashil-tab-connect"
          class="tabpanel"
          id="tashil-tabpanel-connect"
          role="tabpanel"
        >
          <ConnectComponentView
            componentName={componentName}
            errorMessage={errorMessage}
            handleSave={handleSave}
            handleScaffold={handleScaffold}
            importPath={importPath}
            isReady={isReady}
            propMappings={propMappings}
            selectionState={selectionState}
            setComponentName={setComponentName}
            setImportPath={setImportPath}
            setPropMappings={setPropMappings}
            setSourcePath={setSourcePath}
            setStorybookUrl={setStorybookUrl}
            sourcePath={sourcePath}
            storybookUrl={storybookUrl}
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
  componentName: string;
  errorMessage: string;
  handleSave: () => void;
  handleScaffold: () => void;
  importPath: string;
  isReady: boolean;
  propMappings: string;
  selectionState: UiSelectionState;
  setComponentName: (value: string) => void;
  setImportPath: (value: string) => void;
  setPropMappings: (value: string) => void;
  setSourcePath: (value: string) => void;
  setStorybookUrl: (value: string) => void;
  sourcePath: string;
  storybookUrl: string;
}): h.JSX.Element {
  if (!props.isReady) {
    return (
      <EmptyComponentSelectionState message={props.selectionState.message} />
    );
  }

  return (
    <Fragment>
      <div class="fields">
        <Container space="medium">
          <VerticalSpace space="medium" />
          <div class="form-stack">
            <Field label="Component name">
              <Textbox
                disabled={!props.isReady}
                onValueInput={props.setComponentName}
                placeholder="e.g., Button"
                value={props.componentName}
              />
            </Field>

            <Field label="Import path">
              <Textbox
                disabled={!props.isReady}
                onValueInput={props.setImportPath}
                placeholder="e.g., tashil-ui"
                value={props.importPath}
              />
            </Field>

            <Field label="Storybook URL">
              <Textbox
                disabled={!props.isReady}
                onValueInput={props.setStorybookUrl}
                placeholder="e.g., https://storybook.example.com/?path=/story/..."
                value={props.storybookUrl}
              />
            </Field>

            <Field label="Source path">
              <Textbox
                disabled={!props.isReady}
                onValueInput={props.setSourcePath}
                placeholder="e.g., src/components/Button/Button.tsx"
                value={props.sourcePath}
              />
            </Field>

            <div class="field">
              <div class="field-label-row">
                <Text>Prop mappings JSON</Text>
                <Button
                  disabled={!props.isReady}
                  onClick={props.handleScaffold}
                  secondary
                >
                  Generate from component
                </Button>
              </div>
              <TextboxMultiline
                disabled={!props.isReady}
                grow
                onValueInput={props.setPropMappings}
                rows={9}
                spellCheck={false}
                value={props.propMappings}
                placeholder={PROP_MAPPINGS_PLACEHOLDER}
              />
            </div>
          </div>
          {props.errorMessage ? (
            <Fragment>
              <VerticalSpace space="small" />
              <Text>{props.errorMessage}</Text>
            </Fragment>
          ) : null}
          <VerticalSpace space="medium" />
        </Container>
      </div>

      <div class="footer">
        <div class="actions">
          <div class="spacer" />
          <div class="primary-actions">
            <Button disabled={!props.isReady} onClick={() => emit<ClearConnectionHandler>('CLEAR_CONNECTION')} secondary>
              Clear
            </Button>
            <Button disabled={!props.isReady} onClick={props.handleSave}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </Fragment>
  );
}

function EmptyComponentSelectionState(props: { message: string }): h.JSX.Element {
  const lines = props.message.split('\n');

  return (
    <div class="connect-empty">
      <div aria-hidden="true" class="inspect-empty-icon">
        <IconInteractionClickSmall48 />
      </div>
      <div class="inspect-empty-label">
        {lines.map((line, index) => (
          <Text key={index}>{line}</Text>
        ))}
      </div>
    </div>
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

  return (
    <div class="inspect-content">
      <CodeBlock
        code={props.inspectCodeState.code || ''}
        title="Code"
      />
      <CodeBlock
        code={props.inspectCodeState.references || ''}
        title="References"
      />
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
    <div class="inspect-empty">
      <div aria-hidden="true" class="inspect-empty-icon">
        {props.icon}
      </div>
      <div class="inspect-empty-label">
        <Text>{props.label}</Text>
      </div>
      {props.actionLabel && props.onAction ? (
        <Button onClick={props.onAction}>
          {props.actionLabel}
        </Button>
      ) : null}
    </div>
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
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    await copyToClipboard(props.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 3000);
  }

  return (
    <section class="code-section">
      <div class="code-section-header">
        <Text>{props.title}</Text>
        <IconButton
          aria-label={`Copy ${props.title}`}
          onClick={() => {
            void handleCopy();
          }}
          title={copied ? 'Copied' : `Copy ${props.title}`}
        >
          {copied ? <IconCheck24 /> : <IconCopySmall24 />}
        </IconButton>
      </div>
      <pre class="code-block">
        <code>
          {lines.map((line, index) => (
            <span class="code-line" key={`${props.title}-${index}`}>
              <span class="code-line-number">{index + 1}</span>
              <span class="code-line-content">{renderCodeLine(line)}</span>
            </span>
          ))}
        </code>
      </pre>
    </section>
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

async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');

  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function HowItWorksView(): h.JSX.Element {
  return (
    <div class="help-page">
      <Container space="medium">
        <VerticalSpace space="medium" />
        <div class="section-heading">
          <Text>Workflow</Text>
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
              <li>Fill Component name, Import path, Storybook URL, and Source path.</li>
              <li>Adjust Prop mappings JSON so Figma properties map to React props.</li>
              <li>Click Save. The data is stored on the selected main component as shared plugin data.</li>
            </ol>
          </HelpSection>

          <HelpSection title="Use it in Dev Mode">
            <ol class="help-list">
              <li>Switch to Dev Mode and select a connected component instance.</li>
              <li>Open the Code section and choose Tashil UI.</li>
              <li>Copy the generated TSX usage snippet and reference links.</li>
            </ol>
          </HelpSection>

          <HelpSection title="Required fields">
            <div class="help-table">
              <HelpRow label="Component name" value="React component export, for example Button." />
              <HelpRow label="Import path" value="Package import path, for example tashil-ui." />
              <HelpRow label="Storybook URL" value="The matching Storybook story or docs page." />
              <HelpRow label="Source path" value="The source file path for developer reference." />
              <HelpRow label="Prop mappings JSON" value="Maps Figma component properties to TSX props." />
            </div>
          </HelpSection>
        </Stack>
        <VerticalSpace space="medium" />
      </Container>
    </div>
  );
}

function HelpSection(props: { children: h.JSX.Element | h.JSX.Element[]; title: string }): h.JSX.Element {
  return (
    <section class="help-section">
      <Stack space="small">
        <Text>{props.title}</Text>
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

function Field(props: { children: h.JSX.Element; label: string }): h.JSX.Element {
  return (
    <label class="field">
      <Text>{props.label}</Text>
      {props.children}
    </label>
  );
}

export default render(Plugin);
