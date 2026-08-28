import {
  Banner,
  Button,
  Container,
  Divider,
  IconComponentSet16,
  IconHelp16,
  IconLibrary16,
  IconPage16,
  IconRefresh16,
  IconVariable16,
  IconWand16,
  IconWarning16,
  IconButton,
  Layer,
  LoadingIndicator,
  RadioButtons,
  SearchTextbox,
  SegmentedControl,
  Tabs,
  Text,
  VerticalSpace,
} from '@create-figma-plugin/ui';
import { Fragment, h, render } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import './docs-redesign-preview.css';

type Scope = 'tokens' | 'components';
type Output = 'canvas' | 'markdown';
type Concept = 'focus' | 'library' | 'canvas';

type SourceItem = {
  description: string;
  id: string;
  name: string;
  status?: 'connected' | 'standalone';
};

const TOKEN_SOURCES: SourceItem[] = [
  { id: 'colors', name: 'Colors', description: '92 tokens · 2 modes' },
  { id: 'spacing', name: 'Spacing', description: '28 tokens · 1 mode' },
  { id: 'radius', name: 'Radius', description: '14 tokens · 1 mode' },
  { id: 'typography', name: 'Typography', description: '36 tokens · 2 modes' },
];

const COMPONENT_SOURCES: SourceItem[] = [
  { id: 'button', name: 'Button', description: 'Component set · 24 variants', status: 'connected' },
  { id: 'input', name: 'Input', description: 'Component set · 18 variants', status: 'connected' },
  { id: 'avatar', name: 'Avatar', description: 'Component set · 12 variants', status: 'standalone' },
  { id: 'banner', name: 'Banner', description: 'Component · 6 variants', status: 'connected' },
];

const APP_TABS = [
  { children: 'Components', value: 'components' },
  { children: 'Inspect Code', value: 'inspect' },
  { children: 'Sync Tokens', value: 'sync' },
  { children: 'Docs', value: 'docs' },
  { children: 'Settings', value: 'settings' },
];

const SCOPE_OPTIONS = [
  { children: 'Design tokens', value: 'tokens' },
  { children: 'Components', value: 'components' },
];

const OUTPUT_OPTIONS = [
  { children: 'Figma canvas', value: 'canvas' },
  { children: 'Markdown', value: 'markdown' },
];

function PluginHeader(): h.JSX.Element {
  return (
    <header class="native-plugin-header">
      <div class="native-plugin-brand">
        <span class="native-brand-icon"><IconLibrary16 /></span>
        <strong>Tashil Code</strong>
      </div>
      <div class="native-app-tabs">
        <Tabs onValueChange={() => undefined} options={APP_TABS} value="docs" />
      </div>
      <IconButton aria-label="Help"><IconHelp16 /></IconButton>
    </header>
  );
}

function SourceLayers(props: {
  filter: string;
  onSelect: (item: SourceItem) => void;
  scope: Scope;
  selectedId: string;
}): h.JSX.Element {
  const items = props.scope === 'tokens' ? TOKEN_SOURCES : COMPONENT_SOURCES;
  const filtered = items.filter((item) => item.name.toLowerCase().includes(props.filter.trim().toLowerCase()));

  return (
    <div class="native-source-layers">
      {filtered.map((item) => (
        <Layer
          bold={item.id === props.selectedId}
          component={props.scope === 'components'}
          description={item.description}
          icon={props.scope === 'tokens' ? <IconVariable16 /> : <IconComponentSet16 />}
          key={item.id}
          onValueChange={() => props.onSelect(item)}
          value={item.id === props.selectedId}
        >
          {item.name}
        </Layer>
      ))}
      {filtered.length === 0 ? <Text align="center">No matching sources</Text> : null}
    </div>
  );
}

function NativeProgress(props: { onCancel: () => void }): h.JSX.Element {
  return (
    <div aria-live="polite" class="native-progress">
      <LoadingIndicator />
      <div><strong>Building documentation…</strong><span>Creating sections and binding variables</span></div>
      <Button onClick={props.onCancel} secondary>Cancel</Button>
    </div>
  );
}

function FocusedWorkspace(): h.JSX.Element {
  const [scope, setScope] = useState<Scope>('tokens');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<SourceItem>(TOKEN_SOURCES[0]);
  const [output, setOutput] = useState<Output>('canvas');
  const [running, setRunning] = useState(false);

  function changeScope(value: string): void {
    const next = value as Scope;
    setScope(next);
    setSelected(next === 'tokens' ? TOKEN_SOURCES[0] : COMPONENT_SOURCES[0]);
    setFilter('');
  }

  return (
    <div class="native-plugin-window">
      <PluginHeader />
      <div class="focus-native-layout">
        <aside class="focus-native-rail">
          <Container space="small">
            <h2>Documentation sources</h2>
            <Text>Choose the collection or component you want to publish.</Text>
            <VerticalSpace space="small" />
            <SegmentedControl onValueChange={changeScope} options={SCOPE_OPTIONS} value={scope} />
            <VerticalSpace space="small" />
            <SearchTextbox
              clearOnEscapeKeyDown
              onValueInput={setFilter}
              placeholder="Search sources…"
              value={filter}
            />
          </Container>
          <Divider />
          <SourceLayers filter={filter} onSelect={setSelected} scope={scope} selectedId={selected.id} />
        </aside>

        <section class="focus-native-content">
          <div class="native-context-line">
            <Text>Canvas selection · 1. Colors</Text>
            <Button secondary>Reveal in Figma</Button>
          </div>
          <div class="focus-native-scroll">
            <Container space="medium">
              <div class="native-title-row">
                <div><h1>{selected.name}</h1><Text>{selected.description}</Text></div>
                {scope === 'tokens' ? <div class="native-swatches"><i /><i /><i /><i /><i /></div> : <IconComponentSet16 />}
              </div>
              <VerticalSpace space="medium" />
              <section class="native-field-row">
                <Text>Output</Text>
                <RadioButtons
                  direction="horizontal"
                  onValueChange={(value) => setOutput(value as Output)}
                  options={OUTPUT_OPTIONS}
                  value={output}
                />
              </section>
              <Divider />
              <section class="native-field-row">
                <Text>Current document</Text>
                <div>
                  <Banner icon={<IconWarning16 />} variant="warning">
                    1. Colors has 3 changes since its last generation.
                  </Banner>
                  <VerticalSpace space="small" />
                  <div class="native-inline-actions">
                    <Button secondary>View changes</Button>
                    <Button>Update in place</Button>
                  </div>
                </div>
              </section>
              <Divider />
              <section class="native-field-row">
                <Text>Summary</Text>
                <div class="native-facts"><span>92 tokens</span><span>2 modes</span><span>18 groups</span></div>
              </section>
            </Container>
          </div>
          <footer class="native-action-footer">
            <Text>New pages are placed to the right of existing docs.</Text>
            <div class="native-inline-actions">
              <Button secondary>Export Markdown</Button>
              <Button onClick={() => setRunning(true)}>
                <IconWand16 /> {output === 'canvas' ? 'Generate on canvas' : 'Generate Markdown'}
              </Button>
            </div>
          </footer>
        </section>
      </div>
      {running ? <NativeProgress onCancel={() => setRunning(false)} /> : null}
    </div>
  );
}

function DocumentationLibrary(): h.JSX.Element {
  const [scope, setScope] = useState<Scope>('tokens');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<SourceItem>(TOKEN_SOURCES[0]);
  const [running, setRunning] = useState(false);
  const items = scope === 'tokens' ? TOKEN_SOURCES : COMPONENT_SOURCES;
  const filtered = useMemo(
    () => items.filter((item) => item.name.toLowerCase().includes(filter.trim().toLowerCase())),
    [filter, items],
  );

  function changeScope(value: string): void {
    const next = value as Scope;
    setScope(next);
    setSelected(next === 'tokens' ? TOKEN_SOURCES[0] : COMPONENT_SOURCES[0]);
  }

  return (
    <div class="native-plugin-window">
      <PluginHeader />
      <div class="library-native-surface">
        <Container space="medium">
          <div class="library-native-header">
            <div><h1>Documentation library</h1><Text>Publish and maintain design-system specifications.</Text></div>
            <div class="library-native-tools">
              <SearchTextbox clearOnEscapeKeyDown onValueInput={setFilter} placeholder="Search library…" value={filter} />
              <IconButton aria-label="Refresh library"><IconRefresh16 /></IconButton>
            </div>
          </div>
          <Tabs onValueChange={changeScope} options={SCOPE_OPTIONS} value={scope} />
          <VerticalSpace space="small" />
          <div class="library-native-banner">
            <Banner icon={<IconWarning16 />} variant="warning">
              Selected document “1. Colors” has 3 source changes.
            </Banner>
            <div class="native-inline-actions"><Button secondary>View changes</Button><Button>Update in place</Button></div>
          </div>
          <VerticalSpace space="small" />
          <div class="library-native-head"><Text>Source</Text><Text>Coverage</Text><Text>Status</Text></div>
          <div class="library-native-list">
            {filtered.map((item) => (
              <div class="library-native-row" key={item.id}>
                <Layer
                  bold={selected.id === item.id}
                  component={scope === 'components'}
                  description={item.description}
                  icon={scope === 'tokens' ? <IconVariable16 /> : <IconComponentSet16 />}
                  onValueChange={() => setSelected(item)}
                  value={selected.id === item.id}
                >
                  {item.name}
                </Layer>
                <Text>{scope === 'tokens' ? item.description.split(' · ')[0] : item.description.split(' · ')[1]}</Text>
                <span class={`native-status ${item.status === 'standalone' ? 'warning' : ''}`}>
                  {item.status === 'standalone' ? 'Standalone' : 'Ready'}
                </span>
              </div>
            ))}
          </div>
        </Container>
      </div>
      <div class="library-native-dock">
        <div><strong>{selected.name} selected</strong><Text>{selected.description}</Text></div>
        <div class="native-inline-actions"><Button secondary>Markdown</Button><Button onClick={() => setRunning(true)}><IconWand16 /> Generate page</Button></div>
      </div>
      {running ? <NativeProgress onCancel={() => setRunning(false)} /> : null}
    </div>
  );
}

function CanvasCompanion(): h.JSX.Element {
  const [scope, setScope] = useState<Scope>('tokens');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<SourceItem>(TOKEN_SOURCES[0]);
  const [output, setOutput] = useState<Output>('canvas');
  const [running, setRunning] = useState(false);

  function changeScope(value: string): void {
    const next = value as Scope;
    setScope(next);
    setSelected(next === 'tokens' ? TOKEN_SOURCES[0] : COMPONENT_SOURCES[0]);
  }

  return (
    <div class="native-plugin-window">
      <PluginHeader />
      <div class="canvas-native-layout">
        <section class="canvas-native-main">
          <Container space="medium">
            <div class="native-title-row"><div><h1>Document the system</h1><Text>Turn live Figma sources into maintained specifications.</Text></div><span class="native-live"><i />Following canvas selection</span></div>
            <VerticalSpace space="small" />
            <div class="canvas-native-selection">
              <Banner icon={<IconPage16 />} variant="warning">
                1. Colors is selected · 3 changes detected.
              </Banner>
              <Button>Update in place</Button>
            </div>
            <VerticalSpace space="medium" />
            <div class="canvas-native-source-title"><strong>Choose a source</strong><Text>4 available</Text></div>
            <div class="canvas-native-catalog">
              <div class="canvas-native-toolbar">
                <SegmentedControl onValueChange={changeScope} options={SCOPE_OPTIONS} value={scope} />
                <SearchTextbox clearOnEscapeKeyDown onValueInput={setFilter} placeholder="Filter sources…" value={filter} />
              </div>
              <Divider />
              <SourceLayers filter={filter} onSelect={setSelected} scope={scope} selectedId={selected.id} />
            </div>
          </Container>
        </section>
        <aside class="canvas-native-inspector">
          <Container space="medium">
            <h2>Output preview</h2>
            <Text>What will be created beside your existing documentation.</Text>
            <VerticalSpace space="medium" />
            <div class="native-page-preview"><span><IconPage16 /></span><div><strong>1. {selected.name}</strong><Text>1980px specification frame</Text></div></div>
            <VerticalSpace space="medium" />
            <RadioButtons
              direction="vertical"
              onValueChange={(value) => setOutput(value as Output)}
              options={OUTPUT_OPTIONS}
              value={output}
            />
            <VerticalSpace space="medium" />
            <div class="native-inspector-facts"><Text>Contents</Text><strong>{selected.description.split(' · ')[0]}</strong><Text>Placement</Text><strong>Right of docs</strong></div>
          </Container>
          <div class="canvas-native-actions">
            <Button onClick={() => setRunning(true)}><IconWand16 /> {output === 'canvas' ? 'Generate on canvas' : 'Generate Markdown'}</Button>
            <Button secondary>Generation settings</Button>
          </div>
        </aside>
      </div>
      {running ? <NativeProgress onCancel={() => setRunning(false)} /> : null}
    </div>
  );
}

function PreviewApp(): h.JSX.Element {
  const [concept, setConcept] = useState<Concept>('focus');
  const [compare, setCompare] = useState(false);
  const visible = compare ? ['focus', 'library', 'canvas'] as Concept[] : [concept];

  return (
    <Fragment>
      <header class="native-preview-toolbar">
        <div><strong>Docs redesign directions</strong><Text>Built with @create-figma-plugin/ui</Text></div>
        <div class="native-concept-switch"><SegmentedControl
          onValueChange={(value) => { setConcept(value as Concept); setCompare(false); }}
          options={[
            { children: 'A · Focused workspace', value: 'focus' },
            { children: 'B · Documentation library', value: 'library' },
            { children: 'C · Canvas companion', value: 'canvas' },
          ]}
          value={concept}
        /></div>
        <Button onClick={() => setCompare((value) => !value)} secondary>{compare ? 'Single view' : 'Compare all'}</Button>
      </header>
      <main class="native-preview-stage">
        {visible.map((name) => (
          <section class="native-concept" key={name}>
            <div class="native-concept-copy">
              <div>
                <h1>{name === 'focus' ? 'Focused workspace' : name === 'library' ? 'Documentation library' : 'Canvas companion'}</h1>
                <Text>{name === 'focus'
                  ? 'A persistent source rail and a focused inspector for frequent generation work.'
                  : name === 'library'
                    ? 'A dense maintenance view for teams with many sources and existing documents.'
                    : 'A selection-first workflow where the live Figma canvas leads the task.'}</Text>
              </div>
              <span>{name === 'focus' ? 'Recommended' : name === 'library' ? 'High density' : 'Selection-first'}</span>
            </div>
            {name === 'focus' ? <FocusedWorkspace /> : name === 'library' ? <DocumentationLibrary /> : <CanvasCompanion />}
          </section>
        ))}
      </main>
    </Fragment>
  );
}

const root = document.getElementById('preview-root');
if (root) render(<PreviewApp />, root);
