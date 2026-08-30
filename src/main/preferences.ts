import { emit } from '@create-figma-plugin/utilities';
import {
  DEFAULT_OUTPUT_PREFERENCES,
  readOutputPreferences,
  type OutputPreferences,
} from '../output-preferences';
import type {
  LoadOutputPreferencesResultHandler,
  SaveOutputPreferencesResultHandler,
} from '../types';
import { errorMessage } from './types';

export const OUTPUT_PREFERENCES_KEY = 'tashil-output-preferences-v1';

export async function loadOutputPreferences(): Promise<OutputPreferences> {
  try {
    return readOutputPreferences(await figma.clientStorage?.getAsync(OUTPUT_PREFERENCES_KEY));
  } catch (_error) {
    return { ...DEFAULT_OUTPUT_PREFERENCES };
  }
}

export async function emitOutputPreferences(): Promise<void> {
  emit<LoadOutputPreferencesResultHandler>('LOAD_OUTPUT_PREFERENCES_RESULT', {
    preferences: await loadOutputPreferences(),
  });
}

export async function saveOutputPreferences(preferences: OutputPreferences): Promise<void> {
  try {
    const normalized = readOutputPreferences(preferences);
    await figma.clientStorage?.setAsync(OUTPUT_PREFERENCES_KEY, normalized);
    emit<SaveOutputPreferencesResultHandler>('SAVE_OUTPUT_PREFERENCES_RESULT', { ok: true });
  } catch (error) {
    emit<SaveOutputPreferencesResultHandler>('SAVE_OUTPUT_PREFERENCES_RESULT', {
      message: errorMessage(error, 'save output preferences'),
      ok: false,
    });
  }
}
