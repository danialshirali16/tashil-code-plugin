import { describe, expect, it } from 'vitest';
import {
  createDocumentationGenerationCancellation,
  DocumentationGenerationCancelledError,
  isDocumentationGenerationCancelledError,
} from './generation-cancellation';

describe('documentation generation cancellation', () => {
  it('throws the shared cancellation error once the active run is invalidated', async () => {
    let cancelled = false;
    const cancellation = createDocumentationGenerationCancellation(() => cancelled);

    expect(() => cancellation.throwIfCancelled()).not.toThrow();
    cancelled = true;

    expect(() => cancellation.throwIfCancelled()).toThrow(DocumentationGenerationCancelledError);
    await expect(cancellation.yieldToMain()).rejects.toSatisfy(
      isDocumentationGenerationCancelledError,
    );
  });
});
