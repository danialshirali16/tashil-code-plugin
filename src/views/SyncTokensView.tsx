import {
  Button,
  Checkbox,
  Dropdown,
  IconCodeSnippet24,
  IconFolder24,
  IconSearchSmall24,
  SegmentedControl,
  Textbox,
  TextboxNumeric,
  Toggle,
} from '@create-figma-plugin/ui';
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type {
  ColorFormat,
  ExportFile,
  ExportOptions,
  NameStyle,
  OutputFormat,
  TokenCollectionSummary,
} from '../sync-tokens/types';
import { IconDetach48 } from '../ui-assets';
import {
  CopyButton,
  EmptyInspectState,
  Field,
} from '../components/common';

export function tokenFileSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function boundedCssPreview(css: string, maximumLines = 14): string {
  const lines = css.split('\n');
  if (lines.length <= maximumLines) {
    return css;
  }
  const hiddenLineCount = lines.length - maximumLines + 1;
  return [
    ...lines.slice(0, maximumLines - 2),
    `  /* … ${hiddenLineCount} more declarations */`,
    lines[lines.length - 1],
  ].join('\n');
}

export function tokenOutputExtension(format: OutputFormat): string {
  if (format === 'markdown') return 'md';
  if (format === 'scss') return 'scss';
  if (format === 'tailwind-theme') return 'ts';
  if (format === 'json-flat' || format === 'json-dtcg') return 'json';
  return 'css';
}

export function SyncTokensView(props: {
  collections: readonly TokenCollectionSummary[];
  collectionsStatus: 'idle' | 'loading' | 'error';
  collectionsError: string;
  exportStatus: 'idle' | 'exporting' | 'error';
  exportError: string;
  exportSuccess: string;
  previewStatus: 'idle' | 'loading' | 'error';
  previewError: string;
  previewFiles: readonly ExportFile[];
  onLoadCollections: () => void;
  onExport: (collectionIds: readonly string[], options: ExportOptions) => void;
  onPreview: (collectionIds: readonly string[], options: ExportOptions) => void;
}): h.JSX.Element {
  const {
    collections,
    collectionsStatus,
    collectionsError,
    exportStatus,
    exportError,
    exportSuccess,
    previewStatus,
    previewError,
    previewFiles,
    onLoadCollections,
    onExport,
    onPreview,
  } = props;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modesByCollection, setModesByCollection] = useState<Record<string, Set<string>>>({});
  const [query, setQuery] = useState('');
  const [convertPxToRem, setConvertPxToRem] = useState(true);
  const [rootFontSize, setRootFontSize] = useState<number>(16);
  const [colorFormat, setColorFormat] = useState<ColorFormat>('hex');
  const [nameStyle, setNameStyle] = useState<NameStyle>('lower-hyphen');
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('css');
  const [aliasModeOverrides, setAliasModeOverrides] = useState<
    Record<string, Record<string, Record<string, string>>>
  >({});

  useEffect(() => {
    if (collections.length === 0 && collectionsStatus === 'idle') {
      onLoadCollections();
    }
  }, []);

  const busy = collectionsStatus === 'loading' || exportStatus === 'exporting';

  function modesFor(collection: TokenCollectionSummary): Set<string> {
    const chosen = modesByCollection[collection.id];
    if (chosen && chosen.size > 0) {
      return chosen;
    }
    return new Set([collection.defaultModeId]);
  }

  function toggleCollection(collection: TokenCollectionSummary): void {
    const selecting = !selected.has(collection.id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(collection.id)) {
        next.delete(collection.id);
      } else {
        next.add(collection.id);
      }
      return next;
    });
    if (selecting && modesByCollection[collection.id] === undefined) {
      setModesByCollection((prev) => ({
        ...prev,
        [collection.id]: new Set([collection.defaultModeId]),
      }));
    }
  }

  function selectAll(): void {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const collection of filteredCollections) {
        if (allSelected) {
          next.delete(collection.id);
        } else {
          next.add(collection.id);
        }
      }
      return next;
    });
    if (!allSelected) {
      setModesByCollection((prev) => {
        const next = { ...prev };
        for (const collection of filteredCollections) {
          if (next[collection.id] === undefined) {
            next[collection.id] = new Set([collection.defaultModeId]);
          }
        }
        return next;
      });
    }
  }

  function toggleMode(collection: TokenCollectionSummary, modeId: string): void {
    setModesByCollection((prev) => {
      const current = new Set(modesFor(collection));
      if (current.has(modeId)) {
        if (current.size > 1) {
          current.delete(modeId);
        }
      } else {
        current.add(modeId);
      }
      return { ...prev, [collection.id]: current };
    });
  }

  function handleExport(): void {
    if (selected.size === 0) {
      return;
    }
    const payloadModes: Record<string, readonly string[]> = {};
    for (const collection of collections) {
      if (selected.has(collection.id)) {
        payloadModes[collection.id] = [...modesFor(collection)];
      }
    }
    onExport([...selected], {
      modesByCollection: payloadModes,
      aliasModeOverridesByCollectionMode: aliasModeOverrides,
      convertPxToRem,
      rootFontSize: rootFontSize > 0 ? rootFontSize : 16,
      colorFormat,
      nameStyle,
      outputFormat,
    });
  }

  function clearAllSelections(): void {
    setSelected(new Set());
  }

  function setAliasModeOverride(
    sourceCollectionId: string,
    sourceModeId: string,
    targetCollectionId: string,
    targetModeId: string,
  ): void {
    setAliasModeOverrides((previous) => ({
      ...previous,
      [sourceCollectionId]: {
        ...previous[sourceCollectionId],
        [sourceModeId]: {
          ...previous[sourceCollectionId]?.[sourceModeId],
          [targetCollectionId]: targetModeId,
        },
      },
    }));
  }

  const selectedCollectionIds = collections
    .filter((collection) => selected.has(collection.id))
    .map((collection) => collection.id);
  const previewModes: Record<string, readonly string[]> = {};
  for (const collection of collections) {
    if (selected.has(collection.id)) {
      previewModes[collection.id] = [...modesFor(collection)];
    }
  }
  const previewOptions: ExportOptions = {
    modesByCollection: previewModes,
    aliasModeOverridesByCollectionMode: aliasModeOverrides,
    convertPxToRem,
    rootFontSize: rootFontSize > 0 ? rootFontSize : 16,
    colorFormat,
    nameStyle,
    outputFormat,
  };
  const previewRequestKey = JSON.stringify({
    collectionIds: selectedCollectionIds,
    options: previewOptions,
  });

  useEffect(() => {
    onPreview(selectedCollectionIds, previewOptions);
  }, [previewRequestKey]);

  if (collections.length === 0) {
    if (collectionsStatus === 'error') {
      return (
        <EmptyInspectState
          actionLabel="Retry"
          icon={<IconDetach48 />}
          label={collectionsError || 'Could not load variable collections.'}
          onAction={onLoadCollections}
        />
      );
    }
    return (
      <EmptyInspectState
        icon={<IconFolder24 />}
        label={busy ? 'Loading collections…' : 'No variable collections in this file.'}
      />
    );
  }

  const needle = query.trim().toLowerCase();
  const filteredCollections = needle.length === 0
    ? collections
    : collections.filter((c) => c.name.toLowerCase().includes(needle));
  const allSelected = filteredCollections.length > 0
    && filteredCollections.every((c) => selected.has(c.id));
  const bulkSelectionLabel = needle.length === 0
    ? allSelected ? 'Clear all' : 'Select all'
    : `${allSelected ? 'Clear' : 'Select'} ${filteredCollections.length} ${
      filteredCollections.length === 1 ? 'result' : 'results'
    }`;
  const selectedTokenCount = collections
    .filter((c) => selected.has(c.id))
    .reduce((sum, c) => sum + c.tokenCount, 0);
  const selectedCollections = collections.filter((collection) => selected.has(collection.id));
  const outputFileCount = selectedCollections.reduce(
    (sum, collection) => sum + modesFor(collection).size,
    0,
  );
  const previewDeclarationCount = previewFiles.reduce(
    (sum, file) => sum + file.declarationCount,
    0,
  );
  const previewWarningCount = previewFiles.reduce(
    (sum, file) => sum + file.warnings.length,
    0,
  );
  const previewIsCurrent = previewStatus === 'idle'
    && previewFiles.length === outputFileCount
    && outputFileCount > 0;

  return (
    <main aria-labelledby="tashil-sync-tokens-heading" class="sync-tokens-view">
      <div class="sync-tokens-scroll">
        <section class="sync-tokens-intro">
          <h1 id="tashil-sync-tokens-heading">Sync tokens</h1>
          <p>Select collections, modes, and a format to generate token files.</p>
        </section>

        <div class="sync-tokens-toolbar">
          <Textbox
            aria-label="Search collections"
            icon={<IconSearchSmall24 />}
            onValueInput={setQuery}
            placeholder="Search collections"
            value={query}
          />
          <Button
            disabled={filteredCollections.length === 0}
            onClick={selectAll}
            secondary
          >
            {bulkSelectionLabel}
          </Button>
        </div>
        {selected.size > 0 ? (
          <div class="sync-tokens-selection-summary" role="status">
            <span>
              {selected.size} {selected.size === 1 ? 'collection' : 'collections'} selected
            </span>
            <Button onClick={clearAllSelections} secondary>Clear all</Button>
          </div>
        ) : null}

        <section class="sync-tokens-step">
          <h2>1. Choose collections</h2>
          {filteredCollections.length === 0 ? (
            <div class="sync-tokens-empty-result">No collections match “{query}”.</div>
          ) : (
            <div class="sync-tokens-collection-list">
              {filteredCollections.map((collection) => {
                const isSelected = selected.has(collection.id);
                return (
                  <div
                    class={`sync-tokens-collection-row${isSelected ? ' sync-tokens-row-selected' : ''}`}
                    key={collection.id}
                  >
                    <Checkbox
                      onValueChange={() => toggleCollection(collection)}
                      value={isSelected}
                    >
                      <span class="sync-tokens-collection-name">{collection.name}</span>
                      <span class="sync-tokens-count">({collection.tokenCount})</span>
                    </Checkbox>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section class="sync-tokens-step">
          <h2>2. Output files</h2>
          {selectedCollections.length === 0 ? (
            <div class="sync-tokens-output-empty">
              Select a collection to configure its output.
            </div>
          ) : (
            <div class="sync-tokens-output-panel">
              {selectedCollections.map((collection) => {
                const chosenModes = modesFor(collection);
                const includeModeSuffix = collection.modes.length > 1;
                const collectionSlug = tokenFileSlug(collection.name) || collection.id;
                return (
                  <section class="sync-tokens-output-group" key={collection.id}>
                    <div class="sync-tokens-output-heading">
                      <div>
                        <h3>{collection.name}</h3>
                        <p>Choose one or more modes to export.</p>
                      </div>
                      <span>{collection.tokenCount} variables</span>
                    </div>
                    <div class="sync-tokens-mode-list">
                      {collection.modes.map((mode) => {
                        const active = chosenModes.has(mode.modeId);
                        const modeSuffix = includeModeSuffix
                          ? `-${tokenFileSlug(mode.name)}`
                          : '';
                        const fileName = `${collectionSlug}${modeSuffix}.${tokenOutputExtension(outputFormat)}`;
                        return (
                          <div
                            class={`sync-tokens-mode-row${active ? ' sync-tokens-row-selected' : ''}`}
                            key={mode.modeId}
                          >
                            <div class="sync-tokens-mode-control">
                              <Checkbox
                                disabled={collection.modes.length === 1}
                                onValueChange={() => toggleMode(collection, mode.modeId)}
                                value={active}
                              >
                                {mode.name}
                              </Checkbox>
                            </div>
                            <span class="sync-tokens-file-name">{fileName}</span>
                            {active ? (
                              <CopyButton text={fileName} title={fileName} />
                            ) : (
                              <span aria-hidden="true" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </section>

        <section class="sync-tokens-step">
          <h2>3. Output settings</h2>
          <div class="sync-tokens-settings-panel">
            <div class="sync-tokens-unit-settings">
              <Toggle
                onValueChange={setConvertPxToRem}
                value={convertPxToRem}
              >
                Convert px to rem
              </Toggle>

              {convertPxToRem ? (
                <Field id="tashil-root-font-size" label="Root font size">
                  <div class="sync-tokens-number-input">
                    <TextboxNumeric
                      aria-label="Root font size in pixels"
                      onNumericValueInput={(value) =>
                        setRootFontSize(value === null ? 16 : value)
                      }
                      minimum={1}
                      integer
                      value={String(rootFontSize)}
                    />
                    <span>px</span>
                  </div>
                </Field>
              ) : null}
            </div>

            <div class="sync-tokens-format-settings">
              <Field id="tashil-output-format" label="Output format">
                <Dropdown
                  aria-label="Output format"
                  onValueChange={(value) => setOutputFormat(value as OutputFormat)}
                  options={[
                    { value: 'css', text: 'CSS variables' },
                    { value: 'json-flat', text: 'JSON — flat' },
                    { value: 'json-dtcg', text: 'JSON — W3C DTCG' },
                    { value: 'markdown', text: 'Markdown — raw token list' },
                    { value: 'scss', text: 'SCSS variables + map' },
                    { value: 'tailwind-theme', text: 'Tailwind theme extension' },
                  ]}
                  value={outputFormat}
                />
              </Field>
              <Field id="tashil-color-format" label="Color format">
                <SegmentedControl
                  onValueChange={(value) => setColorFormat(value as ColorFormat)}
                  options={[
                    { value: 'hex', children: 'HEX' },
                    { value: 'rgb', children: 'RGB' },
                    { value: 'rgba', children: 'RGBA' },
                    { value: 'variable', children: 'Variable' },
                  ]}
                  value={colorFormat}
                />
              </Field>

              <Field id="tashil-name-style" label="Token name">
                <div class="sync-tokens-name-style">
                  <SegmentedControl
                    onValueChange={(value) => setNameStyle(value as NameStyle)}
                    options={[
                      { value: 'default', children: 'Default' },
                      { value: 'title-slash', children: 'A/A' },
                      { value: 'lower-slash', children: 'a/a' },
                      { value: 'title-dot', children: 'A.A' },
                      { value: 'lower-dot', children: 'a.a' },
                      { value: 'title-hyphen', children: 'A-A' },
                      { value: 'lower-hyphen', children: 'a-a' },
                      { value: 'title-underscore', children: 'A_A' },
                      { value: 'lower-underscore', children: 'a_a' },
                    ]}
                    value={nameStyle}
                  />
                </div>
              </Field>
            </div>

            <div class="sync-tokens-preview">
              <div class="sync-tokens-preview-heading">
                <strong>Output preview</strong>
                <span>
                  {previewStatus === 'loading'
                    ? 'Updating from Figma variables…'
                    : 'Generated from the selected output files'}
                </span>
              </div>
              <div
                aria-label="Token output preview"
                class="sync-tokens-preview-files"
                role="region"
              >
                {selected.size === 0 ? (
                  <div class="sync-tokens-preview-empty">
                    Select a collection to preview its generated token output.
                  </div>
                ) : null}
                {selected.size > 0 && previewStatus === 'loading'
                  && previewFiles.length === 0 ? (
                    <div class="sync-tokens-preview-empty">Generating preview…</div>
                  ) : null}
                {selected.size > 0 && previewStatus === 'idle'
                  && previewFiles.length === 0 ? (
                    <div class="sync-tokens-preview-empty">
                      No exportable declarations were found for this selection.
                    </div>
                  ) : null}
                {previewStatus === 'error' ? (
                  <div class="field-error" role="alert">
                    {previewError || 'Could not preview tokens.'}
                  </div>
                ) : null}
                {previewFiles.map((file) => (
                  <section class="sync-tokens-preview-file" key={file.name}>
                    <div class="sync-tokens-preview-file-heading">
                      <strong>{file.name}</strong>
                      <span>
                        {file.sourceVariableCount} variables → {file.declarationCount} declarations
                        {file.warnings.length > 0
                          ? ` · ${file.warnings.length} warning${file.warnings.length === 1 ? '' : 's'}`
                          : ''}
                      </span>
                    </div>
                    <pre aria-label={`${file.name} preview`} tabIndex={0}>
                      <code>{boundedCssPreview(file.css)}</code>
                    </pre>
                    {file.diff ? (
                      <div class="sync-tokens-diff" role="status">
                        {`${file.diff.added} added · ${file.diff.changed} changed · ${file.diff.removed} removed · ${file.diff.unchanged} unchanged`}
                      </div>
                    ) : null}
                    {file.warnings.some((warning) =>
                      warning.code === 'mode-fallback'
                      && warning.sourceCollectionId
                      && warning.sourceModeId
                      && warning.targetCollectionId
                    ) ? (
                      <div class="sync-tokens-mode-overrides">
                        {file.warnings.map((warning, index) => {
                          if (
                            warning.code !== 'mode-fallback'
                            || warning.sourceCollectionId === undefined
                            || warning.sourceModeId === undefined
                            || warning.targetCollectionId === undefined
                          ) {
                            return null;
                          }
                          const targetCollection = collections.find(
                            (collection) => collection.id === warning.targetCollectionId,
                          );
                          if (targetCollection === undefined) {
                            return null;
                          }
                          const selectedModeId =
                            aliasModeOverrides[warning.sourceCollectionId]
                              ?.[warning.sourceModeId]
                              ?.[warning.targetCollectionId]
                            ?? warning.fallbackModeId
                            ?? targetCollection.defaultModeId;
                          return (
                            <div
                              class="sync-tokens-mode-override"
                              key={`${warning.targetCollectionId}-${index}`}
                            >
                              <div>
                                <strong>Alias mode for {targetCollection.name}</strong>
                                <span>{warning.message}</span>
                              </div>
                              <Dropdown
                                aria-label={`Alias mode for ${targetCollection.name}`}
                                onValueChange={(targetModeId) =>
                                  setAliasModeOverride(
                                    warning.sourceCollectionId as string,
                                    warning.sourceModeId as string,
                                    warning.targetCollectionId as string,
                                    targetModeId,
                                  )
                                }
                                options={targetCollection.modes.map((mode) => ({
                                  value: mode.modeId,
                                  text: mode.name,
                                }))}
                                value={selectedModeId}
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {file.warnings.some((warning) => warning.code !== 'mode-fallback') ? (
                      <ul class="sync-tokens-preview-warnings">
                        {file.warnings
                          .filter((warning) => warning.code !== 'mode-fallback')
                          .slice(0, 3)
                          .map((warning, index) => (
                          <li key={`${warning.code}-${warning.tokenName ?? index}`}>
                            {warning.tokenName ? `${warning.tokenName}: ` : ''}
                            {warning.message}
                          </li>
                        ))}
                        {file.warnings.filter((warning) =>
                          warning.code !== 'mode-fallback'
                        ).length > 3 ? (
                          <li>
                            +{file.warnings.filter((warning) =>
                              warning.code !== 'mode-fallback'
                            ).length - 3} more warnings
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </section>
                ))}
              </div>
            </div>
          </div>
        </section>

        {exportSuccess ? (
          <div class="sync-tokens-success" role="status">{exportSuccess}</div>
        ) : null}
        {exportStatus === 'error' && exportError ? (
          <div class="field-error" role="alert">{exportError}</div>
        ) : null}
        {collectionsStatus === 'error' && collectionsError ? (
          <div class="field-error" role="alert">{collectionsError}</div>
        ) : null}
      </div>

      <footer class="sync-tokens-footer">
        <div class="sync-tokens-export-summary">
          <IconCodeSnippet24 />
          <div>
            <strong>
              {outputFileCount} {outputFileCount === 1 ? 'file' : 'files'}
              {' · '}
              {selectedTokenCount} variables
              {previewIsCurrent ? ` → ${previewDeclarationCount} declarations` : ''}
            </strong>
            <span>
              {outputFileCount === 0
                ? 'Select a collection to continue'
                : previewStatus === 'loading'
                  ? 'Analyzing output'
                  : previewWarningCount > 0
                    ? `${previewWarningCount} export warning${previewWarningCount === 1 ? '' : 's'}`
                    : 'Ready to export'}
            </span>
          </div>
        </div>
        <Button
          disabled={selected.size === 0 || busy}
          loading={exportStatus === 'exporting'}
          onClick={handleExport}
        >
          {exportStatus === 'exporting'
            ? 'Exporting'
            : `Export ${outputFileCount || ''} ${outputFileCount === 1 ? 'file' : 'files'}`.replace('  ', ' ')}
        </Button>
      </footer>
    </main>
  );
}
