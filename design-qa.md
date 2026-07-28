# Connect Component Mapping — Design QA

## Comparison target

- Source visual truth: `/Users/danial/.codex/generated_images/019fa86a-9026-7f33-9cec-77d055deb20e/call_hVD2LMkfmNnRB5gsyk8SXtkC.png`
- Implementation screenshot: `/Users/danial/Downloads/TashilStoryBook/artifacts/connect-mapping-workbench.png`
- Narrow implementation screenshot: `/Users/danial/Downloads/TashilStoryBook/artifacts/connect-mapping-workbench-narrow.png`
- Post-fix combined comparison: `/Users/danial/.codex/generated_images/019fa86a-9026-7f33-9cec-77d055deb20e/call_hlZEPvpOmn6FJtDzR6wxSygu.png`
- Annotated implementation comparison: `/Users/danial/.codex/generated_images/019fa86a-9026-7f33-9cec-77d055deb20e/call_nkoSEf4nF3X72TBgTzVEp1Yr.png`
- Source pixels: 1152 × 1365
- Implementation pixels and CSS viewport: 880 × 680 at device pixel ratio 1
- Narrow viewport: 567 × 730 at device pixel ratio 1
- Density normalization: the source and implementation were scaled proportionally to equal visual height on the combined comparison board; neither image was resampled or cropped before comparison.
- State: light theme, connected Button component, mapped `size` code prop focused, Figma source selected, value alignment visible.

## Full-view comparison evidence

The post-fix comparison shows the same primary anatomy as the approved design: source and progress header, persistent code-prop queue, focused-prop inspector, source-mode control, candidate list, value alignment, and persistent save area. The production plugin keeps its existing global navigation, connection metadata, Figma blue interaction token, and resizable window behavior; these are intentional product constraints rather than redesign drift.

At 567 px, the workbench stacks the inspector below the code-prop queue with no horizontal overflow. The measured document `clientWidth` and `scrollWidth` were both 567 px.

## Focused region comparison evidence

The dense mapping region required a focused pass. Candidate controls, selected states, type labels, warning flags, value selects, divider rhythm, and the active code-prop row were inspected at 880 × 680. The selected Figma candidate and aligned values remain keyboard-operable semantic controls, and the narrow layout preserves readable rows and filter controls.

## Required fidelity surfaces

- Fonts and typography: uses the existing Figma/Inter stack and compact 10–14 px hierarchy. Labels, types, current values, and inspector headings remain legible without wrapping collisions.
- Spacing and layout rhythm: the two-pane proportions, header spacing, list density, control padding, dividers, and sticky footer follow the source direction. The production viewport scrolls vertically because it also includes the plugin’s existing navigation and setup context.
- Colors and visual tokens: surfaces and semantic states use the project’s Figma theme tokens. The approved mock’s purple accent becomes the plugin’s established blue brand/selection token; warning and success colors retain their semantic meaning.
- Image quality and assets: the target contains no product imagery. Existing library icons remain vector-rendered; no placeholder imagery, custom SVG art, emoji, or CSS illustration substitutes were added.
- Copy and content: “Connect Button,” source replacement, filters, source modes, Figma candidates, value alignment, and live preview language are preserved. Dynamic source-contract labels and validation messages remain authoritative.
- Accessibility and behavior: labeled radiogroups, native selects, focus-visible states, disabled states, row navigation, All/Review filtering, and responsive no-overflow behavior were verified. No console warnings or errors were present.

## Comparison history

### Pass 1 — blocked

- [P2] Code-only choices remained visible while Figma mode was selected.
  - Evidence: the first comparison showed a full “Code value” section between Figma candidates and value alignment, pushing the alignment table and live preview farther below the viewport than the source design.
  - Impact: the inspector mixed mutually exclusive modes and weakened the selected-mode hierarchy.
  - Fix: render fixed/runtime choices only for unresolved props or when “Set in code” is selected. Figma mode now flows directly from candidates to value alignment and preview.

### Pass 2 — passed

- Post-fix evidence: `call_hlZEPvpOmn6FJtDzR6wxSygu.png`
- The earlier P2 is resolved. No actionable P0, P1, or P2 visual or interaction findings remain.

### Pass 3 — passed (browser annotations)

- Annotated evidence: `call_nkoSEf4nF3X72TBgTzVEp1Yr.png`
- Code-prop type labels now hug their content; `ButtonSizeType` measured 94.29 px wide in a 567 px viewport.
- The source-mode control reuses the existing `SegmentedControl`, and Figma candidate selection uses the existing `Dropdown` rather than introducing new tab or card components.
- Existing library status icons replace the status dots, while preserving resolved and review semantics.
- Mapping warnings use the requested 12 px left inset.
- The intentional candidate-control change supersedes the earlier candidate-card treatment. The annotated layout has no horizontal overflow and produced no console warnings or errors.

### Pass 4 — passed (interaction refinement)

- The existing segmented control now hugs its labels at 168.48 px wide and uses its native 24 px segment height instead of the previous 48 px wrapper.
- Mapping an auto-focused prop keeps that prop selected. Browser verification mapped `color` and confirmed the inspector heading and expanded row both remained on `color`.
- The 567 px layout still has no horizontal overflow, and the browser console remains free of warnings and errors.

### Pass 5 — passed (mode disclosure and selector repair)

- The existing segmented control is visible and compact again: its hidden radio inputs measure 0 px and the rendered control measures 24 px high.
- Figma candidates render only in Figma mode. Code-value choices render only in Set in code mode, and the static value field renders only after Fixed value is selected.
- Resolved rows now use the existing `IconApprovedCheckmark16` circle-check icon.
- All mode changes keep the focused prop selected. The 567 px layout has no horizontal overflow and the browser console remains clean.

### Pass 6 — passed (content and hierarchy refinement)

- Fixed values use the existing `Textbox` component without a datalist or suggestion dropdown.
- Code-value choices use a two-line title/caption layout, and the omit mode is labeled “Left out.”
- Generated JSX renders one prop per line; the verified Button preview uses seven readable lines without blank attribute rows.
- The semantic source header now groups component identity, filename, title, and description together, with progress and source replacement in a compact action column.
- The 567 px header measures 92 px high, the layout has no horizontal overflow, and the browser console remains clean.

### Pass 7 — passed (unrestricted values and control hierarchy)

- Fixed-value text accepts arbitrary input without enum validation messaging; browser verification entered `anything-custom` and the generated JSX preserved it.
- Fixed value and In the app now form two full-width rows.
- The source modes use existing library icons for Figma, Set in code, and Left out.
- The semantic header is split into a source-management row and a separate connection-status row.
- The 567 px layout has no horizontal overflow, all three icons render, and the browser console remains clean.

### Pass 8 — passed (non-blocking source interface selection)

- Source upload no longer requires an exact `${ComponentName}Props` interface when several prop interfaces exist.
- Candidate selection is deterministic: component-name affinity wins, then exported and more substantial interfaces, with source order as the stable tie-breaker.
- The reported `Modal` upload now selects `InfoModalProps` ahead of `StyleProps` and `DesktopHeaderProps`, continues into prop mapping, and records the mismatch as a non-blocking analysis warning.
- The full 615-test suite, typecheck, lint, production build, and browser smoke check pass.

### Pass 9 — passed (nested-instance property discovery)

- The Figma source dropdown now uses its existing grouping support to separate “Component properties” from “Nested instances.”
- The closed control has a descriptive “Choose a component or nested property” placeholder instead of appearing empty.
- Supporting copy explains that exposed properties from nested instances are included.
- Browser verification confirmed nested options such as `Leading icon / name · trash` appear in the nested group without introducing a new control component.
- The full 615-test suite, typecheck, lint, production build, and responsive browser check pass.

### Pass 10 — passed (nested option label structure)

- Nested options now use `Component name: current sample value · status`.
- Browser verification confirmed `Leading icon: trash` and `Label: Delete account · check types`.
- Top-level component-property labels keep their existing property/type/value structure.
- Internal locator paths and nested property keys remain unchanged; only the reader-facing option label was simplified.

### Pass 11 — passed (explicit nested property names)

- Nested options now use `Component name: Property name - current sample value`.
- Browser verification confirmed `Leading icon: name - trash` and `Label: text - Delete account`.
- Nested text layers use `text` as their property name; nested component values use their real exposed property name.
- Compatibility status is no longer appended to nested option labels.

### Pass 12 — passed (wide layout and actionable progress)

- The mapping card now uses an explicit 800 px responsive threshold: widths above 800 px use the two-column code-prop list and inspector, while 800 px and below stack them.
- At widths above 800 px, the source-management and mapping-summary header regions also share one row.
- Progress now counts every actionable code prop and excludes policy-excluded or unsupported props.
- Browser verification for the Button fixture reports `2/10 resolved` instead of the meaningless `0/0 required`.
- The 665 px narrow state remains readable with no horizontal overflow.

## Follow-up polish

- [P3] The generated preview can sit below the initial 680 px viewport when a prop has several candidate and value rows. It remains reachable by vertical scrolling and the persistent footer stays visible.
- [P3] The source mock includes hand-authored prop descriptions and status chips that are not present in every parsed source contract. The implementation uses available type and resolution data instead of inventing descriptions.

## Implementation checklist

- [x] Two-pane workbench and focused inspector
- [x] Shared anatomy for semantic and standard mappings
- [x] Figma / Set in code / Omit source modes
- [x] Candidate selection and value alignment
- [x] Live generated preview
- [x] All / Review filtering
- [x] Responsive stacked layout with no horizontal overflow
- [x] Existing persistence, reconciliation, validation, upload, and save behavior preserved
- [x] Browser-rendered evidence, primary interactions, and console checked

final result: passed
## Pass 13 — Wide inspector vertical rhythm

- The inspector grid now aligns content to the top and keeps each section at its natural height.
- Focused prop, source mode, property selection, warnings, and code preview retain a consistent 16px section rhythm instead of stretching across the available panel height.
- Verified in the browser at 973×814: the inspector remains compact while the left prop list can continue independently.
## Pass 14 — Radio geometry and two-row source header

- Radio indicators now use a 16×16 border-box with an optically centered 8×8 selected dot.
- The source summary header stays in exactly two rows at every viewport: source/action first, mapping summary/progress second.
- Verified in the browser at 973×814 in the selected “In the app” state.
