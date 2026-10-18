function AppLoadingScreen({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center overflow-hidden bg-slate-50/65 px-6 backdrop-blur-[1px]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-16 h-72 w-72 rounded-full bg-cyan-200/45 blur-3xl" />
        <div className="absolute -right-20 bottom-16 h-72 w-72 rounded-full bg-sky-200/40 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md px-6 py-8 text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-cyan-200/70 bg-white/60 backdrop-blur-sm">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-500" />
        </div>
        <p className="text-lg font-semibold text-slate-900">{title}</p>
        <p className="mt-2 text-sm text-slate-600">{subtitle}</p>
        <div className="mx-auto mt-6 h-1.5 max-w-56 overflow-hidden rounded-full bg-slate-200/80">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-cyan-500" />
        </div>
      </div>
    </div>
  );
}

export default AppLoadingScreen;
