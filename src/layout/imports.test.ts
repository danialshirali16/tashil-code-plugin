import { describe, expect, it } from 'vitest';
import { collectByPath, renderImportLines } from './imports';
import type { ComponentImport } from './types';

/**
 * Import rendering and aliasing. `renderImportLines` backs the connected
 * component snippet (`createUsageSnippet` / `formatUsageSnippet`), so its
 * output is part of the byte-compatibility contract.
 */

function imports(
  importedName: string,
  modulePath: string,
  localName: string = importedName,
): ComponentImport {
  return { importedName, localName, modulePath };
}

describe('renderImportLines', () => {
  it('renders a single named import', () => {
    expect(renderImportLines([imports('Button', '@tashilcar/ui')]))
      .toBe('import { Button } from "@tashilcar/ui";');
  });

  it('deduplicates the same name and path', () => {
    expect(renderImportLines([
      imports('Button', '@tashilcar/ui'),
      imports('Button', '@tashilcar/ui'),
    ])).toBe('import { Button } from "@tashilcar/ui";');
  });

  it('groups multiple names from one path, insertion order', () => {
    expect(renderImportLines([
      imports('Button', '@tashilcar/ui'),
      imports('Icon', '@tashilcar/ui'),
    ])).toBe('import { Button, Icon } from "@tashilcar/ui";');
  });

  it('emits one line per distinct path, in insertion order', () => {
    expect(renderImportLines([
      imports('IconButton', 'tashil-ui'),
      imports('TrashIcon', 'tashil-icons'),
    ])).toBe([
      'import { IconButton } from "tashil-ui";',
      'import { TrashIcon } from "tashil-icons";',
    ].join('\n'));
  });

  it('resolves same name from different paths with a deterministic alias', () => {
    // The first Card owns the bare name; the second is aliased to Card2.
    const lines = renderImportLines([
      imports('Card', '@tashilcar/ui'),
      imports('Card', '@tashilcar/forms'),
    ]);
    expect(lines).toBe([
      'import { Card } from "@tashilcar/ui";',
      'import { Card as Card2 } from "@tashilcar/forms";',
    ].join('\n'));
  });
});

describe('collectByPath', () => {
  it('reports the localName alias chosen for each entry', () => {
    const map = collectByPath([
      imports('Card', '@tashilcar/ui'),
      imports('Card', '@tashilcar/forms'),
      imports('Card', '@tashilcar/ui'),
    ]);
    const ui = map.get('@tashilcar/ui')!;
    const forms = map.get('@tashilcar/forms')!;
    expect(ui.map((e) => e.localName)).toEqual(['Card', 'Card']);
    expect(forms.map((e) => e.localName)).toEqual(['Card2']);
  });
});
