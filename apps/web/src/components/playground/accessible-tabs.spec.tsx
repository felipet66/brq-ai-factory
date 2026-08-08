import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccessibleTabs, tabId, tabPanelId } from './accessible-tabs';

const TABS = [
  { id: 'FIRST_TAB', label: 'First' },
  { id: 'SECOND_TAB', label: 'Second' },
  { id: 'THIRD_TAB', label: 'Third' },
] as const;

afterEach(cleanup);

describe('AccessibleTabs', () => {
  it('derives stable tab and panel ids', () => {
    expect(tabId('inspector', 'OUTPUT_CONTRACT')).toBe('inspector-tab-output-contract');
    expect(tabPanelId('inspector', 'OUTPUT_CONTRACT')).toBe('inspector-panel-output-contract');
  });

  it('exposes the active tab and handles pointer selection', () => {
    const onChange = vi.fn();
    render(
      <AccessibleTabs
        activeTab="SECOND_TAB"
        ariaLabel="Inspector views"
        idPrefix="inspector"
        onChange={onChange}
        tabs={TABS}
      />,
    );

    expect(screen.getByRole('tablist', { name: 'Inspector views' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'First' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Second' })).toHaveAttribute(
      'aria-controls',
      'inspector-panel-second-tab',
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Third' }));
    expect(onChange).toHaveBeenCalledWith('THIRD_TAB');
  });

  it.each([
    ['ArrowRight', 'FIRST_TAB', 'SECOND_TAB', 'Second'],
    ['ArrowRight', 'THIRD_TAB', 'FIRST_TAB', 'First'],
    ['ArrowLeft', 'FIRST_TAB', 'THIRD_TAB', 'Third'],
    ['ArrowLeft', 'SECOND_TAB', 'FIRST_TAB', 'First'],
    ['Home', 'THIRD_TAB', 'FIRST_TAB', 'First'],
    ['End', 'FIRST_TAB', 'THIRD_TAB', 'Third'],
  ] as const)('handles %s from %s', (key, activeTab, expected, expectedLabel) => {
    const onChange = vi.fn();
    render(
      <AccessibleTabs
        activeTab={activeTab}
        ariaLabel="Inspector views"
        idPrefix="inspector"
        onChange={onChange}
        tabs={TABS}
      />,
    );

    const current = screen.getByRole('tab', {
      name: TABS.find(({ id }) => id === activeTab)!.label,
    });
    current.focus();
    const eventResult = fireEvent.keyDown(current, { key });

    expect(eventResult).toBe(false);
    expect(onChange).toHaveBeenCalledWith(expected);
    expect(screen.getByRole('tab', { name: expectedLabel })).toHaveFocus();
  });

  it('ignores unrelated keys without moving focus or changing selection', () => {
    const onChange = vi.fn();
    render(
      <AccessibleTabs
        activeTab="FIRST_TAB"
        ariaLabel="Inspector views"
        idPrefix="inspector"
        onChange={onChange}
        tabs={TABS}
      />,
    );

    const first = screen.getByRole('tab', { name: 'First' });
    first.focus();
    const eventResult = fireEvent.keyDown(first, { key: 'Enter' });

    expect(eventResult).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(first).toHaveFocus();
  });
});
