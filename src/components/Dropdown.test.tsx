import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Dropdown } from './SettingsPanel';

const options = [
  { id: 'a', label: 'Option A' },
  { id: 'b', label: 'Option B' },
  { id: 'c', label: 'Option C' },
];

function renderDropdown(overrides: Partial<Parameters<typeof Dropdown>[0]> = {}) {
  const onSelect = vi.fn();
  const utils = render(
    <Dropdown
      options={options}
      value="a"
      onSelect={onSelect}
      disabled={false}
      {...overrides}
    />
  );
  return { onSelect, ...utils };
}

describe('Dropdown', () => {
  afterEach(cleanup);

  it('shows the selected option label and no menu when closed', () => {
    renderDropdown();
    expect(screen.getByRole('button').textContent).toContain('Option A');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens the menu on click and lists every option', () => {
    renderDropdown();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(
      screen.getByRole('option', { name: 'Option A' }).getAttribute('aria-selected')
    ).toBe('true');
  });

  it('selects an option and closes the menu', () => {
    const { onSelect } = renderDropdown();
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('option', { name: 'Option B' }));
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on outside click without selecting', () => {
    const { onSelect } = renderDropdown();
    fireEvent.click(screen.getByRole('button', { name: /Option A/ }));
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    renderDropdown();
    fireEvent.click(screen.getByRole('button'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does not open when disabled', () => {
    renderDropdown({ disabled: true });
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('falls back to the raw value when it is not in the options', () => {
    renderDropdown({ value: 'ghost' });
    expect(screen.getByRole('button').textContent).toContain('ghost');
  });
});
