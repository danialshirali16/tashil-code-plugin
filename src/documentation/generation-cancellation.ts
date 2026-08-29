export class DocumentationGenerationCancelledError extends Error {
  constructor() {
    super('Documentation generation was cancelled.');
    this.name = 'DocumentationGenerationCancelledError';
  }
}

export type DocumentationGenerationCancellation = {
  throwIfCancelled: () => void;
  yieldToMain: () => Promise<void>;
};

export function createDocumentationGenerationCancellation(
  isCancelled: () => boolean,
): DocumentationGenerationCancellation {
  const throwIfCancelled = (): void => {
    if (isCancelled()) {
      throw new DocumentationGenerationCancelledError();
    }
  };

  return {
    throwIfCancelled,
    yieldToMain: async (): Promise<void> => {
      throwIfCancelled();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      throwIfCancelled();
    },
  };
}

export function isDocumentationGenerationCancelledError(
  error: unknown,
): error is DocumentationGenerationCancelledError {
  return error instanceof DocumentationGenerationCancelledError
    || (error instanceof Error && error.name === 'DocumentationGenerationCancelledError');
}
