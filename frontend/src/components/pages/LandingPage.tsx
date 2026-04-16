interface LandingPageProps {
  onGetStarted: () => void;
  onSignIn: () => void;
}

const NAV_LINKS = ['Features', 'How It Works', 'Pricing', 'About'];

const FEATURES = [
  {
    icon: 'edit_document',
    title: 'Canvas-Powered Editor',
    desc: 'A pixel-perfect, canvas-based rich text editor that renders like a real document — not a web form.',
  },
  {
    icon: 'smart_toy',
    title: 'AI Writing Assistant',
    desc: 'Ask your built-in AI to draft, rewrite, summarize, or expand any section of your document instantly.',
  },
  {
    icon: 'spellcheck',
    title: 'Grammar Checker',
    desc: 'Catch typos, passive voice, and style issues in real time with intelligent inline suggestions.',
  },
  {
    icon: 'history',
    title: 'Version History',
    desc: 'Every change is automatically tracked. Roll back to any prior version with a single click.',
  },
  {
    icon: 'comment',
    title: 'Inline Comments',
    desc: 'Add contextual comments directly on text. Perfect for reviews, feedback loops, and team collaboration.',
  },
  {
    icon: 'checklist',
    title: 'Integrated To-Do List',
    desc: 'Track tasks alongside your document without switching apps. Stay focused and in flow.',
  },
];

const STEPS = [
  {
    number: '01',
    title: 'Create your account',
    desc: 'Sign up in seconds — no credit card required. Your workspace is ready immediately.',
  },
  {
    number: '02',
    title: 'Open the editor',
    desc: 'Choose a page size, set your margins, and start writing in a beautiful, distraction-free canvas.',
  },
  {
    number: '03',
    title: 'Collaborate & ship',
    desc: 'Comment, review, version-control, and export your polished document with one click.',
  },
];

const STATS = [
  { value: '10×', label: 'Faster than traditional editors' },
  { value: '99.9%', label: 'Uptime guarantee' },
  { value: '256-bit', label: 'AES encryption at rest' },
  { value: '∞', label: 'Document pages per workspace' },
];

export default function LandingPage({ onGetStarted, onSignIn }: LandingPageProps) {
  return (
    <div className="h-full overflow-y-auto bg-white font-sans text-slate-800 antialiased">

      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          {/* Logo */}
          <span className="text-2xl font-extrabold tracking-tight text-slate-800">
            DocSynq
            <span className="ml-2 text-sm font-semibold text-cyan-700">Beta</span>
          </span>

          {/* Desktop links */}
          <ul className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map((link) => (
              <li key={link}>
                <a
                  href={`#${link.toLowerCase().replace(/\s+/g, '-')}`}
                  className="text-sm font-semibold text-slate-600 transition-colors hover:text-cyan-700"
                >
                  {link}
                </a>
              </li>
            ))}
          </ul>

          {/* CTAs */}
          <div className="flex items-center gap-3">
            <button
              onClick={onSignIn}
              className="hidden rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-cyan-700 sm:block"
            >
              Sign In
            </button>
            <button
              onClick={onGetStarted}
              className="rounded-xl bg-cyan-700 px-5 py-2 text-sm font-bold text-white shadow-md shadow-cyan-200/60 transition-all hover:bg-cyan-600 active:scale-[0.98]"
            >
              Get Started Free
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden bg-linear-to-br from-slate-50 via-cyan-50/40 to-white px-6 py-24 text-center">
        {/* Background blobs */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-40 -top-40 h-125 w-125 rounded-full bg-cyan-200/20 blur-3xl" />
          <div className="absolute -bottom-40 -right-40 h-125 w-125 rounded-full bg-slate-300/15 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-4xl">
          <span className="mb-6 inline-block rounded-full border border-cyan-200 bg-cyan-50 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-cyan-700">
            The Future of Workspace
          </span>
          <h1 className="mb-6 text-5xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-6xl lg:text-7xl">
            Write. Collaborate.{' '}
            <span className="bg-linear-to-r from-cyan-600 to-cyan-800 bg-clip-text text-transparent">
              Ship.
            </span>
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-lg text-slate-500 sm:text-xl">
            DocSynq is a canvas-powered document editor with built-in AI, grammar checking, version
            history, and real-time collaboration — all in one seamless workspace.
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button
              onClick={onGetStarted}
              className="w-full rounded-2xl bg-cyan-700 px-8 py-3.5 text-base font-bold text-white shadow-lg shadow-cyan-200/70 transition-all hover:bg-cyan-600 active:scale-[0.98] sm:w-auto"
            >
              Start for Free →
            </button>
            <a
              href="#how-it-works"
              className="w-full rounded-2xl border border-slate-200 bg-white px-8 py-3.5 text-base font-semibold text-slate-700 shadow-sm transition-all hover:border-cyan-300 hover:text-cyan-700 sm:w-auto"
            >
              See How It Works
            </a>
          </div>
        </div>

        {/* Mock editor frame */}
        <div className="relative mx-auto mt-20 max-w-5xl">
          <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-2xl shadow-slate-300/40">
            {/* Fake window chrome */}
            <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-red-400" />
              <span className="h-3 w-3 rounded-full bg-yellow-400" />
              <span className="h-3 w-3 rounded-full bg-green-400" />
              <span className="mx-auto text-xs font-semibold text-slate-400">DocSynq — Untitled Document</span>
            </div>
            {/* Fake toolbar */}
            <div className="flex items-center gap-3 border-b border-slate-100 bg-white px-4 py-2">
              {['Bold', 'Italic', 'Underline'].map((t) => (
                <span key={t} className="rounded px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-100">{t[0]}</span>
              ))}
              <span className="h-4 w-px bg-slate-200" />
              {['H1', 'H2', 'H3'].map((t) => (
                <span key={t} className="rounded px-2 py-1 text-xs font-semibold text-slate-500">{t}</span>
              ))}
              <span className="h-4 w-px bg-slate-200" />
              <span className="ml-auto rounded-lg bg-cyan-700 px-3 py-1 text-xs font-bold text-white">Save</span>
            </div>
            {/* Fake canvas area */}
            <div className="bg-slate-50 px-10 py-10">
              <div className="mx-auto max-w-2xl rounded-lg bg-white p-10 shadow-sm">
                <div className="mb-3 h-3 w-1/3 rounded-full bg-slate-800/80" />
                <div className="mb-6 h-2 w-1/4 rounded-full bg-slate-300" />
                <div className="space-y-2">
                  {[100, 95, 88, 100, 72, 85, 60].map((w, i) => (
                    <div key={i} className={`h-2 rounded-full bg-slate-200`} style={{ width: `${w}%` }} />
                  ))}
                </div>
                <div className="mt-6 space-y-2">
                  {[92, 100, 78, 95, 55].map((w, i) => (
                    <div key={i} className={`h-2 rounded-full bg-slate-100`} style={{ width: `${w}%` }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
          {/* Floating badges */}
          <div className="absolute -left-6 top-1/2 -translate-y-1/2 hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-xl lg:block">
            <p className="text-xs font-bold text-slate-500">AI Assistant</p>
            <p className="mt-1 text-sm font-semibold text-slate-700">"Rewrite this paragraph…"</p>
            <div className="mt-2 h-1.5 w-32 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full w-2/3 rounded-full bg-cyan-500" />
            </div>
          </div>
          <div className="absolute -right-6 bottom-12 hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-xl lg:block">
            <p className="text-xs font-bold text-green-600">✓ Grammar OK</p>
            <p className="mt-1 text-sm font-semibold text-slate-700">Version saved</p>
            <p className="text-xs text-slate-400">just now</p>
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="border-y border-slate-100 bg-slate-50 px-6 py-14">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-8 sm:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-3xl font-extrabold tracking-tight text-cyan-700">{s.value}</p>
              <p className="mt-1 text-sm font-semibold text-slate-500">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <span className="mb-3 inline-block text-xs font-bold uppercase tracking-widest text-cyan-700">Features</span>
            <h2 className="text-4xl font-extrabold tracking-tight text-slate-900">
              Everything you need to write better
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-500">
              A complete document workspace — no plugins, no extensions, no extra tabs.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-slate-100 bg-white p-7 shadow-sm transition-all hover:-translate-y-1 hover:border-cyan-200 hover:shadow-md hover:shadow-cyan-100/60"
              >
                <span className="material-icons mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-50 text-2xl text-cyan-700 group-hover:bg-cyan-100">
                  {f.icon}
                </span>
                <h3 className="mb-2 text-base font-bold text-slate-800">{f.title}</h3>
                <p className="text-sm leading-relaxed text-slate-500">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section id="how-it-works" className="bg-linear-to-br from-slate-50 to-cyan-50/30 px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="mb-16 text-center">
            <span className="mb-3 inline-block text-xs font-bold uppercase tracking-widest text-cyan-700">How It Works</span>
            <h2 className="text-4xl font-extrabold tracking-tight text-slate-900">
              Up and running in minutes
            </h2>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <div key={step.number} className="relative flex flex-col items-center text-center">
                {i < STEPS.length - 1 && (
                  <div className="absolute left-1/2 top-7 hidden h-0.5 w-full translate-x-1/2 bg-slate-200 md:block" />
                )}
                <div className="relative z-10 mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-cyan-200 bg-white text-xl font-extrabold text-cyan-700 shadow-sm">
                  {step.number}
                </div>
                <h3 className="mb-2 text-base font-bold text-slate-800">{step.title}</h3>
                <p className="text-sm leading-relaxed text-slate-500">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing placeholder ── */}
      <section id="pricing" className="px-6 py-24">
        <div className="mx-auto max-w-4xl text-center">
          <span className="mb-3 inline-block text-xs font-bold uppercase tracking-widest text-cyan-700">Pricing</span>
          <h2 className="mb-4 text-4xl font-extrabold tracking-tight text-slate-900">
            Simple, transparent pricing
          </h2>
          <p className="mb-14 text-slate-500">Start free. Upgrade when your team grows.</p>
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              { name: 'Starter', price: 'Free', features: ['1 workspace', 'Basic editor', 'Version history (7 days)', 'Community support'], cta: 'Get Started', highlight: false },
              { name: 'Pro', price: '$12/mo', features: ['Unlimited workspaces', 'AI Assistant', 'Grammar checker', 'Priority support', 'Version history (90 days)'], cta: 'Start Pro Trial', highlight: true },
              { name: 'Enterprise', price: 'Custom', features: ['SSO & SAML', 'Custom roles & RBAC', 'Audit logs', 'SLA & dedicated support', 'On-premise option'], cta: 'Contact Sales', highlight: false },
            ].map((plan) => (
              <div
                key={plan.name}
                className={`flex flex-col rounded-2xl border p-8 text-left shadow-sm ${
                  plan.highlight
                    ? 'border-cyan-300 bg-cyan-700 text-white shadow-lg shadow-cyan-300/40'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <p className={`text-xs font-bold uppercase tracking-widest ${plan.highlight ? 'text-cyan-200' : 'text-cyan-700'}`}>
                  {plan.name}
                </p>
                <p className={`mt-2 text-4xl font-extrabold ${plan.highlight ? 'text-white' : 'text-slate-900'}`}>
                  {plan.price}
                </p>
                <ul className="my-6 flex-1 space-y-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <span className={`mt-0.5 text-base leading-none ${plan.highlight ? 'text-cyan-200' : 'text-cyan-600'}`}>✓</span>
                      <span className={plan.highlight ? 'text-cyan-50' : 'text-slate-600'}>{f}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={onGetStarted}
                  className={`w-full rounded-xl py-2.5 text-sm font-bold transition-all active:scale-[0.98] ${
                    plan.highlight
                      ? 'bg-white text-cyan-700 hover:bg-cyan-50'
                      : 'bg-cyan-700 text-white hover:bg-cyan-600 shadow-md shadow-cyan-200'
                  }`}
                >
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Banner ── */}
      <section className="bg-linear-to-r from-cyan-700 to-cyan-800 px-6 py-20 text-center">
        <h2 className="mb-4 text-4xl font-extrabold tracking-tight text-white">
          Ready to write smarter?
        </h2>
        <p className="mb-8 text-cyan-100">
          Join thousands of teams who ship better documents with DocSynq.
        </p>
        <button
          onClick={onGetStarted}
          className="rounded-2xl bg-white px-10 py-3.5 text-base font-bold text-cyan-700 shadow-lg transition-all hover:bg-cyan-50 active:scale-[0.98]"
        >
          Create Your Free Account
        </button>
      </section>

      {/* ── Footer ── */}
      <footer id="about" className="border-t border-slate-200 bg-white px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
            <div>
              <p className="text-xl font-extrabold tracking-tight text-slate-800">DocSynq</p>
              <p className="mt-1 text-sm text-slate-400">Future of Workspace</p>
            </div>
            <div className="flex flex-wrap gap-6 text-sm font-semibold text-slate-500">
              {['Privacy Policy', 'Terms of Service', 'Security', 'Status'].map((l) => (
                <a key={l} href="#" className="transition-colors hover:text-cyan-700">{l}</a>
              ))}
            </div>
          </div>
          <p className="mt-8 border-t border-slate-100 pt-6 text-center text-xs text-slate-400">
            © {new Date().getFullYear()} DocSynq. All rights reserved.
          </p>
        </div>
      </footer>

    </div>
  );
}
