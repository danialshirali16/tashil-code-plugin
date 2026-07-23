# Visual Prop Mappings

Visual prop mappings connect a real React component API to the properties on a
Figma component. They are authored in **Source & prop mappings** and compiled
to the JSON lookup table used by Dev Mode code generation.

The editor is source-led: upload the TypeScript definition first, then choose
the matching Figma property and value for each source prop. Suggestions are
based on compatible property types, names, and values, but every suggestion is
editable.

## What the plugin reads

### From TypeScript

Upload one or more local `.ts` or `.tsx` files. The props declaration must be
an interface whose name exactly matches the component name plus `Props` (for
example, `SwitchProps`); a type alias is not currently discovered as a props
interface. Literal-union aliases are resolved only when they are declared in
that same props file, not when they are imported. Uploading the implementation
file is optional and only helps the plugin discover simple destructured defaults.

The parser classifies props as follows:

| Source prop shape | Editor behavior |
| --- | --- |
| Literal union | A standard prop with visual value-mapping rows that can map to a Figma variant. |
| Boolean | A standard prop with `true` and `false` value-mapping rows that can map to a Figma boolean or two-option variant. |
| Unconstrained `string` or `number` | Can be associated with a Figma variant, but has no inferred concrete values. Add a custom mapping when runtime values must be emitted. |
| `children` | A content row that can map only to a Figma text property. |
| `renderLeftIcon` or `renderRightIcon` typed as a React node | An icon-slot row that can map only to a Figma instance-swap property. |
| Event callbacks, styling props, unsupported types, and arbitrary React nodes | Not shown as normal mapping rows. They are not inferred into generated code; use Custom wildcard & raw mappings only when an explicit runtime mapping is truly needed. |

Source text stays on the local machine. The saved connection contains only the
derived prop schema, selected file name, and a content hash.

### From Figma

The selected component or component set is snapshotted with its property IDs,
names, types, defaults, and options. The editor matches compatible shapes:

| Source prop | Compatible Figma property |
| --- | --- |
| Literal union or unconstrained string/number prop | Variant |
| Boolean prop | Boolean or a two-option variant |
| `children` | Text |
| `renderLeftIcon` or `renderRightIcon` React-node slot | Instance swap |

## Mapping workflow

1. Select the Figma main component or component set and open **Connect component**.
2. Fill **Component name** and **Import path**.
3. Choose **Upload source** (or drop files into the panel).
4. For each relevant source row, select the matching Figma property.
5. For union and boolean props, connect every source value to its Figma option.
6. Review incomplete-mapping or drift feedback, then click **Save**.

The editor displays source values on the left and Figma values on the right.
For example, a source `size: 'small' | 'medium'` might map to Figma `Size`
values `Small` and `Medium`. At runtime, the lookup runs in the other direction:
the active Figma value determines the generated source prop.

## Content, icons, and components without children

There is no standalone Children field. When the uploaded source declares
`children`, map it to a Figma text property such as `label`, `text`, or
`buttonText`. The generated snippet then includes JSX children.

If the source snapshot does **not** declare `children`, the plugin generates
self-closing JSX and does not look for a Figma `label` property. This is the
correct setup for controls such as `Switch` that do not render component text.

For Button-style icon slots, connect Figma `leadingIcon` to `renderRightIcon`
and Figma `trailingIcon` to `renderLeftIcon`. Those names preserve the Swiss
Army Knife Button's RTL orientation. The plugin converts the active Figma
instance-swap component into an `Icon` React node. Associated visibility flags
such as `hasLeadingIcon` and `hasTrailingIcon` are guards; they are not emitted
as React props.

## Figma-only properties

Not every Figma property needs a React prop. A Figma-only property is useful
for prototype behavior or a design state that source code does not expose.

Leave that property unmapped. After the mapping is saved, a property already in
the saved Figma snapshot with no source mapping is treated as intentionally
outside code generation. It will not generate a missing-mapping diagnostic or
an unknown React prop.

If Figma adds a new property after the connection was saved, the connection
instead becomes **Needs review**. This makes a newly introduced design decision
visible without forcing every pre-existing design-only property into code.

### Switch example

Suppose Figma exposes:

```txt
Size: Small
Select: No | Yes
Status: Idle | Hover | Pressed | Disable
```

and the source interface is:

```tsx
interface SwitchProps {
  size?: 'large' | 'small';
  disabled?: boolean;
  checked: boolean;
  onChange: () => void;
}
```

Map `size` to `Size` and `checked` to `Select`. Do not map `Status` if it is
only a Figma interaction state. Because the source has no `children`, no label
mapping is necessary. For `Size = Small`, `Select = No`, and `Status = Idle`,
the result can be:

```tsx
import { Switch } from "@tashilcar/swiss-army-knife";

<Switch size={"small"} />
```

If the code API is meant to receive `disabled` from `Status = Disable`, it is
not a one-to-one visual boolean mapping because `Status` has more than two
options. Prefer a dedicated Figma boolean property, or explicitly map every
relevant `Status` value through Custom wildcard & raw mappings. Do not use a
design-only interaction state as a code input by accident.

## Custom wildcard and raw mappings

The visual editor owns ordinary source/Figma property mappings. Use **Custom
wildcard & raw mappings** only for mappings that the editor cannot represent,
such as dynamic instance-swap handling or a deliberate code expression. They
remain separate from visual mappings and are preserved while ordinary rows are
edited.

The read-only **Generated JSON preview** shows the final combined mapping table.
Each runtime entry has a JSX prop name and a string, number, or boolean value:

```json
{
  "Select": {
    "Yes": { "prop": "checked", "value": true },
    "No": { "prop": "checked", "value": false }
  }
}
```

An optional `"raw": true` flag emits a string as a TSX expression. Use it only
when the value is valid code; ordinary strings should remain normal values.

## Diagnostics

Dev Mode keeps diagnostics separate from the copyable TSX. Review them when:

- an active, source-backed Figma property or option has no mapping;
- multiple mappings target the same React prop; or
- a mapping tries to emit a prop reserved for generated children or icon mode.

Figma-only properties saved without a source mapping are intentionally excluded
from this list. See [Maintain a connection](maintain-connections.md) for
source/Figma drift and reconciliation.
