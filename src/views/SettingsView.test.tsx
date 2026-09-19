/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { h } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutputSettingsView } from './SettingsView';
import { DEFAULT_OUTPUT_PREFERENCES, type OutputPreferences } from '../output-preferences';

describe('OutputSettingsView redesigned', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders all sections, storage badge, and live code preview', () => {
    const handleChange = vi.fn();
    render(
      <OutputSettingsView
        message=""
        onChange={handleChange}
        preferences={DEFAULT_OUTPUT_PREFERENCES}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Output settings' })).toBeTruthy();
    expect(screen.getByText('User-local (clientStorage)')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Syntax & Formatting' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Component Architecture' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Clipboard & Workspace' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Code formatting sample' })).toBeTruthy();
    expect(screen.getAllByText('ButtonRoot').length).toBeGreaterThan(0);
  });

  it('updates styled component pattern when clicking quick preset chips', () => {
    const handleChange = vi.fn();
    render(
      <OutputSettingsView
        message=""
        onChange={handleChange}
        preferences={DEFAULT_OUTPUT_PREFERENCES}
      />,
    );

    const containerChip = screen.getByRole('button', { name: '{Name}Container' });
    fireEvent.click(containerChip);

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({ styledComponentPattern: '{Name}Container' }),
    );
  });

  it('resets all preferences to default values when clicking Reset defaults', () => {
    const handleChange = vi.fn();
    const modifiedPreferences: OutputPreferences = {
      copyMode: 'imports-only',
      indentation: '4',
      previewDirection: 'rtl',
      quoteStyle: 'single',
      semicolons: false,
      styledComponentPattern: '{Name}Custom',
      trailingComma: false,
    };

    render(
      <OutputSettingsView
        message="Custom message"
        onChange={handleChange}
        preferences={modifiedPreferences}
      />,
    );

    const resetButton = screen.getByRole('button', { name: 'Reset defaults' });
    fireEvent.click(resetButton);

    expect(handleChange).toHaveBeenCalledWith(DEFAULT_OUTPUT_PREFERENCES);
  });

  it('toggles semicolons and trailing commas', () => {
    const handleChange = vi.fn();
    render(
      <OutputSettingsView
        message=""
        onChange={handleChange}
        preferences={DEFAULT_OUTPUT_PREFERENCES}
      />,
    );

    const semicolonsToggle = screen.getByLabelText('Semicolons');
    fireEvent.click(semicolonsToggle);

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({ semicolons: false }),
    );
  });

  it('changes quote style to single', () => {
    const handleChange = vi.fn();
    render(
      <OutputSettingsView
        message=""
        onChange={handleChange}
        preferences={DEFAULT_OUTPUT_PREFERENCES}
      />,
    );

    const singleQuote = screen.getByText('Single');
    fireEvent.click(singleQuote);

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({ quoteStyle: 'single' }),
    );
  });

  it('live preview reflects active styled pattern and formatting', () => {
    const customPreferences: OutputPreferences = {
      ...DEFAULT_OUTPUT_PREFERENCES,
      styledComponentPattern: '{Name}Container',
    };

    render(
      <OutputSettingsView
        message=""
        onChange={vi.fn()}
        preferences={customPreferences}
      />,
    );

    expect(screen.getAllByText('ButtonContainer').length).toBeGreaterThan(0);
    expect(screen.getByText('Output example:')).toBeTruthy();
  });
});
