import {
  Banner,
  Button,
  Columns,
  Container,
  IconBackwardSmall24,
  IconComponent16,
  IconInfo16,
  render,
  Stack,
  Text,
  Textbox,
  TextboxMultiline,
  VerticalSpace,
} from '@create-figma-plugin/ui';
import { emit, on } from '@create-figma-plugin/utilities';
import { Fragment, h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '!./ui.css';

type PropMapping = {
  prop: string;
  value: string | number | boolean;
  raw?: boolean;
};

type ConnectionMetadata = {
  componentName: string;
  importPath: string;
  storybookUrl?: string;
  sourcePath?: string;
  defaultProps?: Record<string, string | number | boolean>;
  propMappings?: Record<string, Record<string, PropMapping>>;
};

type UiSelectionState = {
  status: 'ready' | 'empty';
  componentName?: string;
  existingConnection?: ConnectionMetadata;
  message: string;
};

type SelectionStateHandler = {
  name: 'SELECTION_STATE';
  handler: (state: UiSelectionState) => void;
};

type SaveConnectionHandler = {
  name: 'SAVE_CONNECTION';
  handler: (metadata: ConnectionMetadata) => void;
};

type ClearConnectionHandler = {
  name: 'CLEAR_CONNECTION';
  handler: () => void;
};

type RefreshSelectionHandler = {
  name: 'REFRESH_SELECTION';
  handler: () => void;
};

type SaveResultHandler = {
  name: 'SAVE_RESULT';
  handler: (result: { ok: boolean; message: string }) => void;
};

const DEFAULT_PROP_MAPPINGS = `{
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
  const [selectionState, setSelectionState] = useState<UiSelectionState>({
    status: 'empty',
    message: 'Select a component instance or main component.',
  });
  const [componentName, setComponentName] = useState('');
  const [importPath, setImportPath] = useState('');
  const [storybookUrl, setStorybookUrl] = useState('');
  const [sourcePath, setSourcePath] = useState('');
  const [propMappings, setPropMappings] = useState(DEFAULT_PROP_MAPPINGS);
  const [errorMessage, setErrorMessage] = useState('');

  const isReady = selectionState.status === 'ready';

  useEffect(() => {
    const offSelectionState = on<SelectionStateHandler>('SELECTION_STATE', (state) => {
      setSelectionState(state);
      setErrorMessage('');
      fillForm(state.existingConnection, state.componentName);
    });

    const offSaveResult = on<SaveResultHandler>('SAVE_RESULT', (result) => {
      setErrorMessage(result.ok ? '' : result.message);
    });

    emit<RefreshSelectionHandler>('REFRESH_SELECTION');

    return () => {
      offSelectionState();
      offSaveResult();
    };
  }, []);

  function fillForm(connection?: ConnectionMetadata, fallbackComponentName?: string): void {
    setComponentName(connection?.componentName || fallbackComponentName || '');
    setImportPath(connection?.importPath || '');
    setStorybookUrl(connection?.storybookUrl || '');
    setSourcePath(connection?.sourcePath || '');
    setPropMappings(connection?.propMappings
      ? JSON.stringify(connection.propMappings, null, 2)
      : DEFAULT_PROP_MAPPINGS);
  }

  function handleSave(): void {
    try {
      const parsedPropMappings = propMappings.trim() === ''
        ? {}
        : JSON.parse(propMappings) as ConnectionMetadata['propMappings'];

      emit<SaveConnectionHandler>('SAVE_CONNECTION', {
        componentName: componentName.trim(),
        importPath: importPath.trim(),
        defaultProps: getDefaultProps(componentName, importPath),
        storybookUrl: storybookUrl.trim() || undefined,
        sourcePath: sourcePath.trim() || undefined,
        propMappings: parsedPropMappings,
      });
    } catch (_error) {
      setErrorMessage('Prop mappings must be valid JSON.');
    }
  }

  function getDefaultProps(
    currentComponentName: string,
    currentImportPath: string,
  ): ConnectionMetadata['defaultProps'] {
    if (currentComponentName.trim() === 'Button' && currentImportPath.trim() === 'tashil-ui') {
      return {
        intent: 'primary',
        variant: 'solid',
        size: 'md',
      };
    }

    return undefined;
  }

  return (
    <div class="root">
      <div class="header">
        <Container space="medium">
          <VerticalSpace space="small" />
          <div class="top-bar">
            <Stack space="extraSmall">
              <Text>{view === 'help' ? 'How it works' : 'Connect component'}</Text>
              <Text>
                {view === 'help'
                  ? 'Learn how to connect Figma components to Storybook code snippets.'
                  : 'Save Storybook metadata on the selected main component for Dev Mode code snippets.'}
              </Text>
            </Stack>
            <Button
              aria-label={view === 'help' ? 'Back to connect component' : 'Open how it works'}
              onClick={() => setView(view === 'help' ? 'connect' : 'help')}
              secondary
              title={view === 'help' ? 'Back' : 'How it works'}
            >
              {view === 'help' ? (
                <span class="button-content">
                  <IconBackwardSmall24 />
                  Back
                </span>
              ) : '? How it works'}
            </Button>
          </div>
          <VerticalSpace space="small" />
        </Container>
      </div>

      {view === 'connect' ? (
        <ConnectComponentView
          componentName={componentName}
          errorMessage={errorMessage}
          handleSave={handleSave}
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
      ) : (
        <HowItWorksView />
      )}
    </div>
  );
}

function ConnectComponentView(props: {
  componentName: string;
  errorMessage: string;
  handleSave: () => void;
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
  return (
    <Fragment>
      <div class="status">
        <Container space="medium">
          <VerticalSpace space="small" />
          <Banner
            icon={props.selectionState.existingConnection ? <IconComponent16 /> : <IconInfo16 />}
            variant={props.selectionState.existingConnection ? 'success' : undefined}
          >
            {props.errorMessage || props.selectionState.message}
          </Banner>
          <VerticalSpace space="small" />
        </Container>
      </div>

      <div class="fields">
        <Container space="medium">
          <VerticalSpace space="medium" />
          <Stack space="medium">
            <Field label="Component name">
              <Textbox
                disabled={!props.isReady}
                onValueInput={props.setComponentName}
                placeholder="Button"
                value={props.componentName}
              />
            </Field>

            <Field label="Import path">
              <Textbox
                disabled={!props.isReady}
                onValueInput={props.setImportPath}
                placeholder="tashil-ui"
                value={props.importPath}
              />
            </Field>

            <Field label="Storybook URL">
              <Textbox
                disabled={!props.isReady}
                onValueInput={props.setStorybookUrl}
                placeholder="https://storybook.example.com/?path=/story/components-button--primary"
                value={props.storybookUrl}
              />
            </Field>

            <Field label="Source path">
              <Textbox
                disabled={!props.isReady}
                onValueInput={props.setSourcePath}
                placeholder="src/components/Button/Button.tsx"
                value={props.sourcePath}
              />
            </Field>

            <Field label="Prop mappings JSON">
              <TextboxMultiline
                disabled={!props.isReady}
                onValueInput={props.setPropMappings}
                rows={9}
                spellCheck={false}
                value={props.propMappings}
              />
            </Field>
          </Stack>
          <VerticalSpace space="medium" />
        </Container>
      </div>

      <div class="footer">
        <Container space="medium">
          <VerticalSpace space="small" />
          <Columns space="small">
            <div class="actions">
              <div class="spacer" />
              <Button onClick={() => emit<RefreshSelectionHandler>('REFRESH_SELECTION')} secondary>
                Refresh
              </Button>
              <Button danger disabled={!props.isReady} onClick={() => emit<ClearConnectionHandler>('CLEAR_CONNECTION')}>
                Clear
              </Button>
              <Button disabled={!props.isReady} onClick={props.handleSave}>
                Save
              </Button>
            </div>
          </Columns>
          <VerticalSpace space="small" />
        </Container>
      </div>
    </Fragment>
  );
}

function HowItWorksView(): h.JSX.Element {
  return (
    <div class="help-page">
      <Container space="medium">
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
