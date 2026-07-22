import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CaretDown,
  CaretRight,
  Check,
  CheckCircle,
  Code,
  Copy,
  FileTs,
  FigmaLogo,
  MagicWand,
  SlidersHorizontal,
  WarningCircle,
  X,
} from '@phosphor-icons/react';

const figmaProperties = {
  Intent: ['Primary', 'Secondary', 'Neutral', 'Positive', 'Negative'],
  Style: ['Solid', 'Outline', 'Tonal', 'Ghost', 'Link'],
  Size: ['Small', 'Medium', 'Large'],
  Disabled: ['False', 'True'],
  Loading: ['False', 'True'],
  Width: ['Hug', 'Fill'],
  Content: ['Label', 'Icon only'],
};

const initialMappings = [
  {
    prop: 'color',
    type: 'ButtonColorType',
    values: ['primary', 'secondary', 'neutral', 'success', 'error'],
    figma: 'Intent',
    valueMap: {
      primary: 'Primary',
      secondary: 'Secondary',
      neutral: 'Neutral',
      success: 'Positive',
      error: 'Negative',
    },
  },
  {
    prop: 'variant',
    type: 'ButtonVariantType',
    values: ['solid', 'outline', 'tonal', 'ghost', 'link'],
    figma: 'Style',
    valueMap: {
      solid: 'Solid',
      outline: 'Outline',
      tonal: 'Tonal',
      ghost: 'Ghost',
      link: 'Link',
    },
  },
  {
    prop: 'size',
    type: 'ButtonSizeType',
    values: ['small', 'medium', 'large'],
    figma: 'Size',
    valueMap: { small: 'Small', medium: 'Medium', large: 'Large' },
  },
  {
    prop: 'disabled',
    type: 'boolean',
    values: ['false', 'true'],
    figma: 'Disabled',
    valueMap: { false: 'False', true: 'True' },
  },
  {
    prop: 'loading',
    type: 'boolean',
    values: ['false', 'true'],
    figma: 'Loading',
    valueMap: { false: 'False', true: 'True' },
  },
  {
    prop: 'fullWidth',
    type: 'boolean',
    values: ['false', 'true'],
    figma: '',
    valueMap: {},
  },
  {
    prop: 'iconOnly',
    type: 'boolean',
    values: ['false', 'true'],
    figma: 'Content',
    valueMap: { false: 'Label', true: 'Icon only' },
  },
];

const suggestions = {
  color: ['Intent', { primary: 'Primary', secondary: 'Secondary', neutral: 'Neutral', success: 'Positive', error: 'Negative' }],
  variant: ['Style', { solid: 'Solid', outline: 'Outline', tonal: 'Tonal', ghost: 'Ghost', link: 'Link' }],
  size: ['Size', { small: 'Small', medium: 'Medium', large: 'Large' }],
  disabled: ['Disabled', { false: 'False', true: 'True' }],
  loading: ['Loading', { false: 'False', true: 'True' }],
  fullWidth: ['Width', { false: 'Hug', true: 'Fill' }],
  iconOnly: ['Content', { false: 'Label', true: 'Icon only' }],
};

function mappingStatus(mapping) {
  if (!mapping.figma) return 'unmapped';
  const options = figmaProperties[mapping.figma] || [];
  const complete = mapping.values.every((value) => options.includes(mapping.valueMap[value]));
  return complete ? 'mapped' : 'review';
}

function toStoredJson(mappings) {
  const result = {};
  for (const mapping of mappings) {
    if (!mapping.figma) continue;
    for (const codeValue of mapping.values) {
      const figmaValue = mapping.valueMap[codeValue];
      if (!figmaValue) continue;
      result[mapping.figma] ??= {};
      let value = codeValue;
      if (mapping.type === 'boolean') value = codeValue === 'true';
      result[mapping.figma][figmaValue] = { prop: mapping.prop, value };
    }
  }
  return JSON.stringify(result, null, 2);
}

function StatusBadge({ status }) {
  if (status === 'mapped') {
    return <span className="status-badge mapped"><CheckCircle weight="fill" /> Mapped</span>;
  }
  if (status === 'review') {
    return <span className="status-badge review"><WarningCircle weight="fill" /> Review</span>;
  }
  return <span className="status-badge unmapped">Not mapped</span>;
}

function MappingCard({ mapping, open, onToggle, onPropertyChange, onValueChange }) {
  const status = mappingStatus(mapping);
  const figmaOptions = mapping.figma ? figmaProperties[mapping.figma] : [];

  return (
    <article className={`mapping-card ${open ? 'open' : ''}`}>
      <div className="mapping-main-row">
        <button className="expand-button" onClick={onToggle} aria-label={`${open ? 'Collapse' : 'Expand'} ${mapping.prop}`}>
          {open ? <CaretDown weight="bold" /> : <CaretRight weight="bold" />}
        </button>
        <div className="code-prop">
          <div className="prop-name-row">
            <code>{mapping.prop}</code>
            <StatusBadge status={status} />
          </div>
          <div className="prop-meta">{mapping.type} · optional</div>
        </div>
        <div className="connection-line" aria-hidden="true"><span /></div>
        <label className="select-shell">
          <span className="sr-only">Figma property for {mapping.prop}</span>
          <FigmaLogo weight="fill" />
          <select value={mapping.figma} onChange={(event) => onPropertyChange(event.target.value)}>
            <option value="">Select a Figma property</option>
            {Object.keys(figmaProperties).map((property) => (
              <option value={property} key={property}>{property}</option>
            ))}
          </select>
          <CaretDown weight="bold" />
        </label>
      </div>

      {open && (
        <div className="value-panel">
          <div className="value-header">
            <span>Code value</span>
            <span>Figma option</span>
          </div>
          {mapping.values.map((value) => (
            <div className="value-row" key={value}>
              <code>{mapping.type === 'boolean' ? value : `“${value}”`}</code>
              <div className="short-connection" aria-hidden="true"><span /></div>
              <label className="value-select">
                <span className="sr-only">Figma value for {mapping.prop} {value}</span>
                <select
                  disabled={!mapping.figma}
                  value={mapping.valueMap[value] || ''}
                  onChange={(event) => onValueChange(value, event.target.value)}
                >
                  <option value="">Select option</option>
                  {figmaOptions.map((option) => <option value={option} key={option}>{option}</option>)}
                </select>
                <CaretDown weight="bold" />
              </label>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

export function App() {
  const [mappings, setMappings] = useState(initialMappings);
  const [openProp, setOpenProp] = useState('variant');
  const [showJson, setShowJson] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const json = useMemo(() => toStoredJson(mappings), [mappings]);
  const mappedCount = mappings.filter((mapping) => mappingStatus(mapping) === 'mapped').length;

  const updateMapping = (prop, updater) => {
    setSaved(false);
    setMappings((current) => current.map((item) => item.prop === prop ? updater(item) : item));
  };

  const autoMap = () => {
    setMappings((current) => current.map((mapping) => {
      const [figma, valueMap] = suggestions[mapping.prop];
      return { ...mapping, figma, valueMap };
    }));
    setSaved(false);
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      // Clipboard access can be unavailable in an embedded preview.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="prototype-stage">
      <section className="plugin-window" aria-label="Tashil Code prop mapping preview">
        <header className="topbar">
          <div className="brand">Tashil Code</div>
          <button className="icon-button" aria-label="Close preview"><X /></button>
        </header>

        <div className="subbar">
          <button className="back-button"><ArrowLeft weight="bold" /> Button</button>
          <span className="step-pill">Step 2 of 2</span>
        </div>

        <main className="content">
          <section className="intro">
            <div>
              <p className="eyebrow">Connect component</p>
              <h1>Map code props to Figma</h1>
              <p className="intro-copy">Choose the matching Figma property for each React prop, then review how their values connect.</p>
            </div>
            <div className="completion-ring" aria-label={`${mappedCount} of ${mappings.length} props mapped`}>
              <strong>{mappedCount}/{mappings.length}</strong>
              <span>mapped</span>
            </div>
          </section>

          <div className="source-grid">
            <section className="source-card">
              <div className="card-label"><Code /> Code source</div>
              <div className="source-card-content">
                <div className="file-icon"><FileTs weight="fill" /></div>
                <div className="file-copy">
                  <strong>types.ts</strong>
                  <span>components/button/types.ts</span>
                </div>
                <span className="source-count">7 props</span>
              </div>
            </section>
            <section className="source-card figma-card">
              <div className="card-label"><FigmaLogo weight="fill" /> Figma selection</div>
              <div className="source-card-content">
                <div className="figma-icon"><FigmaLogo weight="fill" /></div>
                <div className="file-copy">
                  <strong>Button</strong>
                  <span>Component set · 7 properties</span>
                </div>
                <span className="connected-dot"><Check weight="bold" /></span>
              </div>
            </section>
          </div>

          <section className="mapping-section">
            <div className="section-heading">
              <div>
                <h2>Property mappings</h2>
                <p>Suggested matches are based on prop names and values.</p>
              </div>
              <button className="secondary-button" onClick={autoMap}><MagicWand weight="fill" /> Auto-map all</button>
            </div>

            <div className="mapping-column-labels" aria-hidden="true">
              <span>React prop</span>
              <span>Figma property</span>
            </div>

            <div className="mapping-list">
              {mappings.map((mapping) => (
                <MappingCard
                  key={mapping.prop}
                  mapping={mapping}
                  open={openProp === mapping.prop}
                  onToggle={() => setOpenProp((current) => current === mapping.prop ? '' : mapping.prop)}
                  onPropertyChange={(figma) => updateMapping(mapping.prop, (item) => ({ ...item, figma, valueMap: {} }))}
                  onValueChange={(value, figmaValue) => updateMapping(mapping.prop, (item) => ({
                    ...item,
                    valueMap: { ...item.valueMap, [value]: figmaValue },
                  }))}
                />
              ))}
            </div>
          </section>

          <section className="advanced-section">
            <button className="advanced-toggle" onClick={() => setShowJson((current) => !current)}>
              <SlidersHorizontal />
              <span><strong>Advanced JSON</strong><small>Preview the metadata saved to Figma</small></span>
              {showJson ? <CaretDown weight="bold" /> : <CaretRight weight="bold" />}
            </button>
            {showJson && (
              <div className="json-panel">
                <button onClick={copyJson} className="copy-button">{copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy JSON'}</button>
                <pre>{json}</pre>
              </div>
            )}
          </section>
        </main>

        <footer className="footer">
          <div className="footer-status">
            {saved ? <><CheckCircle weight="fill" /> Mapping saved successfully</> : <>{mappedCount} of {mappings.length} props are ready</>}
          </div>
          <div className="footer-actions">
            <button className="tertiary-button">Back</button>
            <button className="primary-button" onClick={() => setSaved(true)}>Save connection</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
