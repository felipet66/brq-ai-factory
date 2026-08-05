export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center px-6 py-16">
      <section className="max-w-3xl space-y-6">
        <p className="text-sm font-semibold tracking-[0.2em] text-[var(--accent)] uppercase">
          Sprint 0 · Foundation
        </p>
        <h1 className="text-5xl font-semibold tracking-tight sm:text-7xl">BRQ AI Factory</h1>
        <p className="max-w-2xl text-lg leading-8 text-[var(--muted)] sm:text-xl">
          A fundação local da plataforma AI First está pronta para evoluir por Sprints, com
          arquitetura modular, contratos validados e revisão humana.
        </p>
        <dl className="grid gap-4 pt-6 sm:grid-cols-3">
          {[
            ['Runtime', 'Node.js 24 LTS'],
            ['Interface', 'Next.js App Router'],
            ['Persistência', 'SQLite local'],
          ].map(([term, description]) => (
            <div key={term} className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <dt className="text-sm text-[var(--muted)]">{term}</dt>
              <dd className="mt-2 font-medium">{description}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
