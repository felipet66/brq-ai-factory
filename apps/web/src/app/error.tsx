'use client';

interface ErrorPageProps {
  reset: () => void;
}

export default function ErrorPage({ reset }: ErrorPageProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-16">
      <section className="space-y-4">
        <p className="text-sm font-semibold text-[var(--accent)] uppercase">Erro inesperado</p>
        <h1 className="text-4xl font-semibold">Não foi possível concluir esta operação.</h1>
        <p className="text-[var(--muted)]">Tente novamente. Nenhum detalhe interno foi exposto.</p>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 font-semibold text-slate-950"
        >
          Tentar novamente
        </button>
      </section>
    </main>
  );
}
