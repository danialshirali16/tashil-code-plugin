import { describe, expect, it } from 'vitest';
import { generateStorybookCsf } from './storybook';

describe('Storybook CSF generation', () => {
  it('reuses usage imports and emits deterministic unique stories', () => {
    const code = generateStorybookCsf('Button', [
      {
        name: 'Size=Small, State=Default',
        usage: {
          diagnostics: [],
          imports: [{ importedName: 'Button', localName: 'Button', modulePath: '@acme/ui' }],
          jsx: '<Button size={"small"} />',
          storyArgs: ['size={"small"}'],
        },
      },
      {
        name: 'Size=Small, State=Default',
        usage: {
          diagnostics: [],
          imports: [{ importedName: 'Button', localName: 'Button', modulePath: '@acme/ui' }],
          jsx: '<Button size={"small"} disabled />',
          storyArgs: ['size={"small"}', 'disabled'],
        },
      },
    ]);
    expect(code).toContain('import { Button } from "@acme/ui";');
    expect(code).toContain('satisfies Meta<typeof Button>');
    expect(code).toContain('export const SizeSmallStateDefault: Story');
    expect(code).toContain('export const SizeSmallStateDefault2: Story');
    expect(code).toContain('size: "small"');
    expect(code).toMatchSnapshot();
  });
});
