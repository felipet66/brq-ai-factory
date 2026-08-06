export function LoadingState() {
  return (
    <div className="execution-state execution-state--loading" role="status" aria-live="polite">
      <span className="loading-indicator" aria-hidden="true" />
      <div>
        <h2>Executing workflow</h2>
        <p>Product Owner, Developer and QA are working in sequence.</p>
      </div>
    </div>
  );
}
