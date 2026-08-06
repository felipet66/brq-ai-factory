interface ErrorStateProps {
  readonly message: string;
}

export function ErrorState({ message }: ErrorStateProps) {
  return (
    <section className="execution-state execution-state--error" role="alert" aria-live="assertive">
      <p className="state-label">Execution error</p>
      <h2>Unable to complete the request</h2>
      <p>{message}</p>
    </section>
  );
}
