# Maintain a Connection

A saved connection records two snapshots: the Figma component schema and, when
source was uploaded, the component's extracted TypeScript prop schema. Those
snapshots let the plugin identify changes before they produce incorrect code.

The goal is deliberate maintenance: review changes, keep valid mappings, and
remove obsolete mappings only when you decide to do so.

## Connection health

| Status | Meaning | What to do |
| --- | --- | --- |
| **Healthy** | No known drift, conflicts, or incomplete source-backed mappings. | Continue using the connection. |
| **Needs review** | A source/Figma addition or rename was found, an option changed, or a source value is not mapped. | Review the affected rows and save after confirming the intended mapping. |
| **Broken** | A mapping points to a removed/incompatible Figma property or a removed/changed source prop. | Resolve or remove the stale mapping before saving. |
| **Source refresh required** | A saved source snapshot exists but has not been re-uploaded in this session, so source drift cannot be checked. | Use **Replace source** and save after review. |

Because raw source text is never stored, **Source refresh required** is expected
after opening a saved source-backed connection in a new plugin session. It is a
prompt to revalidate the connection, not an indication that its saved mappings
have been lost.

## Routine update flow

Use this flow whenever the component evolves in code or Figma:

1. Select the same Figma main component or component set.
2. Open **Connect component**.
3. If source changed, choose **Replace source** and upload the current `.ts` or
   `.tsx` files. Include the props/types file and implementation file when they
   are separate.
4. If Figma changed, choose **Review Figma changes**.
5. Inspect the health panel and mapping rows. Confirm compatible suggestions,
   fill missing values, or deliberately leave Figma-only properties unmapped.
6. For obsolete rows, choose **Remove stale _prop_ mapping**. This is an explicit
   action; nothing is silently deleted during reconciliation.
7. Click **Save** to confirm the new snapshots. The connection revision and
   validation timestamp advance only after save succeeds.

## What the plugin detects

### Figma drift

The plugin compares the saved and current Figma snapshots by stable property ID.
It reports:

- added, removed, renamed, or type-changed properties;
- added or removed variant options; and
- a removed option used by a mapping.

An unreferenced removed property is a review item. If an active mapping relies
on a removed property, type, or option, the connection is Broken.

### Source drift

After a source re-upload, the plugin compares the newly parsed source snapshot
with the saved one. It reports added, removed, potentially renamed, and
type-changed props. A removed or changed prop that an existing mapping uses is
Broken; an unrelated change is normally Needs review.

The source comparison is based on the uploaded files. The plugin does not scan
the repository, retrieve source over the network, or persist the source text.

### Incomplete mappings and conflicts

For source props the visual editor supports, the plugin also checks that each
prop is connected and that boolean/union values have mappings. It flags a
conflict when a mapping refers to a source prop or Figma property that no longer
exists.

## Design-only Figma properties

Figma often has states that exist for prototypes or design inspection, not for
the component's public React API. For example, `Status = Idle | Hover | Pressed`
on a Switch may describe an interaction state while code exposes only `checked`.

Do not invent a React prop for that state. Leave it unmapped. Once it is part of
the saved Figma snapshot, the plugin treats it as intentionally outside code
generation. If the design team adds a *new* property later, it still appears as
Needs review so the connection owner can choose whether it belongs in code.

## Why stale mappings are retained

Automatic deletion is dangerous: it could silently change generated code after
a temporary rename, a mistake in Figma, or an incomplete source upload. During
reconciliation, the plugin keeps stale rows visible and reports their state.
Only **Remove stale ... mapping** followed by **Save** removes them from the
stored connection.

## Revalidation checklist

Before saving an updated connection, confirm:

- Component name and import path still identify the exported React component.
- Uploaded source describes the intended props interface.
- Every source-backed variant/boolean value has the expected Figma option.
- `children` is mapped only if the source exposes it.
- Leading/trailing icon slots target the intended instance-swap property.
- Figma-only behavior, such as prototype `Status`, remains intentionally
  unmapped.
- Any remaining **Broken** message has been resolved.

For the mapping rules themselves, see [Visual prop mappings](prop-mapping.md).
