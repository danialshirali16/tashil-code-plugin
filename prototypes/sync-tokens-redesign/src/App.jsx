import { useMemo, useState } from "react";
import {
  IconCheck,
  IconCopy,
  IconFileCode,
  IconHelpCircle,
  IconSearch,
  IconX,
} from "@tabler/icons-react";

const collections = [
  { id: "references", name: "References Color", count: 362, modes: ["Default"] },
  {
    id: "product",
    name: "Product Tokens",
    count: 294,
    modes: ["Zhina", "Tashilpay", "Zamyad", "Peykan"],
  },
  { id: "typography", name: "Typography", count: 61, modes: ["Default"] },
  { id: "measurement", name: "Measurement", count: 29, modes: ["Default"] },
];

const slug = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

function CheckControl({ checked, label, onChange }) {
  return (
    <label className="check-control" aria-label={label}>
      <input checked={checked} onChange={onChange} type="checkbox" />
      <span className="check-visual" aria-hidden="true">
        {checked ? <IconCheck size={14} stroke={3} /> : null}
      </span>
    </label>
  );
}

function SegmentedControl({ label, onChange, options, value }) {
  return (
    <fieldset className="field-group">
      <legend>{label}</legend>
      <div className="segments">
        {options.map((option) => (
          <label className={value === option.value ? "segment active" : "segment"} key={option.value}>
            <input
              checked={value === option.value}
              name={label}
              onChange={() => onChange(option.value)}
              type="radio"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function App() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(new Set(["product"]));
  const [modes, setModes] = useState({
    product: new Set(["Zhina", "Tashilpay"]),
  });
  const [convertRem, setConvertRem] = useState(true);
  const [rootSize, setRootSize] = useState(16);
  const [colorFormat, setColorFormat] = useState("hex");
  const [nameStyle, setNameStyle] = useState("kebab");
  const [exported, setExported] = useState(false);
  const [copiedFile, setCopiedFile] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? collections.filter((item) => item.name.toLowerCase().includes(needle)) : collections;
  }, [query]);

  const selectedCollections = collections.filter((collection) => selected.has(collection.id));
  const fileCount = selectedCollections.reduce((total, collection) => {
    const chosen = modes[collection.id];
    return total + (chosen?.size || 1);
  }, 0);
  const variableCount = selectedCollections.reduce((total, collection) => total + collection.count, 0);
  const allVisibleSelected = filtered.length > 0 && filtered.every((collection) => selected.has(collection.id));

  const toggleCollection = (id) => {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setExported(false);
  };

  const toggleMode = (collection, mode) => {
    setModes((current) => {
      const nextModes = { ...current };
      const chosen = new Set(nextModes[collection.id] || [collection.modes[0]]);
      chosen.has(mode) ? chosen.delete(mode) : chosen.add(mode);
      if (chosen.size === 0) chosen.add(collection.modes[0]);
      nextModes[collection.id] = chosen;
      return nextModes;
    });
    setExported(false);
  };

  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        filtered.forEach((collection) => next.delete(collection.id));
      } else {
        filtered.forEach((collection) => next.add(collection.id));
      }
      return next;
    });
    setExported(false);
  };

  const focusedCollection =
    selectedCollections.find((collection) => collection.modes.length > 1) || selectedCollections[0];
  const focusedModes = focusedCollection
    ? modes[focusedCollection.id] || new Set([focusedCollection.modes[0]])
    : new Set();

  return (
    <main className="stage">
      <section className="plugin-window" aria-label="Tashil Code plugin preview">
        <header className="titlebar">
          <div className="brand">
            <img alt="" src="/assets/icon.png" />
            <span>Tashil Code</span>
          </div>
          <button className="icon-button" aria-label="Close preview" type="button">
            <IconX size={20} stroke={1.8} />
          </button>
        </header>

        <nav className="tabs" aria-label="Plugin sections">
          <div className="tab-list" role="tablist">
            <button aria-selected="false" role="tab" type="button">Components</button>
            <button aria-selected="false" role="tab" type="button">Inspect Code</button>
            <button aria-selected="true" className="active" role="tab" type="button">Sync Tokens</button>
          </div>
          <button className="icon-button" aria-label="Sync Tokens help" type="button">
            <IconHelpCircle size={18} stroke={1.9} />
          </button>
        </nav>

        <div className="content">
          <section className="intro">
            <h1>Sync tokens</h1>
            <p>Select a collection and choose modes to generate CSS files.</p>
          </section>

          <div className="collection-toolbar">
            <label className="search-field">
              <IconSearch aria-hidden="true" size={17} stroke={1.8} />
              <span className="sr-only">Search collections</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search collections"
                type="search"
                value={query}
              />
            </label>
            <button className="secondary-button" onClick={toggleAll} type="button">
              {allVisibleSelected ? "Clear all" : "Select all"}
            </button>
          </div>

          <section className="builder-section">
            <h2>1. Choose collection</h2>
            <div className="collection-list">
              {filtered.length === 0 ? (
                <p className="empty-state">No collections match “{query}”.</p>
              ) : (
                filtered.map((collection) => {
                  const checked = selected.has(collection.id);
                  return (
                    <div className={checked ? "collection-row selected" : "collection-row"} key={collection.id}>
                      <CheckControl
                        checked={checked}
                        label={`${checked ? "Exclude" : "Include"} ${collection.name}`}
                        onChange={() => toggleCollection(collection.id)}
                      />
                      <button className="row-select" onClick={() => toggleCollection(collection.id)} type="button">
                        <span>{collection.name}</span>
                        <span className="count">({collection.count})</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="builder-section output-section" aria-live="polite">
            <div className="section-heading">
              <div>
                <h2>2. {focusedCollection ? `${focusedCollection.name} output` : "Choose an output"}</h2>
                <p>Choose one or more modes to export.</p>
              </div>
              {focusedCollection ? <span className="variable-badge">{focusedCollection.count} variables</span> : null}
            </div>

            {focusedCollection ? (
              <div className="mode-list">
                {focusedCollection.modes.map((mode) => {
                  const checked = focusedModes.has(mode);
                  const suffix = focusedCollection.modes.length > 1 ? `-${slug(mode)}` : "";
                  const filename = `${slug(focusedCollection.name)}${suffix}.css`;
                  return (
                    <div className={checked ? "mode-row selected" : "mode-row"} key={mode}>
                      <CheckControl
                        checked={checked}
                        label={`${checked ? "Exclude" : "Include"} ${mode} mode`}
                        onChange={() => toggleMode(focusedCollection, mode)}
                      />
                      <button
                        className="mode-label"
                        onClick={() => toggleMode(focusedCollection, mode)}
                        type="button"
                      >
                        {mode}
                      </button>
                      <span className="filename">{filename}</span>
                      <button
                        aria-label={`Copy ${filename}`}
                        className="copy-button"
                        onClick={() => setCopiedFile(filename)}
                        title={copiedFile === filename ? "Copied" : `Copy ${filename}`}
                        type="button"
                      >
                        {copiedFile === filename ? <IconCheck size={15} /> : <IconCopy size={15} />}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="output-empty">Select a collection to configure its output.</div>
            )}
          </section>

          <section className="settings-section">
            <h2>3. Output settings</h2>
            <div className="settings-panel">
              <div className="unit-settings">
                <label className="toggle-row">
                  <span>Convert px to rem</span>
                  <input
                    checked={convertRem}
                    onChange={(event) => setConvertRem(event.target.checked)}
                    type="checkbox"
                  />
                  <span className="switch" aria-hidden="true" />
                </label>
                <label className="numeric-field">
                  <span>Root font size</span>
                  <span className={convertRem ? "input-shell" : "input-shell disabled"}>
                    <input
                      disabled={!convertRem}
                      min="1"
                      onChange={(event) => setRootSize(event.target.value)}
                      type="number"
                      value={rootSize}
                    />
                    <span>px</span>
                  </span>
                </label>
              </div>

              <div className="format-settings">
                <SegmentedControl
                  label="Color format"
                  onChange={setColorFormat}
                  options={[
                    { label: "HEX", value: "hex" },
                    { label: "RGB", value: "rgb" },
                    { label: "RGBA", value: "rgba" },
                    { label: "Variable", value: "variable" },
                  ]}
                  value={colorFormat}
                />
                <SegmentedControl
                  label="Token name"
                  onChange={setNameStyle}
                  options={[
                    { label: "kebab", value: "kebab" },
                    { label: "slash", value: "slash" },
                    { label: "snake", value: "snake" },
                    { label: "pascal", value: "pascal" },
                  ]}
                  value={nameStyle}
                />
              </div>
            </div>
          </section>
        </div>

        <footer className="export-bar">
          <div className="export-summary">
            <IconFileCode aria-hidden="true" size={22} stroke={1.8} />
            <div>
              <strong>{fileCount} {fileCount === 1 ? "file" : "files"} · {variableCount} variables</strong>
              <span>{exported ? "Export prepared successfully" : fileCount > 0 ? "Ready to export" : "Select a collection to continue"}</span>
            </div>
          </div>
          <button
            className="primary-button"
            disabled={fileCount === 0}
            onClick={() => setExported(true)}
            type="button"
          >
            {exported ? <IconCheck size={18} stroke={2.4} /> : null}
            {exported ? "Export ready" : `Export ${fileCount || ""} CSS ${fileCount === 1 ? "file" : "files"}`.replace("  ", " ")}
          </button>
        </footer>
      </section>
    </main>
  );
}
