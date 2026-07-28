import { useMemo, useState } from "react";
import {
  ArrowLeft,
  CaretDown,
  CaretRight,
  CaretUp,
  Check,
  CheckCircle,
  Circle,
  Code,
  Copy,
  FigmaLogo,
  FunnelSimple,
  MagicWand,
  MinusCircle,
  SlidersHorizontal,
  Warning,
} from "@phosphor-icons/react";

const CODE_VALUES = ["primary", "danger", "neutral"];
const FIGMA_VALUES = ["Primary", "Danger", "Neutral"];

function LogoMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Code size={17} weight="bold" />
    </span>
  );
}

function Progress({ compact = false }) {
  return (
    <div className={compact ? "progress compact" : "progress"}>
      <span><strong>6 of 8</strong> resolved</span>
      <span className="progress-track" aria-label="Six of eight mappings resolved">
        <span />
      </span>
      <span className="attention">2 need attention</span>
    </div>
  );
}

function ModeButtons({ mode, onChange, compact = false }) {
  return (
    <div className={compact ? "mode-buttons compact" : "mode-buttons"}>
      <button className={mode === "figma" ? "selected" : ""} onClick={() => onChange("figma")}>
        <FigmaLogo size={18} weight="fill" /> From Figma
      </button>
      <button className={mode === "code" ? "selected" : ""} onClick={() => onChange("code")}>
        <Code size={18} /> Set in code
      </button>
      <button className={mode === "omit" ? "selected" : ""} onClick={() => onChange("omit")}>
        <MinusCircle size={18} /> Omit
      </button>
    </div>
  );
}

function PreviewOne() {
  const [filter, setFilter] = useState("attention");
  const [mode, setMode] = useState("figma");
  const [disabledOpen, setDisabledOpen] = useState(false);
  const [figmaValues, setFigmaValues] = useState(FIGMA_VALUES);
  const [saved, setSaved] = useState(false);

  function setValue(index, value) {
    setFigmaValues((current) => current.map((item, itemIndex) => (
      itemIndex === index ? value : item
    )));
    setSaved(false);
  }

  return (
    <section className="preview preview-one" aria-label="Preview 1 guided review queue">
      <header className="panel-header">
        <h1>Connect Button</h1>
        <p>Button.tsx · 8 props detected</p>
      </header>

      <div className="panel-main">
        <Progress />

        <div className="review-tabs" role="tablist" aria-label="Mapping review filters">
          <button
            className={filter === "attention" ? "active attention-tab" : ""}
            onClick={() => setFilter("attention")}
          >
            <Warning size={18} weight="fill" /> Needs attention
          </button>
          <button className={filter === "suggested" ? "active" : ""} onClick={() => setFilter("suggested")}>
            <MagicWand size={18} /> Suggested
          </button>
          <button className={filter === "resolved" ? "active" : ""} onClick={() => setFilter("resolved")}>
            <CheckCircle size={18} /> Resolved
          </button>
        </div>

        {filter !== "attention" ? (
          <div className="filter-message">
            {filter === "suggested" ? (
              <>
                <MagicWand size={24} />
                <strong>2 suggested mappings</strong>
                <span>Review the matches before saving.</span>
                <button onClick={() => setFilter("attention")}>Review intent</button>
              </>
            ) : (
              <>
                <CheckCircle size={24} weight="fill" />
                <strong>6 mappings resolved</strong>
                <span>These mappings are ready to save.</span>
                <button onClick={() => setFilter("attention")}>Show unresolved</button>
              </>
            )}
          </div>
        ) : (
          <>
            <article className="guided-prop open">
              <div className="guided-prop-head">
                <span className="step-number warning-step">1</span>
                <strong>intent</strong>
                <code>primary | danger | neutral</code>
                <CaretUp size={17} />
              </div>

              <div className="guided-prop-body">
                <h2>Where does intent come from?</h2>
                <ModeButtons mode={mode} onChange={(next) => { setMode(next); setSaved(false); }} />

                {mode === "figma" && (
                  <div className="source-card">
                    <button className="source-summary-button">
                      <span className="figma-square"><FigmaLogo size={22} weight="fill" /></span>
                      <span className="source-title"><strong>Intent</strong><small>Variant</small></span>
                      <span className="source-path">Button / Intent</span>
                      <span className="match-pill">Strong match</span>
                      <CaretDown size={16} />
                    </button>

                    <div className="alignment">
                      <div className="alignment-head">
                        <span>Code value</span><span>←</span><span>Figma value</span>
                      </div>
                      {CODE_VALUES.map((codeValue, index) => (
                        <div className="alignment-row" key={codeValue}>
                          <div className="select-display">{codeValue}<CaretDown size={14} /></div>
                          <ArrowLeft size={15} />
                          <label>
                            <span className="sr-only">Figma value for {codeValue}</span>
                            <select value={figmaValues[index]} onChange={(event) => setValue(index, event.target.value)}>
                              {FIGMA_VALUES.map((value) => <option key={value}>{value}</option>)}
                            </select>
                          </label>
                        </div>
                      ))}
                      <p>Values in code will use the corresponding Figma variant.</p>
                    </div>
                  </div>
                )}

                {mode === "code" && (
                  <div className="inline-choice">
                    <Code size={22} />
                    <div><strong>Set this value in application code</strong><span>The generated component will leave intent for the developer.</span></div>
                  </div>
                )}

                {mode === "omit" && (
                  <div className="inline-choice">
                    <MinusCircle size={22} />
                    <div><strong>Omit intent from generated code</strong><span>The component default will be used.</span></div>
                  </div>
                )}
              </div>
            </article>

            <article className={`guided-prop ${disabledOpen ? "open" : ""}`}>
              <button className="collapsed-row" onClick={() => setDisabledOpen((value) => !value)}>
                <span className="step-number suggested-step">2</span>
                <span><strong>disabled:</strong> boolean</span>
                <span className="suggested-label"><MagicWand size={16} /> Suggested · Disabled</span>
                {disabledOpen ? <CaretUp size={17} /> : <CaretDown size={17} />}
              </button>
              {disabledOpen && (
                <div className="disabled-detail">
                  <p><strong>disabled</strong> will come from the Figma boolean property <strong>Disabled</strong>.</p>
                  <button onClick={() => setDisabledOpen(false)}>Accept suggestion</button>
                </div>
              )}
            </article>
          </>
        )}
      </div>

      <footer className="panel-footer">
        <button className="secondary"><ArrowLeft size={16} /> Back</button>
        <span className={saved ? "saved-message" : "attention"}>{saved ? "Draft saved" : "2 need attention"}</span>
        <button className="primary" onClick={() => setSaved(true)}>Save draft</button>
      </footer>
    </section>
  );
}

const PROP_ROWS = [
  { name: "children", type: "ReactNode", detail: "Content rendered inside", status: "resolved", value: "Label" },
  { name: "intent", type: "primary | danger | neutral", detail: "Visual intent of the button", status: "attention" },
  { name: "disabled", type: "boolean", detail: "When true, the button is disabled", status: "suggested" },
  { name: "renderLeftIcon", type: "ReactNode", detail: "Icon displayed before the label", status: "unresolved" },
  { name: "renderRightIcon", type: "ReactNode", detail: "Icon displayed after the label", status: "unresolved" },
  { name: "size", type: "sm | md | lg", detail: "Controls the button size", status: "unresolved" },
  { name: "fullWidth", type: "boolean", detail: "Expands button to fill container", status: "unresolved" },
  { name: "isLoading", type: "boolean", detail: "Shows loading indicator", status: "unresolved" },
];

const CANDIDATES = [
  { name: "Intent", kind: "Variant property", path: "Button / Intent", sample: "Primary", reason: "Names and values match", quality: "high" },
  { name: "State", kind: "Variant property", path: "Button / State", sample: "Default", reason: "Low confidence", quality: "low" },
  { name: "Emphasis", kind: "Variant property", path: "Button / Emphasis / Level", sample: "High", reason: "Names don’t match", quality: "none" },
];

function StatusDot({ status }) {
  if (status === "resolved") return <CheckCircle className="status resolved" size={21} />;
  if (status === "suggested") return <Circle className="status suggested" size={21} />;
  if (status === "attention") return <Circle className="status attention-status" size={21} weight="duotone" />;
  return <Circle className="status unresolved" size={21} />;
}

function PreviewTwo() {
  const [propFilter, setPropFilter] = useState("all");
  const [activeProp, setActiveProp] = useState("intent");
  const [mode, setMode] = useState("figma");
  const [candidate, setCandidate] = useState("Intent");
  const [codeValues, setCodeValues] = useState(CODE_VALUES);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const visibleProps = useMemo(() => (
    propFilter === "review"
      ? PROP_ROWS.filter((row) => row.status === "attention" || row.status === "suggested")
      : PROP_ROWS
  ), [propFilter]);

  function updateCodeValue(index, value) {
    setCodeValues((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
    setSaved(false);
  }

  return (
    <section className="preview preview-two" aria-label="Preview 2 source and design workbench">
      <header className="workbench-brand">
        <div className="brand"><LogoMark /><strong>TASHIL</strong><span>Code</span></div>
        <div className="brand-divider" />
        <span>Source-and-Design Workbench</span>
      </header>

      <div className="workbench-header">
        <div><h1>Connect Button</h1><span className="source-chip"><Code size={16} /> Button.tsx</span></div>
        <Progress compact />
        <button className="outline-button" onClick={() => setSaved(false)}>Replace source</button>
      </div>

      <div className="workbench">
        <aside className="prop-pane">
          <div className="prop-pane-head">
            <h2>Code props</h2>
            <div className="list-tools">
              <div className="small-tabs">
                <button className={propFilter === "all" ? "active" : ""} onClick={() => setPropFilter("all")}>All</button>
                <button className={propFilter === "review" ? "active" : ""} onClick={() => setPropFilter("review")}>Needs review</button>
              </div>
              <SlidersHorizontal size={19} />
            </div>
          </div>
          <div className="prop-rows">
            {visibleProps.map((row) => (
              <button
                className={`prop-list-row ${activeProp === row.name ? "active" : ""}`}
                key={row.name}
                onClick={() => { setActiveProp(row.name); setSaved(false); }}
              >
                <StatusDot status={row.status} />
                <span className="prop-copy">
                  <strong>{row.name}: <span>{row.type}</span></strong>
                  <small>{row.detail}</small>
                </span>
                {row.value && <span className="value-pill">{row.value}</span>}
                {row.status === "attention" && <span className="attention-pill">Needs review</span>}
                {row.status === "suggested" && <span className="suggested-pill">Suggested</span>}
                <CaretRight size={17} />
              </button>
            ))}
          </div>
        </aside>

        <main className="mapping-pane">
          {activeProp !== "intent" ? (
            <div className="alternate-prop">
              <StatusDot status={PROP_ROWS.find((row) => row.name === activeProp)?.status ?? "unresolved"} />
              <h2>{activeProp}</h2>
              <p>This comparison prototype fully demonstrates the intent mapping. Select intent to return to the active workflow.</p>
              <button onClick={() => setActiveProp("intent")}>Return to intent</button>
            </div>
          ) : (
            <>
              <div className="mapping-title"><h2>intent</h2><p>Choose the design value that supplies this prop.</p></div>
              <ModeButtons compact mode={mode} onChange={(next) => { setMode(next); setSaved(false); }} />

              {mode === "figma" ? (
                <>
                  <div className="candidate-heading">
                    <strong>Figma sources</strong>
                    <button><FunnelSimple size={15} /> Best match <CaretDown size={13} /></button>
                  </div>
                  <div className="candidate-list">
                    {CANDIDATES.map((item) => (
                      <button
                        className={`candidate ${candidate === item.name ? "selected" : ""}`}
                        key={item.name}
                        onClick={() => { setCandidate(item.name); setSaved(false); }}
                      >
                        <span className="radio">{candidate === item.name && <span />}</span>
                        <FigmaLogo className="candidate-figma" size={19} weight="fill" />
                        <span className="candidate-copy"><strong>{item.name}</strong><small>{item.kind}</small><em>{item.path}</em></span>
                        <span className="candidate-meta"><span className="figma-tag">Figma</span><span className="sample-tag">{item.sample}</span><small className={item.quality}>{item.reason} {item.quality === "high" && <CheckCircle size={13} weight="fill" />}</small></span>
                      </button>
                    ))}
                  </div>

                  <div className="align-section">
                    <h3>Align values</h3>
                    <div className="align-table">
                      <div className="align-table-head"><span>Figma value</span><span>Code value</span><span /></div>
                      {FIGMA_VALUES.map((figmaValue, index) => (
                        <div className="align-table-row" key={figmaValue}>
                          <span>{figmaValue}</span>
                          <label>
                            <span className="sr-only">Code value for {figmaValue}</span>
                            <select value={codeValues[index]} onChange={(event) => updateCodeValue(index, event.target.value)}>
                              {CODE_VALUES.map((value) => <option key={value}>{value}</option>)}
                            </select>
                          </label>
                          <CheckCircle size={18} />
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="workbench-mode-message">
                  {mode === "code" ? <Code size={26} /> : <MinusCircle size={26} />}
                  <strong>{mode === "code" ? "Set intent in application code" : "Omit intent from generated code"}</strong>
                  <p>{mode === "code" ? "The developer will supply this value at runtime." : "The component’s default intent will be used."}</p>
                </div>
              )}

              <div className="live-preview">
                <div><h3>Live preview</h3><p>Preview updates with your choices.</p></div>
                <pre>{mode === "figma" ? `<Button intent="${codeValues[0]}">Continue</Button>` : mode === "code" ? "<Button intent={runtimeIntent}>Continue</Button>" : "<Button>Continue</Button>"}</pre>
                <button
                  aria-label="Copy code preview"
                  onClick={() => { navigator.clipboard?.writeText(`<Button intent="${codeValues[0]}">Continue</Button>`); setCopied(true); }}
                >
                  {copied ? <Check size={18} /> : <Copy size={18} />}
                </button>
              </div>
            </>
          )}
        </main>
      </div>

      <footer className="workbench-footer">
        <span className={saved ? "saved-message" : "attention"}>{saved ? "Connection saved" : <><Warning size={17} /> 2 need attention</>}</span>
        <div><button className="secondary">Back</button><button className="primary" onClick={() => setSaved(true)}>Save connection</button></div>
      </footer>
    </section>
  );
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  const embedded = params.get("embed") === "1";
  const [preview, setPreview] = useState(params.get("preview") === "two" ? "two" : "one");

  return (
    <main className={`prototype-shell ${embedded ? "embed" : ""}`}>
      <nav className="comparison-nav" aria-label="Choose redesign preview">
        <div>
          <LogoMark />
          <span><strong>Connect props redesign</strong><small>Standalone HTML comparison</small></span>
        </div>
        <div className="preview-switcher">
          <button className={preview === "one" ? "active" : ""} onClick={() => setPreview("one")}>Preview 1 · Guided</button>
          <button className={preview === "two" ? "active" : ""} onClick={() => setPreview("two")}>Preview 2 · Workbench</button>
        </div>
      </nav>
      <div className={`preview-stage ${preview === "two" ? "wide" : ""}`}>
        {preview === "one" ? <PreviewOne /> : <PreviewTwo />}
      </div>
    </main>
  );
}
