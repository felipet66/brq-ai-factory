import type { PlaygroundBuiltPreview } from '@/api/playground-contracts';

import styles from './playground.module.css';

interface KnowledgeInspectorProps {
  readonly knowledge: PlaygroundBuiltPreview['knowledge'];
}

export function KnowledgeInspector({ knowledge }: KnowledgeInspectorProps) {
  return (
    <section className={styles.contentPanel} aria-labelledby="knowledge-inspector-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>Authorized references</p>
          <h2 id="knowledge-inspector-heading">Knowledge inspector</h2>
        </div>
        <span>
          {knowledge.budget.usedDocuments}/{knowledge.budget.maxDocuments} documents
        </span>
      </div>
      <p className={styles.supportingText}>
        Document content is intentionally omitted. Only metadata used by this build is projected.
      </p>
      <dl className={styles.contractFacts}>
        <div>
          <dt>Context</dt>
          <dd>{knowledge.context}</dd>
        </div>
        <div>
          <dt>Manifest version</dt>
          <dd>{knowledge.manifestVersion}</dd>
        </div>
        <div>
          <dt>Policy version</dt>
          <dd>{knowledge.policyVersion}</dd>
        </div>
        <div>
          <dt>Bytes</dt>
          <dd>
            {knowledge.budget.usedBytes}/{knowledge.budget.maxBytes}
          </dd>
        </div>
        <div>
          <dt>Context hash</dt>
          <dd>
            <code>{knowledge.contextHash}</code>
          </dd>
        </div>
      </dl>
      <div className={styles.tableScroller}>
        <table className={styles.knowledgeTable}>
          <caption className="sr-only">Knowledge references included in the prompt</caption>
          <thead>
            <tr>
              <th scope="col">Document ID</th>
              <th scope="col">Category</th>
              <th scope="col">Requirement</th>
              <th scope="col">Bytes</th>
              <th scope="col">Hash</th>
            </tr>
          </thead>
          <tbody>
            {knowledge.documents.length === 0 ? (
              <tr>
                <td colSpan={5}>No knowledge documents were selected.</td>
              </tr>
            ) : null}
            {knowledge.documents.map((document) => (
              <tr key={document.id}>
                <td>
                  <code>{document.id}</code>
                </td>
                <td>{document.category}</td>
                <td>{document.selection}</td>
                <td>{document.sizeBytes}</td>
                <td>
                  <code>{document.hash}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {knowledge.ignored.length === 0 && knowledge.missing.length === 0 ? null : (
        <div className={styles.knowledgeExceptions}>
          <section>
            <h3>Ignored</h3>
            <ul>
              {knowledge.ignored.map((item, index) => (
                <li key={`${item.id ?? 'unknown'}-${index}`}>
                  <code>{item.id ?? 'Unknown document'}</code> · {item.reason}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3>Missing</h3>
            <ul>
              {knowledge.missing.map((item) => (
                <li key={item.id}>
                  <code>{item.id}</code> · {item.required ? 'REQUIRED' : 'OPTIONAL'}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </section>
  );
}
