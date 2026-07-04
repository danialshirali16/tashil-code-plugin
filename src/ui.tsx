import {
  Banner,
  Button,
  Columns,
  Container,
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
import { h } from 'preact';
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
          <Stack space="extraSmall">
            <Text>Connect component</Text>
            <Text>Save Storybook metadata on the selected main component for Dev Mode code snippets.</Text>
          </Stack>
          <VerticalSpace space="small" />
        </Container>
      </div>

      <div class="status">
        <Container space="medium">
          <VerticalSpace space="small" />
          <Banner
            icon={selectionState.existingConnection ? <IconComponent16 /> : <IconInfo16 />}
            variant={selectionState.existingConnection ? 'success' : undefined}
          >
            {errorMessage || selectionState.message}
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
                disabled={!isReady}
                onValueInput={setComponentName}
                placeholder="Button"
                value={componentName}
              />
            </Field>

            <Field label="Import path">
              <Textbox
                disabled={!isReady}
                onValueInput={setImportPath}
                placeholder="tashil-ui"
                value={importPath}
              />
            </Field>

            <Field label="Storybook URL">
              <Textbox
                disabled={!isReady}
                onValueInput={setStorybookUrl}
                placeholder="https://storybook.example.com/?path=/story/components-button--primary"
                value={storybookUrl}
              />
            </Field>

            <Field label="Source path">
              <Textbox
                disabled={!isReady}
                onValueInput={setSourcePath}
                placeholder="src/components/Button/Button.tsx"
                value={sourcePath}
              />
            </Field>

            <Field label="Prop mappings JSON">
              <TextboxMultiline
                disabled={!isReady}
                onValueInput={setPropMappings}
                rows={9}
                spellCheck={false}
                value={propMappings}
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
              <Button danger disabled={!isReady} onClick={() => emit<ClearConnectionHandler>('CLEAR_CONNECTION')}>
                Clear
              </Button>
              <Button disabled={!isReady} onClick={handleSave}>
                Save
              </Button>
            </div>
          </Columns>
          <VerticalSpace space="small" />
        </Container>
      </div>
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
