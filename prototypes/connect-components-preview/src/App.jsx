import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowClockwise,
  CaretRight,
  CheckCircle,
  Code,
  LinkBreak,
  MagnifyingGlass,
  Question,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

const seedComponents = [
  ["Button", "not-connected", "Foundations"],
  ["TextField", "connected", "Forms"],
  ["Slider", "connected", "Forms"],
  ["Toast", "not-connected", "Feedback"],
  ["Checkbox", "not-connected", "Forms"],
  ["Switch", "not-connected", "Forms"],
  ["Notification", "not-connected", "Feedback"],
  ["Dropdown", "not-connected", "Forms"],
  ["Badge", "connected", "Foundations"],
  ["Breadcrumb", "connected", "Navigation"],
  ["DatePicker", "needs-attention", "Forms"],
  ["Dialog", "connected", "Overlays"],
  ["Avatar", "connected", "Foundations"],
  ["Tabs", "connected", "Navigation"],
  ["Tooltip", "not-connected", "Overlays"],
  ["Pagination", "connected", "Navigation"],
  ["Radio", "not-connected", "Forms"],
  ["SearchField", "connected", "Forms"],
  ["Select", "connected", "Forms"],
  ["Accordion", "not-connected", "Content"],
  ["Card", "connected", "Content"],
  ["Table", "connected", "Content"],
  ["Progress", "not-connected", "Feedback"],
  ["Spinner", "connected", "Feedback"],
];

const generatedFamilies = [
  "Action",
  "AppBar",
  "Banner",
  "BottomSheet",
  "Calendar",
  "Chip",
  "DataCell",
  "EmptyState",
  "FileUpload",
  "Filter",
  "InlineMessage",
  "ListItem",
  "Menu",
  "Navigation",
  "NumberInput",
  "Popover",
  "SegmentedControl",
  "SidePanel",
  "Skeleton",
  "Stepper",
  "Tag",
  "Timeline",
  "ToggleGroup",
  "TreeItem",
  "UserMenu",
];

function createComponentCatalog() {
  const catalog = seedComponents.map(([name, status, page], index) => ({
    id: `component-${index + 1}`,
    name,
    page,
    status,
  }));
  const variants = ["Compact", "Default", "Mobile", "Responsive"];
  let connectedRemaining = 24 - catalog.filter((item) => item.status === "connected").length;

  for (const family of generatedFamilies) {
    for (const variant of variants) {
      if (catalog.length >= 124) break;
      const index = catalog.length;
      const status =
        connectedRemaining > 0 && index % 6 === 0
          ? "connected"
          : index === 56 || index === 93
            ? "needs-attention"
            : "not-connected";

      if (status === "connected") connectedRemaining -= 1;
      catalog.push({
        id: `component-${index + 1}`,
        name: `${family} / ${variant}`,
        page: index % 3 === 0 ? "Foundations" : index % 3 === 1 ? "Patterns" : "Product",
        status,
      });
    }
  }

  while (catalog.length < 124) {
    const index = catalog.length;
    const status = connectedRemaining > 0 ? "connected" : "not-connected";
    if (status === "connected") connectedRemaining -= 1;
    catalog.push({
      id: `component-${index + 1}`,
      name: `Utility / ${index + 1}`,
      page: "Utilities",
      status,
    });
  }

  return catalog;
}

const initialCatalog = createComponentCatalog();

function StatusIcon({ status, size = 20 }) {
  if (status === "connected") {
    return <CheckCircle aria-hidden="true" className="status-icon connected" size={size} weight="regular" />;
  }
  if (status === "needs-attention") {
    return <WarningCircle aria-hidden="true" className="status-icon attention" size={size} weight="regular" />;
  }
  return <LinkBreak aria-hidden="true" className="status-icon disconnected" size={size} weight="regular" />;
}

function StatusFilter({ active, count, label, tone, onClick }) {
  return (
    <button
      aria-pressed={active}
      className={`status-filter ${active ? "active" : ""}`}
      onClick={onClick}
      type="button"
    >
      <strong className={tone ? `tone-${tone}` : ""}>{count}</strong>
      <span>{label}</span>
    </button>
  );
}

function Scanner({ progress }) {
  return (
    <main className="scanner" aria-live="polite">
      <div className="scanner-graphic">
        <ArrowClockwise aria-hidden="true" size={28} weight="regular" />
      </div>
      <h1>Scanning main components…</h1>
      <p>Checking page {Math.max(progress, 1)} of 12</p>
      <div className="progress-track" aria-label={`Scanning page ${progress} of 12`}>
        <span style={{ width: `${(progress / 12) * 100}%` }} />
      </div>
      <div className="scanner-skeletons" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </main>
  );
}

function ComponentsHome({
  catalog,
  filter,
  onFilter,
  onOpenComponent,
  onRescan,
  query,
  setQuery,
}) {
  const counts = useMemo(
    () => ({
      all: catalog.length,
      connected: catalog.filter((item) => item.status === "connected").length,
      unconnected: catalog.filter((item) => item.status !== "connected").length,
    }),
    [catalog],
  );

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return catalog.filter((item) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "connected" && item.status === "connected") ||
        (filter === "not-connected" && item.status !== "connected");
      const matchesQuery =
        normalizedQuery === "" ||
        item.name.toLowerCase().includes(normalizedQuery) ||
        item.page.toLowerCase().includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    });
  }, [catalog, filter, query]);

  return (
    <main className="components-home">
      <section className="status-section" aria-labelledby="status-heading">
        <div className="section-title-row">
          <h1 id="status-heading">Status</h1>
          <button aria-label="Scan again" className="icon-button subtle" onClick={onRescan} title="Scan again" type="button">
            <ArrowClockwise size={16} />
          </button>
        </div>
        <div className="status-grid">
          <StatusFilter active={filter === "all"} count={counts.all} label="All" onClick={() => onFilter("all")} />
          <StatusFilter
            active={filter === "not-connected"}
            count={counts.unconnected}
            label="Not connected"
            onClick={() => onFilter("not-connected")}
            tone="danger"
          />
          <StatusFilter
            active={filter === "connected"}
            count={counts.connected}
            label="Connected"
            onClick={() => onFilter("connected")}
            tone="success"
          />
        </div>
      </section>

      <section className="list-section" aria-labelledby="component-list-heading">
        <div className="section-title-row list-title-row">
          <h2 id="component-list-heading">Components list</h2>
          <span>{visibleItems.length} shown</span>
        </div>

        <label className="search-control">
          <MagnifyingGlass aria-hidden="true" size={17} />
          <span className="sr-only">Search components</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search components"
            type="search"
            value={query}
          />
          {query ? (
            <button aria-label="Clear search" onClick={() => setQuery("")} type="button">
              <X size={14} />
            </button>
          ) : null}
        </label>

        <div className="component-list">
          {visibleItems.length > 0 ? (
            visibleItems.map((item) => (
              <button
                className="component-row"
                key={item.id}
                onClick={() => onOpenComponent(item.id)}
                type="button"
              >
                <StatusIcon status={item.status} />
                <span className="component-copy">
                  <strong>{item.name}</strong>
                  <small>
                    {item.page}
                    {item.status === "needs-attention" ? " · Needs attention" : ""}
                  </small>
                </span>
                <CaretRight aria-hidden="true" className="row-caret" size={17} />
              </button>
            ))
          ) : (
            <div className="empty-list">
              <MagnifyingGlass aria-hidden="true" size={24} />
              <strong>No matching components</strong>
              <span>Try a different name, page, or status.</span>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function ComponentDetail({ component, onBack, onSave }) {
  const [componentName, setComponentName] = useState(component.name.split(" / ")[0]);
  const [importPath, setImportPath] = useState("@tashil/ui");
  const [storybookUrl, setStorybookUrl] = useState(
    component.status === "connected" ? "https://storybook.tashil.dev/" : "",
  );
  const [sourcePath, setSourcePath] = useState(
    `src/components/${componentName}/${componentName}.tsx`,
  );
  const [saved, setSaved] = useState(false);

  function submit(event) {
    event.preventDefault();
    setSaved(true);
    onSave(component.id);
  }

  return (
    <form className="detail-view" onSubmit={submit}>
      <div className="detail-heading">
        <button aria-label="Back to components" className="icon-button" onClick={onBack} type="button">
          <ArrowLeft size={18} />
        </button>
        <div>
          <span>{component.page}</span>
          <h1>{component.name}</h1>
        </div>
      </div>

      <div className={`connection-banner ${component.status === "connected" || saved ? "success" : component.status === "needs-attention" ? "attention" : "neutral"}`}>
        <StatusIcon status={saved ? "connected" : component.status} size={18} />
        <div>
          <strong>{saved || component.status === "connected" ? "Connected" : component.status === "needs-attention" ? "Connection needs attention" : "Not connected"}</strong>
          <span>{saved ? "Connection saved in this preview." : component.status === "needs-attention" ? "Review the stored source information." : "Add its production component details."}</span>
        </div>
      </div>

      <div className="form-fields">
        <label>
          <span>Component name</span>
          <input onChange={(event) => setComponentName(event.target.value)} required value={componentName} />
        </label>
        <label>
          <span>Import path</span>
          <input onChange={(event) => setImportPath(event.target.value)} required value={importPath} />
        </label>
        <label>
          <span>Storybook URL</span>
          <input
            onChange={(event) => setStorybookUrl(event.target.value)}
            placeholder="https://storybook.example.com/..."
            type="url"
            value={storybookUrl}
          />
        </label>
        <label>
          <span>Source path</span>
          <input onChange={(event) => setSourcePath(event.target.value)} value={sourcePath} />
        </label>
        <button className="mapping-card" type="button">
          <span>
            <strong>Prop mappings</strong>
            <small>Generate from this main component</small>
          </span>
          <CaretRight size={17} />
        </button>
      </div>

      <footer className="detail-footer">
        <button className="secondary-button" onClick={onBack} type="button">Cancel</button>
        <button className="primary-button" type="submit">{saved ? "Saved" : "Save connection"}</button>
      </footer>
    </form>
  );
}

function InspectCodeView({ onGoToComponents }) {
  return (
    <main className="inspect-empty">
      <div className="inspect-icon"><Code aria-hidden="true" size={28} /></div>
      <h1>Choose a connected component</h1>
      <p>Select one from the Components tab to preview its generated code.</p>
      <button className="primary-button" onClick={onGoToComponents} type="button">Browse components</button>
    </main>
  );
}

function HelpPopover({ onClose }) {
  return (
    <div className="help-popover" role="dialog" aria-label="How component scanning works">
      <button aria-label="Close help" className="icon-button" onClick={onClose} type="button"><X size={16} /></button>
      <strong>How component scanning works</strong>
      <p>Tashil scans local main components and component sets across this file. Library components and instances are not included.</p>
    </div>
  );
}

export function App() {
  const [catalog, setCatalog] = useState(initialCatalog);
  const [filter, setFilter] = useState("all");
  const [helpOpen, setHelpOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(true);
  const [progress, setProgress] = useState(1);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState("components");

  useEffect(() => {
    if (!isScanning) return undefined;
    setProgress(1);
    const interval = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 12) {
          window.clearInterval(interval);
          window.setTimeout(() => setIsScanning(false), 220);
          return 12;
        }
        return current + 1;
      });
    }, 90);
    return () => window.clearInterval(interval);
  }, [isScanning]);

  const selectedComponent = catalog.find((item) => item.id === selectedId);

  function saveComponent(id) {
    setCatalog((current) =>
      current.map((item) => (item.id === id ? { ...item, status: "connected" } : item)),
    );
  }

  function openComponent(id) {
    setSelectedId(id);
    setHelpOpen(false);
  }

  return (
    <div className="prototype-stage">
      <section className="plugin-window" aria-label="Tashil Code component connection prototype">
        <header className="window-titlebar">
          <strong>Tashil Code</strong>
          <button aria-label="Close preview" className="window-close" type="button"><X size={22} /></button>
        </header>

        <div className="plugin-tabs">
          <div className="tab-list" role="tablist" aria-label="Tashil Code workflow">
            <button
              aria-selected={tab === "components"}
              className={tab === "components" ? "active" : ""}
              onClick={() => {
                setTab("components");
                setSelectedId(null);
              }}
              role="tab"
              type="button"
            >
              Components
            </button>
            <button
              aria-selected={tab === "inspect"}
              className={tab === "inspect" ? "active" : ""}
              onClick={() => {
                setTab("inspect");
                setSelectedId(null);
              }}
              role="tab"
              type="button"
            >
              Inspect Code
            </button>
          </div>
          <button
            aria-expanded={helpOpen}
            aria-label="Open how it works"
            className="icon-button"
            onClick={() => setHelpOpen((open) => !open)}
            type="button"
          >
            <Question size={19} weight="bold" />
          </button>
          {helpOpen ? <HelpPopover onClose={() => setHelpOpen(false)} /> : null}
        </div>

        <div className="window-content">
          {tab === "inspect" ? (
            <InspectCodeView onGoToComponents={() => setTab("components")} />
          ) : selectedComponent ? (
            <ComponentDetail
              component={selectedComponent}
              key={selectedComponent.id}
              onBack={() => setSelectedId(null)}
              onSave={saveComponent}
            />
          ) : isScanning ? (
            <Scanner progress={progress} />
          ) : (
            <ComponentsHome
              catalog={catalog}
              filter={filter}
              onFilter={setFilter}
              onOpenComponent={openComponent}
              onRescan={() => setIsScanning(true)}
              query={query}
              setQuery={setQuery}
            />
          )}
        </div>
      </section>
    </div>
  );
}
