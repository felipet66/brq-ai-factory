import type { KeyboardEvent } from 'react';

export interface AccessibleTab<Id extends string> {
  readonly id: Id;
  readonly label: string;
}

interface AccessibleTabsProps<Id extends string> {
  readonly activeTab: Id;
  readonly ariaLabel: string;
  readonly idPrefix: string;
  readonly onChange: (tab: Id) => void;
  readonly tabs: readonly AccessibleTab<Id>[];
}

export function tabId(idPrefix: string, tab: string): string {
  return `${idPrefix}-tab-${tab.toLowerCase().replaceAll('_', '-')}`;
}

export function tabPanelId(idPrefix: string, tab: string): string {
  return `${idPrefix}-panel-${tab.toLowerCase().replaceAll('_', '-')}`;
}

export function AccessibleTabs<Id extends string>({
  activeTab,
  ariaLabel,
  idPrefix,
  onChange,
  tabs,
}: AccessibleTabsProps<Id>) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const next = tabs[nextIndex];
    if (next === undefined) return;
    onChange(next.id);
    document.getElementById(tabId(idPrefix, next.id))?.focus();
  }

  return (
    <div role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          id={tabId(idPrefix, tab.id)}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls={tabPanelId(idPrefix, tab.id)}
          tabIndex={activeTab === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
