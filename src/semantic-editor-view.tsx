import { Fragment, h } from 'preact';
import { useState } from 'preact/hooks';
import {
  Dropdown,
  IconApprovedCheckmark16,
  IconComponentProperty16,
  IconDev16,
  IconHidden16,
  IconInfo16,
  IconInstance16,
  IconText16,
  IconVariant16,
  IconWarning16,
  SegmentedControl,
  Textbox,
  type DropdownOption,
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
 * One list of code props. Expanding a prop reveals its decision in place, so
 * the answer is chosen where the question is asked rather than across panes.
 * The choices are the answers themselves — the compatible Figma values and the
 * non-design sources in one grouped set — which is why nothing is ever shown
 * greyed out. "What is unused in Figma?" is an audit question, so it gets one
 * summary line instead of a permanent column.
 */
export function SemanticMappingView(props: SemanticMappingViewProps): h.JSX.Element | null {
  const [isDragging, setIsDragging] = useState(false);
  const [activePath, setActivePath] = useState<string>();
  const [filter, setFilter] = useState<'all' | 'review'>('all');
  const recipe = props.recipe;
  if (!recipe?.sourceContract) {
    return null;
  }

  const rows = buildTargetRows(recipe, props.figmaSnapshot);
  const validation = validateRecipeDraft(recipe);
  const progressRows = rows.filter(({ target }) => (
    target.kind !== 'excluded' && target.kind !== 'unsupported'
  ));
  const progress = {
    completed: progressRows.filter((row) => targetState(row) === 'done').length,
    total: progressRows.length,
  };
  const contract = recipe.sourceContract;
  const preview = createPreview(props.componentName, props.importPath, recipe);
  const uploadDisabled = props.disabled || props.sourceUploading === true;

  const firstUnresolved = rows.find((row) => row.optionId === '' && row.target.required)
    ?? rows.find((row) => row.optionId === '');
  const focusedPath = activePath ?? firstUnresolved?.targetPath ?? rows[0]?.targetPath;
  const focusedRow = rows.find((row) => row.targetPath === focusedPath) ?? rows[0];
  const visibleRows = filter === 'review'
    ? rows.filter((row) => targetState(row) !== 'done')
    : rows;

  const usedSources = getUsedSourceOptionIds(recipe);
  const inventory = buildFigmaInventory(props.figmaSnapshot, recipe.figmaSnapshot);
  const unused = inventory.filter((item) => !usedSources.has(item.id));

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
      <header class="mapping-workbench-header mapping-workbench-header-semantic">
        <div class="mapping-header-source-row">
          <div class="mapping-workbench-source">
            <span class="source-icon" aria-hidden="true">{'</>'}</span>
            <span>
              <strong>{contract.componentName}</strong>
              <small class="source-file">{contract.fileName}</small>
            </span>
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
                  submitFiles(files);
                  event.currentTarget.value = '';
                }}
                type="file"
              />
            </label>
          ) : null}
        </div>
        <div class="mapping-header-summary-row">
          <div class="mapping-workbench-title">
            <div class="field-label" id="tashil-semantic-heading">
              Connect {contract.componentName}
            </div>
            <span class="visually-hidden">Implementation mapping</span>
            <div class="mapping-help">
              Connect code props to Figma, fixed code values, or application behavior.
            </div>
          </div>
          {progress.total > 0 ? (
            <div
              class="mapping-workbench-progress"
              aria-label={`${progress.completed} of ${progress.total} code props resolved`}
            >
              <strong>{progress.completed}/{progress.total}</strong>
              <span>resolved</span>
              <span class="mapping-progress-track" aria-hidden="true">
                <span style={{
                  width: `${Math.round((progress.completed / progress.total) * 100)}%`,
                }} />
              </span>
            </div>
          ) : null}
        </div>
      </header>

      <div class="mapping-workbench-notices">
        {inventory.length > 0 ? (
          <details class="coverage">
            <summary>
              <span class="coverage-tag">Figma</span>
              {unused.length === 0
                ? `All ${inventory.length} design values are mapped`
                : `${unused.length} of ${inventory.length} design values are unused`}
            </summary>
            {unused.length > 0 ? (
              <ul class="coverage-list">
                {unused.map((item) => (
                  <li key={item.id}>
                    <span class="coverage-icon" aria-hidden="true">{item.icon}</span>
                    {item.label}
                    {item.detail ? <span class="muted"> · {item.detail}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </details>
        ) : null}
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
      </div>

      <div class="mapping-workbench">
        <aside class="mapping-workbench-list" aria-label="Code props">
          <div class="mapping-workbench-list-header">
            <div>
              <strong>Code props</strong>
              <span>{rows.length} in the public API</span>
            </div>
            <div class="mapping-filter" role="group" aria-label="Filter code props">
              <button
                aria-pressed={filter === 'all'}
                onClick={() => setFilter('all')}
                type="button"
              >
                All
              </button>
              <button
                aria-pressed={filter === 'review'}
                onClick={() => setFilter('review')}
                type="button"
              >
                Review
              </button>
            </div>
          </div>
          <div class="prop-list">
            {visibleRows.map((row) => {
              const sectionLabel = row.section !== previousSection
                ? SECTION_LABELS[row.section]
                : undefined;
              previousSection = row.section;
              return (
                <Fragment key={row.targetPath}>
                  {sectionLabel ? (
                    <div class="mapping-section-label">{sectionLabel}</div>
                  ) : null}
                  <PropRow
                    active={row.targetPath === focusedPath}
                    onSelect={() => setActivePath(row.targetPath)}
                    row={row}
                  />
                </Fragment>
              );
            })}
            {visibleRows.length === 0 ? (
              <div class="mapping-list-empty">Everything is resolved.</div>
            ) : null}
          </div>
        </aside>

        <main class="mapping-workbench-inspector">
          {focusedRow ? (
            <PropInspector
              disabled={props.disabled}
              onOptionChange={(...args) => {
                setActivePath(focusedRow.targetPath);
                props.onOptionChange(...args);
              }}
              onValueMappingChange={props.onValueMappingChange
                ? (...args) => {
                    setActivePath(focusedRow.targetPath);
                    props.onValueMappingChange?.(...args);
                  }
                : undefined}
              row={focusedRow}
            />
          ) : (
            <div class="mapping-list-empty">No mappable code props were found.</div>
          )}

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
            <section class="mapping-preview">
              <div class="mapping-inspector-label">Live code preview</div>
              <pre aria-label="Generated semantic usage preview" class="generated-json-preview">
                {preview}
              </pre>
            </section>
          ) : null}
        </main>
      </div>

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
};

/**
 * Everything this Figma component offers, in Figma's own vocabulary. Used only
 * to answer the audit question — which design values nothing consumes — since
 * picking a value happens inside the prop that needs it.
 */
function buildFigmaInventory(
  figmaSnapshot: FigmaComponentSnapshot | undefined,
  semanticSnapshot: SemanticConnectionRecipe['figmaSnapshot'],
): FigmaInventoryItem[] {
  const items: FigmaInventoryItem[] = [];

  for (const property of figmaSnapshot?.properties ?? []) {
    items.push({
      detail: property.options.length > 0
        ? property.options.join(' · ')
        : property.type.toLowerCase(),
      icon: property.type === 'VARIANT' ? <IconVariant16 /> : <IconComponentProperty16 />,
      id: propertyOptionId(property),
      label: property.name,
    });
  }

  for (const descriptor of semanticSnapshot.nestedSources) {
    items.push({
      icon: descriptor.kind === 'nested-instance'
        ? <IconInstance16 />
        : descriptor.kind === 'nested-text' ? <IconText16 /> : <IconComponentProperty16 />,
      id: nestedOptionId(descriptor),
      label: descriptor.displayPath,
      ...(descriptor.sampleValue !== undefined ? { detail: descriptor.sampleValue } : {}),
    });
  }

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

/**
 * One code prop: a summary line stating what it resolves to, and — when open —
 * the decision itself. Every answer is a peer choice in one grouped set, so a
 * Figma value and "In the app" are picked the same way, and only values that
 * can actually feed this prop are listed.
 */
function PropRow(props: {
  active: boolean;
  onSelect: () => void;
  row: SemanticTargetRow;
}): h.JSX.Element {
  const { row } = props;
  return (
    <div class="prop-row">
      <button
        aria-expanded={props.active}
        class="prop-head"
        onClick={props.onSelect}
        type="button"
      >
        <TargetStatusIcon state={targetState(row)} />
        <span class="prop-name">
          <b>{row.targetPath}</b>
          <code class="prop-type">{row.target.typeName}</code>
        </span>
        <span class="prop-current">{describeRowValue(row)}</span>
        <span class="prop-caret" aria-hidden="true">›</span>
      </button>
    </div>
  );
}

function TargetStatusIcon(props: {
  state: ReturnType<typeof targetState>;
}): h.JSX.Element {
  return (
    <span
      aria-label={props.state === 'done'
        ? 'Resolved'
        : props.state === 'blocked' ? 'Required mapping missing' : 'Needs review'}
      class="prop-status-icon"
      data-state={props.state}
      role="img"
    >
      {props.state === 'done'
        ? <IconApprovedCheckmark16 />
        : props.state === 'blocked' ? <IconWarning16 /> : <IconInfo16 />}
    </span>
  );
}

function PropInspector(props: {
  disabled: boolean;
  onOptionChange: SemanticMappingViewProps['onOptionChange'];
  onValueMappingChange?: SemanticMappingViewProps['onValueMappingChange'];
  row: SemanticTargetRow;
}): h.JSX.Element {
  const { row } = props;
  const target = row.target;
  const allowedValues = allowedStaticValues(target);
  const mappable = target.kind === 'visual' || target.kind === 'node';
  const mode = row.optionId === OPTION_RUNTIME || row.optionId === OPTION_STATIC
    ? 'code'
    : row.optionId === OPTION_OMITTED
      ? 'omit'
      : mappable ? 'figma' : 'code';
  const choose = (optionId: string): void => {
    props.onOptionChange(
      target.path,
      optionId,
      optionId === OPTION_STATIC
        // Seed a type-correct default so a constrained prop never starts life
        // holding a value its own type rejects.
        ? row.staticValue ?? allowedValues[0] ?? ''
        : undefined,
    );
  };

  return (
    <section class="prop-inspector" aria-labelledby={`q-${row.targetPath}`}>
      <div class="prop-inspector-heading">
        <div>
          <span class="mapping-inspector-label">Focused code prop</span>
          <h3 id={`q-${row.targetPath}`}>{row.targetPath}</h3>
        </div>
        <code class="prop-type">{target.typeName}</code>
      </div>

      {target.kind === 'excluded' ? (
        <p class="mapping-help">
          Excluded by policy — styling and DOM props stay in application code.
        </p>
      ) : target.kind === 'unsupported' ? (
        <p class="mapping-help">This type cannot be mapped visually yet.</p>
      ) : (
        <Fragment>
          <div
            aria-label={`Source mode for ${row.targetPath}`}
            class="mapping-mode-control"
            role="group"
          >
            <SegmentedControl
              disabled={props.disabled}
              onValueChange={(value) => {
                if (value === 'figma') {
                  choose(row.optionId && ![
                    OPTION_RUNTIME, OPTION_STATIC, OPTION_OMITTED,
                  ].includes(row.optionId) ? row.optionId : row.options[0]?.id ?? '');
                } else if (value === 'code') {
                  choose(row.optionId === OPTION_STATIC ? OPTION_STATIC : OPTION_RUNTIME);
                } else {
                  choose(OPTION_OMITTED);
                }
              }}
              options={[
                ...(mappable ? [{
                  children: (
                    <span class="mapping-mode-option">
                      <IconComponentProperty16 />
                      <span>Figma</span>
                    </span>
                  ),
                  disabled: row.options.length === 0,
                  value: 'figma',
                }] : []),
                {
                  children: (
                    <span class="mapping-mode-option">
                      <IconDev16 />
                      <span>Set in code</span>
                    </span>
                  ),
                  value: 'code',
                },
                ...(target.required ? [] : [{
                  children: (
                    <span class="mapping-mode-option">
                      <IconHidden16 />
                      <span>Left out</span>
                    </span>
                  ),
                  value: 'omit',
                }]),
              ]}
              value={mode}
            />
          </div>

          {mappable && mode === 'figma' ? (
            <div class="mapping-inspector-section">
              <div>
                <div class="mapping-inspector-label">Figma properties</div>
                <div class="mapping-help">
                  Includes exposed properties from nested instances.
                </div>
              </div>
              {row.options.length === 0 ? (
                <p class="choice-none">
                  No component or nested-instance properties can feed a {target.typeName} prop.
                </p>
              ) : (
                <div class="mapping-candidate-control">
                  <Dropdown
                    disabled={props.disabled}
                    onValueChange={choose}
                    options={candidateDropdownOptions(row)}
                    placeholder="Choose a component or nested property"
                    value={row.options.some((option) => option.id === row.optionId)
                      ? row.optionId
                      : null}
                    aria-label={`Figma source for ${row.targetPath}`}
                  />
                </div>
              )}
            </div>
          ) : null}

          {mode === 'code' ? (
            <div class="mapping-inspector-section">
              <div class="mapping-inspector-label">Code value</div>
              <div class="choice-list code-value-choice-list" role="radiogroup" aria-label={`Code value for ${row.targetPath}`}>
                {mappable ? (
                  <Choice
                    checked={row.optionId === OPTION_STATIC}
                    detail="the same every time"
                    disabled={props.disabled}
                    label="Fixed value"
                    onSelect={() => choose(OPTION_STATIC)}
                  />
                ) : null}
                <Choice
                  checked={row.optionId === OPTION_RUNTIME}
                  detail="emitted as undefined, wired up in code"
                  disabled={props.disabled}
                  label="In the app"
                  onSelect={() => choose(OPTION_RUNTIME)}
                />
              </div>
            </div>
          ) : null}

          {row.optionId === OPTION_STATIC ? (
            <div class="prop-extra">
                  <Textbox
                    aria-label={`Static value for ${row.targetPath}`}
                    disabled={props.disabled}
                    onValueInput={(value) => props.onOptionChange(
                      target.path,
                      OPTION_STATIC,
                      // Recover the declared value when the text names one, so
                      // typing `true` stores a boolean rather than a string.
                      matchAllowedValue(allowedValues, value),
                    )}
                    placeholder="Value to always use"
                    value={String(row.staticValue ?? '')}
                  />
            </div>
          ) : null}

          {mode === 'figma' && row.valueMappings && row.valueMappings.length > 0 ? (
            <div class="mapping-inspector-section">
              <div class="mapping-inspector-label">Value alignment</div>
              <div class="prop-extra value-mapping-list">
                  <div class="mapping-help">Which Figma option produces each code value</div>
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
            </div>
          ) : null}

          {row.suggestion && row.suggestion.optionId === row.optionId ? (
            <p class="mapping-help">Suggested — {row.suggestion.reason} Review before saving.</p>
          ) : null}
        </Fragment>
      )}
    </section>
  );
}

/** The chosen answer leads, so it stays visible without scanning the list. */
function orderedOptions(row: SemanticTargetRow): SemanticTargetRow['options'] {
  const chosen = row.options.filter((option) => option.id === row.optionId);
  return chosen.length === 0
    ? row.options
    : [...chosen, ...row.options.filter((option) => option.id !== row.optionId)];
}

function candidateDropdownOptions(row: SemanticTargetRow): DropdownOption[] {
  const ordered = orderedOptions(row);
  const componentProperties = ordered.filter((option) => !option.id.startsWith('nested:'));
  const nestedProperties = ordered.filter((option) => option.id.startsWith('nested:'));
  const toDropdownOption = (
    option: SemanticTargetRow['options'][number],
    nested = false,
  ): DropdownOption => ({
    text: nested
      ? formatNestedCandidate(option)
      : [
          option.label,
          option.detail,
          option.needsCheck
            ? 'check types'
            : option.fragile ? 'by layer name' : undefined,
        ].filter(Boolean).join(' · '),
    value: option.id,
  });
  const result: DropdownOption[] = [];

  if (componentProperties.length > 0) {
    result.push(
      { header: 'Component properties' },
      ...componentProperties.map((option) => toDropdownOption(option)),
    );
  }
  if (nestedProperties.length > 0) {
    if (result.length > 0) {
      result.push('-');
    }
    result.push(
      { header: 'Nested instances' },
      ...nestedProperties.map((option) => toDropdownOption(option, true)),
    );
  }

  return result;
}

function formatNestedCandidate(
  option: SemanticTargetRow['options'][number],
): string {
  const path = option.label.split(' / ');
  const isProperty = option.id.startsWith('nested:nested-property:');
  const isText = option.id.startsWith('nested:nested-text:');
  const componentName = path[path.length - (isProperty ? 2 : 1)] ?? option.label;
  const propertyName = isProperty
    ? path[path.length - 1] ?? 'property'
    : isText ? 'text' : 'instance';

  return `${componentName}: ${propertyName} - ${option.detail ?? 'No sample value'}`;
}

/** A single answer. Rendered as a real radio so the group is keyboard-operable. */
function Choice(props: {
  checked: boolean;
  detail?: string;
  disabled: boolean;
  flag?: string;
  label: string;
  onSelect: () => void;
}): h.JSX.Element {
  return (
    <button
      aria-checked={props.checked}
      class="choice"
      data-on={props.checked ? 'true' : undefined}
      disabled={props.disabled}
      onClick={props.onSelect}
      role="radio"
      type="button"
    >
      <span class="choice-dot" aria-hidden="true" />
      <span class="choice-copy">
        <span class="choice-label">{props.label}</span>
        {props.detail ? <span class="choice-detail">{props.detail}</span> : null}
      </span>
      {props.flag ? <span class="choice-flag">{props.flag}</span> : null}
    </button>
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
    return [
      renderImportLines(result.usage.imports),
      '',
      formatPreviewJsx(result.usage.jsx),
    ].join('\n');
  } catch (_error) {
    return undefined;
  }
}

function formatPreviewJsx(jsx: string): string {
  if (!/ [A-Za-z_$][A-Za-z0-9_$]*=/.test(jsx)) {
    return jsx;
  }
  return jsx
    .replace(/\s+(?=[A-Za-z_$][A-Za-z0-9_$]*=)/g, '\n  ')
    .replace(/\s*\/>$/, '\n/>');
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
