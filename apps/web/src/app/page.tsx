import { ExecutionExperience } from '@/components/execution/execution-experience';

export default function HomePage() {
  return (
    <main className="factory-shell" lang="en">
      <div className="factory-layout">
        <header className="factory-hero">
          <p className="eyebrow">Modular AI delivery platform</p>
          <h1>BRQ AI Factory</h1>
          <p className="factory-hero__description">
            Turn a human objective into product, engineering and quality specifications through one
            deterministic workflow.
          </p>

          <ol className="workflow-stages" aria-label="Workflow stages">
            <li>
              <span>01</span>
              Product Owner
            </li>
            <li>
              <span>02</span>
              Developer
            </li>
            <li>
              <span>03</span>
              QA
            </li>
          </ol>
        </header>

        <ExecutionExperience />
      </div>
    </main>
  );
}
