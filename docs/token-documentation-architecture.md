# Token Documentation — How It Works (Architecture & Reconciliation)

Status: Active  
Last updated: 2026-08-28

This document details the architecture, component binding pipeline, dynamic grouping heuristics, and in-place reconciliation algorithm powering the **Token Documentation** generator in Tashil Code.

---

## 1. High-Level Architecture & Pipeline

```text
 ┌─────────────────────────────────────────────────────────────┐
 │                Figma Variables Collections                  │
 │   (Colors, Spacing, Radius, etc. across multiple modes)     │
 └──────────────────────────────┬──────────────────────────────┘
                                │ loadRawCollectionData() [main.ts]
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │           RawCollectionData (Serializable DTO)              │
 │  collectionId · modes · tokens with valuesByMode & scopes   │
 └──────────────────────────────┬──────────────────────────────┘
                                │ buildTokenDocDocument() [token-doc-model.ts]
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │               TokenDocDocument (Pure IR)                    │
 │  - Folder-based sections with preserved visual order        │
 │  - Dynamic headlines (formatDynamicHeadline)                │
 │  - Context-aware descriptions (generateDynamicSectionDesc)  │
 │  - Mode-resolved values, color hexes, and alias targets     │
 │  - Deterministic contentHash                                │
 └──────────────┬──────────────────────────────┬───────────────┘
                │                              │
     New Frame  │                              │ In-Place Update
                ▼                              ▼
 ┌─────────────────────────────┐┌──────────────────────────────┐
 │   figma-canvas-writer.ts    ││    figma-canvas-updater.ts   │
 │ - Loads required fonts      ││ - Validates tashil_doc_meta  │
 │ - Instantiates master comps ││ - 1-to-1 Section match       │
 │ - Binds Color Icon fills    ││ - 1-to-1 Row reconciliation  │
 │ - Applies column modes      ││ - Refreshes variable binding │
 │ - Side-by-side placement    ││ - Prunes deleted rows/modes  │
 │ - Stamps tashil_doc_meta    ││ - Preserves canvas position  │
 └─────────────────────────────┘└──────────────────────────────┘
```

---

## 2. Design System Master Components

The canvas documentation generator connects to master components from the **Swiss Army Knife** design system:

| Component / Template | Node ID | Function / Architecture |
| --- | --- | --- |
| `.[Documentation] Header & Footer` | `1386:9060` | Root document header (`1386:9061`) and footer (`1386:9066`) |
| `.[Documentation] Hero` | `1422:17985` | Title, subtitle, collection statistics chips, and gradient badge |
| `.[Documentation] Separator` | `1422:18167` | Section separator rule with collection name badge |
| `.[Documentation] Section` | `1422:18185` | Section container with headline text, description text, and a `Slot` frame |
| `.[Table] Header` | `1929:52306` | Header bar for `Token` and `Value` columns |
| `.[Table] Token Item` | `1929:52305` | Row item showing token name and type indicator |
| `.[Table] Value Item` | `1929:52304` | Component set (`Type=Color`, `Type=Number`, `Type=Boolean`, `Type=String`). For `Color`, `Color Icon` is bound to the token variable |
| `Table` | `1929:52307` | Horizontal container housing one Token Column and $N$ Mode Value Columns |

When running in external files where master components cannot be loaded, procedural fallback functions (`createProceduralSection`, `createProceduralValueItem`, etc.) build equivalent auto-layout frames with exact typography, padding, and strokes.

---

## 3. Native Figma Variable Binding

When generating or updating `.[Table] Value Item` instances:

1. **Paint Variable Attachment**:
   ```ts
   let solidPaint: SolidPaint = { color: hexToRgb(val.hexColor), type: 'SOLID' };
   if (variableId) {
     const variable = await figma.variables.getVariableByIdAsync(variableId);
     if (variable) {
       solidPaint = figma.variables.setBoundVariableForPaint(solidPaint, 'color', variable);
     }
   }
   ```
2. **Swatch Fill Propagation**:
   The bound `solidPaint` is assigned to `swatch.fills` (`Color Icon` layer) and all immediate child shapes.
3. **Live Sync**:
   Modifying variable values or alias targets in Figma immediately updates the rendered swatches across the specification document without requiring manual repainting.

---

## 4. Explicit Column Appearance & Variable Mode Setting

Each mode column (`Value`) explicitly sets its variable mode on the column frame:

```ts
export async function applyColumnMode(
  columnNode: SceneNode,
  mode: TokenDocMode,
  collectionId?: string,
): Promise<void> {
  if (!('setExplicitVariableModeForCollection' in columnNode)) return;
  const targetNode = columnNode as FrameNode | InstanceNode;

  const allCollections = await figma.variables.getLocalVariableCollectionsAsync();
  for (const col of allCollections) {
    const matchingMode = col.modes.find(
      (m) => m.modeId === mode.modeId || m.name.toLowerCase() === mode.name.toLowerCase(),
    );
    if (matchingMode) {
      targetNode.setExplicitVariableModeForCollection(col, matchingMode.modeId);
    }
  }
}
```

- Applied during initial frame assembly and re-applied after the frame is attached to the document tree (`targetPage.appendChild(rootFrame)`).
- Ensures that all nested component instances and variable bindings inside that column resolve to the respective mode (e.g. `Light` vs `Dark`).

---

## 5. Dynamic Section Grouping & Descriptions

Rather than using rigid, hardcoded category dictionaries, the IR model dynamically extracts sections and descriptions:

1. **Folder Hierarchy Extraction (`inferSectionGrouping`)**:
   - Parses slash `/` segments in variable names (e.g. `Surface/Brand/Primary` $\rightarrow$ group `Surface / Brand`).
   - Automatically strips redundant top-level collection names if prefixed (e.g. `Colors/Surface/Default` in collection `Colors` groups under `Surface`).
2. **Dynamic Headline Formatting (`formatDynamicHeadline`)**:
   - Preserves TitleCase, handles snake_case/kebab-case, and retains multi-level folder sub-groupings (`Button / Primary`).
3. **Context-Aware Dynamic Descriptions (`generateDynamicSectionDescription`)**:
   - Evaluates token types (`COLOR`, `FLOAT`, `BOOLEAN`, `STRING`), scopes, and semantic naming patterns.
   - Generates natural, role-specific descriptions for surfaces, borders, typography, icons, accents, spacing scales, corner radii, elevation/shadows, and component-specific variables.

---

## 6. In-Place 1-to-1 Reconciliation Algorithm

When **Update in Place** is triggered on a selected documentation frame:

```text
 1. Validate `tashil_doc_meta` on selected frame (targetId, docType = 'tokens').
 2. Preload fonts across all text layers (figma.loadFontAsync).
 3. For each section in updated TokenDocDocument:
    a. If section exists on canvas:
       - Update Headline and Description text nodes in place.
       - Reconcile Token column rows 1-to-1:
         • Existing rows: mutate characters to new token name.
         • New rows: createTokenItemNode() and append.
         • Removed rows: prune extra children.
       - Reconcile Value columns (per mode):
         • Update column header text to mode name.
         • Re-apply explicit variable mode (applyColumnMode).
         • Existing items: mutate text characters and refresh bound swatch paints.
         • New items: createValueItemNode() with variableId and append.
         • Removed items: prune extra children.
    b. If section is newly added:
       - createSectionNode() and insert before footer.
 4. Prune removed sections from canvas.
 5. Stamp updated contentHash and generatedAt timestamp in metadata.
```

This guarantees that canvas layout coordinates, layer IDs, links, and auto-layout spacing are never degraded during updates.

---

## 7. Canvas Positioning & Real-Time Progress

- **Side-by-Side Arrangement**:
  When creating a new specification frame, the writer queries existing `tashil_doc_meta` frames on the active page and places the new frame `100px` to the right of the rightmost frame with matching baseline Y coordinates.
- **Progress Event Pipeline**:
  `DOC_GENERATION_PROGRESS` events stream stage descriptions and percentage integers ($0\%$ to $100\%$) from the Figma main thread to `ui-controller.ts`, driving the animated progress bar in `ui.tsx`.
- **Diagnostics & Error Handling**:
  Errors during generation or updates are logged with full stack traces to the developer console via `console.error` and presented as clean toasts in the plugin interface.
