import { useState } from 'react';

import type { PlaygroundBuiltPreview } from '@/api/playground-contracts';

import { AccessibleTabs, tabId, tabPanelId } from './accessible-tabs';
import styles from './playground.module.css';

type PromptTab = 'INSTRUCTIONS' | 'INPUT';
const PROMPT_TABS = [
  { id: 'INSTRUCTIONS', label: 'Instructions' },
  { id: 'INPUT', label: 'Input' },
] as const;

interface PromptPreviewProps {
  readonly prompt: PlaygroundBuiltPreview['prompt'];
}

export function PromptPreview({ prompt }: PromptPreviewProps) {
  const [activeTab, setActiveTab] = useState<PromptTab>('INSTRUCTIONS');
  const content = activeTab === 'INSTRUCTIONS' ? prompt.instructions : prompt.input;

  return (
    <section className={styles.contentPanel} aria-labelledby="prompt-preview-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>Resolved runtime view</p>
          <h2 id="prompt-preview-heading">Prompt preview</h2>
        </div>
        <span>Read-only</span>
      </div>
      <div className={styles.subTabs}>
        <AccessibleTabs
          activeTab={activeTab}
          ariaLabel="Prompt channels"
          idPrefix="prompt-preview"
          onChange={setActiveTab}
          tabs={PROMPT_TABS}
        />
      </div>
      <div
        id={tabPanelId('prompt-preview', activeTab)}
        role="tabpanel"
        aria-labelledby={tabId('prompt-preview', activeTab)}
        tabIndex={0}
      >
        <pre className={styles.codePreview}>
          <code>{content}</code>
        </pre>
      </div>
    </section>
  );
}
