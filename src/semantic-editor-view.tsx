import { Fragment, h } from 'preact';
import { useState } from 'preact/hooks';
import {
  IconComponentProperty16,
  IconInstance16,
  IconText16,
  IconVariant16,
  Layer,
  SelectableItem,
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

  const usedSources = getUsedSourceOptionIds(recipe);
  const compatibleIds = new Set((selectedRow?.options ?? []).map((option) => option.id));
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
          <div class="board-list">
            {figmaItems.length === 0 ? (
              <div class="board-empty">This component exposes no mappable values.</div>
            ) : figmaItems.map((item) => (
              <Fragment key={item.id}>
                {item.groupLabel ? (
                  <div class="mapping-section-label">{item.groupLabel}</div>
                ) : null}
                <div
                  class={item.selectable ? 'board-item' : 'board-item board-item-inert'}
                  title={item.selectable
                    ? `Connect to ${selectedRow?.targetPath ?? ''}`
                    : 'Not compatible with the selected code prop'}
                >
                  <Layer
                    bold={item.used}
                    description={item.detail}
                    icon={item.icon}
                    onValueChange={() => {
                      if (item.selectable && !props.disabled && selectedRow) {
                        props.onOptionChange(selectedRow.target.path, item.id);
                      }
                    }}
                    value={selectedRow?.optionId === item.id}
                  >
                    {item.label}
                  </Layer>
                </div>
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
                  <SelectableItem
                    disabled={props.disabled}
                    onValueChange={() => setSelectedPath(row.targetPath)}
                    value={row.targetPath === selectedPath}
                  >
                    <span class="board-target">
                      <span class="board-target-name">
                        <span class="dot-status" data-state={targetState(row)} />
                        {row.targetPath}
                      </span>
                      <span class="board-target-value">{describeRowValue(row)}</span>
                    </span>
                  </SelectableItem>
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {selectedRow ? (
        <SemanticTargetRowView
          disabled={props.disabled}
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

function SemanticTargetRowView(props: {
  disabled: boolean;
  onOptionChange: SemanticMappingViewProps['onOptionChange'];
  onValueMappingChange?: SemanticMappingViewProps['onValueMappingChange'];
  row: SemanticTargetRow;
}): h.JSX.Element {
  const { row } = props;
  const target = row.target;
  const isDesignBindable = target.kind === 'visual';
  const isEvent = target.kind === 'event';
  const showSelect = isDesignBindable || isEvent || target.kind === 'node';
  const allowedValues = allowedStaticValues(target);
  const suggestionActive = row.suggestion !== undefined
    && row.suggestion.optionId === row.optionId
    && row.optionId !== '';

  return (
    <div class="mapping-row">
      <div class="mapping-property-row">
        <div class="source-prop">
          <strong>{row.targetPath}</strong>
          <small>{target.typeName}</small>
          {target.kind === 'excluded' ? (
            <small>Excluded by policy — styling and DOM props stay in application code.</small>
          ) : target.kind === 'unsupported' ? (
            <small>This type cannot be mapped visually yet.</small>
          ) : null}
        </div>
        {showSelect ? (
          <Fragment>
            <span class="mapping-arrow" aria-hidden="true">›</span>
            <label class="select-label">
              <span class="visually-hidden">Value for {row.targetPath}</span>
              <select
                disabled={props.disabled}
                onInput={(event) => {
                  const optionId = event.currentTarget.value;
                  props.onOptionChange(
                    target.path,
                    optionId,
                    optionId === OPTION_STATIC
                      // Seed a type-correct default so a constrained prop never
                      // starts life holding a value its type rejects.
                      ? row.staticValue ?? allowedStaticValues(target)[0] ?? ''
                      : undefined,
                  );
                }}
                value={row.optionId}
              >
                <option value="">Not mapped</option>
                {isDesignBindable && row.options.length > 0 ? (
                  <optgroup label="Figma values">
                    {row.options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                        {option.detail ? ` (${option.detail})` : ''}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {isDesignBindable ? (
                  <option value={OPTION_STATIC}>Static value…</option>
                ) : null}
                <option value={OPTION_RUNTIME}>Set in application</option>
                {!target.required ? (
                  <option value={OPTION_OMITTED}>Omitted</option>
                ) : null}
              </select>
            </label>
          </Fragment>
        ) : null}
      </div>

      {row.valueMappings && row.valueMappings.length > 0 ? (
        <div class="value-mapping-list">
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
                    row.target.path,
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

      {row.optionId === OPTION_STATIC ? (
        <div class="static-value-row">
          <span class="static-value-label" aria-hidden="true">Value</span>
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
                placeholder="Static value"
                type="text"
                value={typeof row.staticValue === 'string'
                  ? row.staticValue
                  : String(row.staticValue ?? '')}
              />
            )}
          </label>
        </div>
      ) : null}

      {suggestionActive ? (
        <small class="mapping-help">Suggested: {row.suggestion!.reason} Review before saving.</small>
      ) : null}
      {row.optionId === OPTION_RUNTIME ? (
        <small class="mapping-help">
          No design value is read. The prop is emitted as <code>undefined</code> with a
          “Set in application.” comment, and listed separately in Inspect so you know to
          wire it up in code.
        </small>
      ) : null}
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
