import { Fragment, h } from 'preact';
import { useState } from 'preact/hooks';
import {
  IconComponentProperty16,
  IconInstance16,
  IconText16,
  IconVariant16,
} from '@create-figma-plugin/ui';
import { renderImportLines } from './layout/imports';
import {
  OPTION_OMITTED,
  OPTION_RUNTIME,
  OPTION_STATIC,
  SECTION_LABELS,
  buildTargetRows,
  getUsedSourceOptionIds,
  hasStructuralMismatch,
  nestedOptionId,
  propertyOptionId,
  validateRecipeDraft,
  type SemanticTargetRow,
} from './semantic/authoring';
import { resolveSemanticUsage } from './semantic/resolver';
import {
  isRemoveOnly,
  type ReconciliationAction,
  type ReconciliationProposal,
} from './semantic/reconcile';
import type { SemanticConnectionRecipe } from './semantic/types';
import type { SourceTargetDescriptor } from './semantic/source-contract';
import type { FigmaComponentSnapshot, SourcePropValue } from './types';

export type SemanticMappingViewProps = {
  componentName: string;
  importPath: string;
  disabled: boolean;
  error?: string;
  figmaSnapshot?: FigmaComponentSnapshot;
  recipe?: SemanticConnectionRecipe;
  proposals?: readonly ReconciliationProposal[];
  onApplyProposal?: (proposal: ReconciliationProposal, action: ReconciliationAction) => void;
  onExportDebugBundle?: () => void;
  onValueMappingChange?: (
    targetPath: readonly string[],
    sourceValue: SourcePropValue,
    figmaOption: string,
  ) => void;
  /** Replace the uploaded source from inside the single mapping card. */
  onFilesSelected?: (files: readonly File[]) => void;
  sourceUploading?: boolean;
  onOptionChange: (
    targetPath: readonly string[],
    optionId: string,
    staticValue?: SourcePropValue,
  ) => void;
};

/**
 * Implementation mapping editor (semantic connect, roadmap M3).
 *
 * Code props stay the primary column; every target gets exactly one
 * searchable value control listing eligible Figma values, static, runtime,
 * and omitted choices. Structural mismatch is an informational note, never an
 * error. A live preview shows the generated usage before save.
 */
export function SemanticMappingView(props: SemanticMappingViewProps): h.JSX.Element | null {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string>();
  const [pendingKind, setPendingKind] = useState<{ path: string; kind: SourceKind }>();
  const recipe = props.recipe;
  if (!recipe?.sourceContract) {
    return null;
  }

  const rows = buildTargetRows(recipe, props.figmaSnapshot);
  const validation = validateRecipeDraft(recipe);
  const contract = recipe.sourceContract;
  const preview = createPreview(props.componentName, props.importPath, recipe);
  const uploadDisabled = props.disabled || props.sourceUploading === true;

  // The board's focus: which code prop is being edited. Defaults to the first
  // prop that still needs a decision so the page opens on real work.
  const firstUnresolved = rows.find((row) => row.optionId === '' && row.target.required)
    ?? rows.find((row) => row.optionId === '');
  const activePath = selectedPath ?? firstUnresolved?.targetPath ?? rows[0]?.targetPath;
  const selectedRow = rows.find((row) => row.targetPath === activePath);

  // What kind of source the focused prop uses: its saved choice, or the one
  // the user just asked for while the detail is still being filled in.
  const activeKind: SourceKind = (selectedRow ? kindOfRow(selectedRow) : undefined)
    ?? (pendingKind?.path === activePath ? pendingKind.kind : undefined)
    ?? 'figma';

  const usedSources = getUsedSourceOptionIds(recipe);
  const compatibleIds = activeKind === 'figma'
    ? new Set((selectedRow?.options ?? []).map((option) => option.id))
    : new Set<string>();
  const figmaItems = buildFigmaInventory(
    props.figmaSnapshot,
    recipe.figmaSnapshot,
    usedSources,
    compatibleIds,
  );
  const unusedSourceCount = figmaItems.filter((item) => !item.used).length;

  function submitFiles(files: readonly File[]): void {
    if (!uploadDisabled && files.length > 0) {
      props.onFilesSelected?.(files);
    }
  }

  let previousSection: SemanticTargetRow['section'] | undefined;

  return (
    <section
      aria-labelledby="tashil-semantic-heading"
      class={isDragging ? 'mapping-editor mapping-editor-dragging' : 'mapping-editor'}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!uploadDisabled && props.onFilesSelected) setIsDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsDragging(false);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        submitFiles(Array.from(event.dataTransfer?.files ?? []));
      }}
    >
      <div class="mapping-editor-heading-row">
        <div>
          <div class="field-label" id="tashil-semantic-heading">Implementation mapping</div>
          <div class="mapping-help">
            Connect each code prop of the public API to the design value that feeds it.
          </div>
        </div>
        {props.onFilesSelected ? (
          <label class={uploadDisabled ? 'file-button file-button-disabled' : 'file-button'}>
            {props.sourceUploading ? 'Analyzing…' : 'Replace source'}
            <input
              accept=".ts,.tsx"
              disabled={uploadDisabled}
              multiple
              onInput={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                if (!uploadDisabled && files.length > 0) {
                  props.onFilesSelected?.(files);
                }
                event.currentTarget.value = '';
              }}
              type="file"
            />
          </label>
        ) : null}
      </div>

      <div class="source-summary">
        <span class="source-icon" aria-hidden="true">{'</>'}</span>
        <span>
          <strong>{contract.componentName}</strong>
          <small>
            Code target · <span class="source-file">{contract.fileName}</span>
            {validation.progress.total > 0
              ? ` · ${validation.progress.completed}/${validation.progress.total} required values resolved`
              : ''}
          </small>
        </span>
      </div>

      {props.proposals && props.proposals.length > 0 ? (
        <ReconciliationPanel
          disabled={props.disabled}
          onApplyProposal={props.onApplyProposal}
          proposals={props.proposals}
        />
      ) : null}

      {hasStructuralMismatch(recipe) ? (
        <div class="mapping-help" role="note">
          The Figma layers and the code structure differ. That is expected: values from
          nested design regions feed the real component props below.
        </div>
      ) : null}

      <div class="connect-board">
        <div class="board-side">
          <div class="board-head">
            <span class="side-tag side-figma">Figma</span>
            <strong>{recipe.figmaSnapshot.componentName}</strong>
            <small>
              {unusedSourceCount === 0
                ? 'all values used'
                : `${unusedSourceCount} unused`}
            </small>
          </div>
          {selectedRow ? (
            <div class="board-hint">
              {activeKind !== 'figma'
                ? <span><b>{selectedRow.targetPath}</b> is not using a Figma value.</span>
                : compatibleIds.size === 0
                  ? <span>Nothing here can feed <b>{selectedRow.targetPath}</b>.</span>
                  : <span>Click a value to connect it to <b>{selectedRow.targetPath}</b>.</span>}
            </div>
          ) : null}
          <div class="board-list">
            {figmaItems.length === 0 ? (
              <div class="board-empty">This component exposes no mappable values.</div>
            ) : figmaItems.map((item) => (
              <Fragment key={item.id}>
                {item.groupLabel ? (
                  <div class="mapping-section-label">{item.groupLabel}</div>
                ) : null}
                <button
                  class="board-row"
                  data-selected={selectedRow?.optionId === item.id ? 'true' : undefined}
                  data-used={item.used ? 'true' : undefined}
                  disabled={props.disabled || !item.selectable}
                  onClick={() => {
                    if (selectedRow) {
                      props.onOptionChange(selectedRow.target.path, item.id);
                    }
                  }}
                  title={item.selectable
                    ? `Connect "${item.label}" to ${selectedRow?.targetPath ?? ''}`
                    : 'Not compatible with the selected code prop'}
                  type="button"
                >
                  <span class="board-row-icon" aria-hidden="true">{item.icon}</span>
                  <span class="board-row-text">
                    <span class="board-row-name">{item.label}</span>
                    {item.detail ? (
                      <span class="board-row-detail">{item.detail}</span>
                    ) : null}
                  </span>
                  {item.used ? <span class="board-flag">used</span> : null}
                </button>
              </Fragment>
            ))}
          </div>
        </div>

        <div class="board-side">
          <div class="board-head">
            <span class="side-tag side-code">Code</span>
            <strong>{contract.componentName}</strong>
            <small>
              {validation.progress.total > 0
                ? `${validation.progress.completed} of ${validation.progress.total} required`
                : `${rows.length} props`}
            </small>
          </div>
          <div class="board-list">
            {rows.map((row) => {
              const sectionLabel = row.section !== previousSection
                ? SECTION_LABELS[row.section]
                : undefined;
              previousSection = row.section;
              return (
                <Fragment key={row.targetPath}>
                  {sectionLabel ? (
                    <div class="mapping-section-label">{sectionLabel}</div>
                  ) : null}
                  <button
                    class="board-row"
                    data-selected={row.targetPath === activePath ? 'true' : undefined}
                    disabled={props.disabled}
                    onClick={() => setSelectedPath(row.targetPath)}
                    type="button"
                  >
                    <span class="dot-status" data-state={targetState(row)} />
                    <span class="board-row-text">
                      <span class="board-row-name">{row.targetPath}</span>
                      <span class="board-row-detail">{describeRowValue(row)}</span>
                    </span>
                  </button>
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {selectedRow ? (
        <SemanticTargetRowView
          disabled={props.disabled}
          kind={activeKind}
          onKindChange={(kind) => {
            setPendingKind({ kind, path: selectedRow.targetPath });
            if (kind === 'runtime' || kind === 'omitted') {
              props.onOptionChange(
                selectedRow.target.path,
                kind === 'runtime' ? OPTION_RUNTIME : OPTION_OMITTED,
              );
            } else if (kind === 'static') {
              props.onOptionChange(
                selectedRow.target.path,
                OPTION_STATIC,
                selectedRow.staticValue ?? allowedStaticValues(selectedRow.target)[0] ?? '',
              );
            } else {
              // Back to Figma: clear the non-design choice so the board picks.
              props.onOptionChange(selectedRow.target.path, '');
            }
          }}
          onOptionChange={props.onOptionChange}
          onValueMappingChange={props.onValueMappingChange}
          row={selectedRow}
        />
      ) : null}

      {validation.errors.length > 0 ? (
        <ul class="field-error" role="list">
          {validation.errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      ) : null}
      {validation.warnings.length > 0 ? (
        <ul class="mapping-help" role="list">
          {validation.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
      {props.error ? (
        <div class="field-error" id="tashil-semantic-recipe-error">{props.error}</div>
      ) : null}

      {preview ? (
        <details class="advanced-mappings" open>
          <summary>Generated code preview</summary>
          <pre aria-label="Generated semantic usage preview" class="generated-json-preview">
            {preview}
          </pre>
        </details>
      ) : null}

      {props.onExportDebugBundle ? (
        <div class="mapping-card-footer">
          <button
            class="link-button"
            disabled={props.disabled}
            onClick={props.onExportDebugBundle}
            title="Records schema versions, mapping structure, and health only — no source code, URLs, design text, or layer names."
            type="button"
          >
            Export debug bundle
          </button>
          <small>Redacted: structure and health only.</small>
        </div>
      ) : null}
    </section>
  );
}

type FigmaInventoryItem = {
  id: string;
  label: string;
  detail?: string;
  icon: h.JSX.Element;
  /** Already consumed by some binding. */
  used: boolean;
  /** Valid for the code prop currently in focus, so clicking connects it. */
  selectable: boolean;
  groupLabel?: string;
};

/**
 * The Figma side of the board: what this component actually offers, in Figma's
 * own vocabulary. Showing it whole is the point — an unused property here is
 * information ("the design has a State variant nobody mapped"), which a
 * dropdown of options can never convey.
 */
function buildFigmaInventory(
  figmaSnapshot: FigmaComponentSnapshot | undefined,
  semanticSnapshot: SemanticConnectionRecipe['figmaSnapshot'],
  usedSources: ReadonlySet<string>,
  compatibleIds: ReadonlySet<string>,
): FigmaInventoryItem[] {
  const items: FigmaInventoryItem[] = [];

  (figmaSnapshot?.properties ?? []).forEach((property, index) => {
    const id = propertyOptionId(property);
    items.push({
      icon: property.type === 'VARIANT' ? <IconVariant16 /> : <IconComponentProperty16 />,
      id,
      label: property.name,
      selectable: compatibleIds.has(id),
      used: usedSources.has(id),
      ...(property.options.length > 0
        ? { detail: property.options.join(' · ') }
        : { detail: property.type.toLowerCase() }),
      ...(index === 0 ? { groupLabel: 'Properties' } : {}),
    });
  });

  semanticSnapshot.nestedSources.forEach((descriptor, index) => {
    const id = nestedOptionId(descriptor);
    items.push({
      icon: descriptor.kind === 'nested-instance'
        ? <IconInstance16 />
        : descriptor.kind === 'nested-text' ? <IconText16 /> : <IconComponentProperty16 />,
      id,
      label: descriptor.displayPath,
      selectable: compatibleIds.has(id),
      used: usedSources.has(id),
      ...(descriptor.sampleValue !== undefined ? { detail: descriptor.sampleValue } : {}),
      ...(index === 0 ? { groupLabel: 'Inside the component' } : {}),
    });
  });

  return items;
}

/** Status of a code prop, for the dot beside its name. */
function targetState(row: SemanticTargetRow): 'done' | 'todo' | 'blocked' {
  if (row.optionId !== '') {
    return 'done';
  }
  return row.target.required && row.target.kind === 'visual' ? 'blocked' : 'todo';
}

/** One-line answer to "what does this prop resolve to right now?". */
function describeRowValue(row: SemanticTargetRow): string {
  if (row.optionId === OPTION_RUNTIME) {
    return 'set in application';
  }
  if (row.optionId === OPTION_OMITTED) {
    return 'omitted';
  }
  if (row.optionId === OPTION_STATIC) {
    return `static · ${String(row.staticValue ?? '')}`;
  }
  const option = row.options.find((candidate) => candidate.id === row.optionId);
  return option ? option.label : 'not mapped';
}

/**
 * Suggested remaps for design/source drift, presented separately from the
 * confirmed mapping rows. Every change is explicit: safe remaps offer Accept,
 * unmappable ones offer only Remove, and nothing is applied automatically.
 */
function ReconciliationPanel(props: {
  disabled: boolean;
  onApplyProposal?: (proposal: ReconciliationProposal, action: ReconciliationAction) => void;
  proposals: readonly ReconciliationProposal[];
}): h.JSX.Element {
  return (
    <section
      aria-labelledby="tashil-semantic-reconcile-heading"
      class="connection-health connection-health-needs-review"
    >
      <div class="connection-health-heading">
        <strong id="tashil-semantic-reconcile-heading">Changes need review</strong>
      </div>
      <ul>
        {props.proposals.map((proposal) => {
          const removeOnly = isRemoveOnly(proposal.kind);
          return (
            <li key={`${proposal.bindingId}-${proposal.kind}`}>
              <span>{proposal.message}</span>
              <div class="connection-health-actions">
                {!removeOnly ? (
                  <button
                    aria-label={`Accept remap for ${proposal.targetPath}`}
                    disabled={props.disabled}
                    onClick={() => props.onApplyProposal?.(proposal, 'accept')}
                    type="button"
                  >
                    Accept remap
                  </button>
                ) : null}
                <button
                  aria-label={`Remove mapping for ${proposal.targetPath}`}
                  disabled={props.disabled}
                  onClick={() => props.onApplyProposal?.(proposal, 'remove')}
                  type="button"
                >
                  Remove mapping
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The legal values a static entry may take. A prop typed `boolean` or as a
 * literal union has a closed set, so the user picks from it and can never
 * author a value the source type would reject. Open types (`string`, `number`)
 * have no such set and fall back to free text.
 */
function allowedStaticValues(target: SourceTargetDescriptor): readonly SourcePropValue[] {
  return target.values ?? [];
}

/** Recover the typed value behind a select's string option. */
function matchAllowedValue(
  allowed: readonly SourcePropValue[],
  raw: string,
): SourcePropValue {
  return allowed.find((value) => String(value) === raw) ?? raw;
}

type SourceKind = 'figma' | 'static' | 'runtime' | 'omitted';

const KIND_LABELS: Record<SourceKind, string> = {
  figma: 'From Figma',
  omitted: 'Leave out',
  runtime: 'In the app',
  static: 'Fixed value',
};

const KIND_BLURB: Record<SourceKind, string> = {
  figma: 'The value changes with the design.',
  omitted: 'The prop is not written at all.',
  runtime: 'No design value is read. The prop is emitted as undefined with a comment, and listed in Inspect so you know to wire it up.',
  static: 'The same value every time, whatever the design shows.',
};

/** Which kind of source a row currently uses. */
function kindOfRow(row: SemanticTargetRow): SourceKind | undefined {
  if (row.optionId === OPTION_RUNTIME) return 'runtime';
  if (row.optionId === OPTION_STATIC) return 'static';
  if (row.optionId === OPTION_OMITTED) return 'omitted';
  if (row.optionId !== '') return 'figma';
  return undefined;
}

/**
 * The decision surface for one code prop. The user picks *what kind* of source
 * feeds it first — a named choice rather than a dropdown mixing Figma values
 * with "static" and "set in application" — and only then the detail that kind
 * needs. Choosing "From Figma" hands the job to the board on the left, which
 * is the one place Figma values are picked.
 */
function SemanticTargetRowView(props: {
  disabled: boolean;
  onKindChange: (kind: SourceKind) => void;
  onOptionChange: SemanticMappingViewProps['onOptionChange'];
  onValueMappingChange?: SemanticMappingViewProps['onValueMappingChange'];
  kind: SourceKind;
  row: SemanticTargetRow;
}): h.JSX.Element {
  const { row } = props;
  const target = row.target;
  const allowedValues = allowedStaticValues(target);
  const chosen = row.options.find((option) => option.id === row.optionId);
  const kinds: SourceKind[] = target.kind === 'visual' || target.kind === 'node'
    ? (target.required ? ['figma', 'static', 'runtime'] : ['figma', 'static', 'runtime', 'omitted'])
    : target.required ? ['runtime'] : ['runtime', 'omitted'];

  return (
    <div class="detail-panel">
      <div class="detail-head">
        <strong>{row.targetPath}</strong>
        <code>{target.typeName}</code>
        {target.required ? <span class="detail-req">required</span> : null}
      </div>

      {target.kind === 'excluded' ? (
        <p class="mapping-help">Excluded by policy — styling and DOM props stay in application code.</p>
      ) : target.kind === 'unsupported' ? (
        <p class="mapping-help">This type cannot be mapped visually yet.</p>
      ) : (
        <Fragment>
          <p class="detail-question">Where does this value come from?</p>
          <div class="kind-choice" role="group" aria-label={`Value source for ${row.targetPath}`}>
            {kinds.map((kind) => (
              <button
                aria-pressed={props.kind === kind}
                class="kind-button"
                data-on={props.kind === kind ? 'true' : undefined}
                disabled={props.disabled}
                key={kind}
                onClick={() => props.onKindChange(kind)}
                type="button"
              >
                {KIND_LABELS[kind]}
              </button>
            ))}
          </div>
          <p class="detail-blurb">{KIND_BLURB[props.kind]}</p>

          {props.kind === 'figma' ? (
            <div class="detail-body">
              {row.options.length === 0 ? (
                <p class="field-error">
                  Nothing in this Figma component can feed a {target.typeName} prop.
                  Add a matching property or variant in Figma, or choose another source.
                </p>
              ) : chosen ? (
                <p class="detail-chosen">
                  Using <b>{chosen.label}</b>
                  {chosen.detail ? <span class="muted"> · {chosen.detail}</span> : null}
                  {chosen.fragile ? <span class="detail-flag">found by layer name</span> : null}
                </p>
              ) : (
                <p class="detail-cta">
                  Pick one of the {row.options.length} highlighted values on the left.
                </p>
              )}

              {row.valueMappings && row.valueMappings.length > 0 ? (
                <div class="value-mapping-list">
                  <div class="mapping-help">Which Figma option produces each value</div>
                  {row.valueMappings.map((valueRow) => (
                    <div
                      class="value-mapping-row"
                      key={`${row.targetPath}-${String(valueRow.sourceValue)}`}
                    >
                      <code>{String(valueRow.sourceValue)}</code>
                      <span aria-hidden="true">←</span>
                      <label class="select-label">
                        <span class="visually-hidden">
                          Figma option for {row.targetPath} {String(valueRow.sourceValue)}
                        </span>
                        <select
                          disabled={props.disabled}
                          onInput={(event) => props.onValueMappingChange?.(
                            target.path,
                            valueRow.sourceValue,
                            event.currentTarget.value,
                          )}
                          value={valueRow.figmaOption}
                        >
                          <option value="">Not mapped</option>
                          {valueRow.options.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ))}
                </div>
              ) : null}

              {row.suggestion && row.suggestion.optionId === row.optionId ? (
                <p class="mapping-help">Suggested — {row.suggestion.reason} Review before saving.</p>
              ) : null}
            </div>
          ) : null}

          {props.kind === 'static' ? (
            <div class="detail-body">
              <label class="select-label">
                <span class="visually-hidden">Static value for {row.targetPath}</span>
                {allowedValues.length > 0 ? (
                  <select
                    disabled={props.disabled}
                    onInput={(event) => props.onOptionChange(
                      target.path,
                      OPTION_STATIC,
                      matchAllowedValue(allowedValues, event.currentTarget.value),
                    )}
                    value={String(row.staticValue ?? allowedValues[0])}
                  >
                    {allowedValues.map((value) => (
                      <option key={String(value)} value={String(value)}>{String(value)}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    disabled={props.disabled}
                    onInput={(event) => props.onOptionChange(
                      target.path,
                      OPTION_STATIC,
                      event.currentTarget.value,
                    )}
                    placeholder="Value to always use"
                    type="text"
                    value={typeof row.staticValue === 'string'
                      ? row.staticValue
                      : String(row.staticValue ?? '')}
                  />
                )}
              </label>
            </div>
          ) : null}
        </Fragment>
      )}
    </div>
  );
}

function createPreview(
  componentName: string,
  importPath: string,
  recipe: SemanticConnectionRecipe,
): string | undefined {
  if (!/^[A-Z_$][A-Za-z0-9_$]*$/.test(componentName) || importPath.trim() === '') {
    return undefined;
  }

  try {
    const result = resolveSemanticUsage(componentName, importPath.trim(), recipe, {
      componentProperties: createPreviewProperties(recipe),
      samples: recipe.figmaSnapshot,
    });
    return [renderImportLines(result.usage.imports), '', result.usage.jsx].join('\n');
  } catch (_error) {
    return undefined;
  }
}

function createPreviewProperties(
  recipe: SemanticConnectionRecipe,
): Record<string, string | boolean> {
  const properties: Record<string, string | boolean> = Object.create(null) as Record<
    string,
    string | boolean
  >;

  for (const binding of recipe.bindings) {
    if (binding.source.kind !== 'component-property') {
      continue;
    }
    if (binding.transform?.kind === 'enum') {
      const firstOption = Object.keys(binding.transform.map)[0];
      if (firstOption !== undefined) {
        properties[binding.source.propertyName] = firstOption;
      }
    } else {
      properties[binding.source.propertyName] = 'Sample';
    }
  }

  return properties;
}
