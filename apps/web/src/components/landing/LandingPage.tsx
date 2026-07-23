import Link from "next/link";
import { he } from "@/lib/he";
import { landing } from "./copy";
import { Pricing } from "./Pricing";
import { Reveal } from "./Reveal";
import { CountUp } from "./CountUp";
import { TypingChat } from "./TypingChat";
import { FireCanvas } from "./HeroFire";

/**
 * Public marketing landing page — cinematic dark theme (NOVI-style): near-black
 * canvas, a single electric-cyan glow, hairline rules, oversized headline,
 * wide-tracked uppercase micro-labels. RTL. Rendered at `/` for anonymous
 * visitors; logged-in users are redirected to the dashboard.
 */
export function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#05070a] text-slate-300 antialiased">
      <Ambience />
      <Nav />
      <HeroContent />
      <HeroVideo />
      <Showcase />
      <How />
      <Features />
      <Pricingsection />
      <Faq />
      <FinalCta />
      <Footer />
    </div>
  );
}

/* ---------------- ambient background ---------------- */
function Ambience() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* single electric-cyan glow, top center */}
      <div className="absolute -top-40 left-1/2 h-[40rem] w-[60rem] -translate-x-1/2 rounded-full bg-cyan-500/12 blur-[120px]" />
      {/* faint hairline grid, faded toward edges */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.9) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage: "radial-gradient(ellipse 90% 60% at 50% 0%, #000 55%, transparent 100%)",
        }}
      />
    </div>
  );
}

/* ---------------- nav ---------------- */
function Nav() {
  const n = landing.nav;
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-[#05070a]/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="text-lg font-extrabold tracking-tight text-white">{he.appName}</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-slate-400 md:flex">
          <a href="#how" className="transition hover:text-white">{n.how}</a>
          <a href="#features" className="transition hover:text-white">{n.features}</a>
          <a href="#pricing" className="transition hover:text-white">{n.pricing}</a>
          <a href="#faq" className="transition hover:text-white">{n.faq}</a>
        </nav>
        <div className="flex items-center gap-3">
          <span className="hidden rounded-md border border-cyan-400/25 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300/90 lg:inline">
            {n.badge}
          </span>
          <Link href="/login" className="hidden text-sm font-medium text-slate-300 transition hover:text-white sm:inline">
            {n.login}
          </Link>
          <Link
            href="/register"
            className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950 shadow-[0_0_28px_-8px_rgba(34,211,238,0.8)] transition hover:bg-cyan-300"
          >
            {n.cta}
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ---------------- hero ---------------- */
function HeroContent() {
  const h = landing.hero;
  return (
    <section className="relative isolate z-10 overflow-hidden border-b border-white/5 bg-[#05070a]">
      {/* ambient ember glow (also the no-WebGL fallback) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-20 h-2/3 bg-[radial-gradient(ellipse_70%_100%_at_50%_100%,rgba(34,211,238,0.28),transparent_70%)]" />
      {/* the fire */}
      <FireCanvas className="absolute inset-0 -z-10 h-full w-full" />
      {/* keep text legible over the flames */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-[#05070a]/70 via-[#05070a]/25 to-[#05070a]/55" />

      <div className="mx-auto max-w-6xl px-5 py-14 md:py-20">
        <div className="max-w-2xl">
          <Eyebrow>{landing.eyebrows.hero}</Eyebrow>
          <h1 className="animate-fade-up mt-5 text-[2.6rem] font-black leading-[0.98] tracking-tight text-white sm:text-6xl md:text-[4.1rem]">
            {h.title}
            <br />
            <span className="bg-gradient-to-l from-cyan-200 via-cyan-400 to-sky-400 bg-clip-text text-transparent">
              {h.titleAccent}
            </span>
          </h1>
          <p className="animate-fade-up mt-6 max-w-lg text-lg leading-relaxed text-slate-400 [animation-delay:0.1s]">
            {h.subtitle}
          </p>
          <div className="animate-fade-up mt-9 flex flex-col gap-3 sm:flex-row [animation-delay:0.15s]">
            <Link
              href="/register"
              className="group inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-400 px-7 py-3.5 text-base font-bold text-slate-950 shadow-[0_0_44px_-10px_rgba(34,211,238,0.9)] transition hover:bg-cyan-300"
            >
              {h.ctaPrimary}
              <Arrow />
            </Link>
            <a
              href="#pricing"
              className="inline-flex items-center justify-center rounded-lg border border-white/15 px-7 py-3.5 text-base font-semibold text-white transition hover:border-white/30 hover:bg-white/5"
            >
              {h.ctaSecondary}
            </a>
          </div>
          <p className="mt-5 text-sm text-slate-500">{h.note}</p>
        </div>
      </div>
    </section>
  );
}

function HeroVideo() {
  return (
    <section className="relative z-0 overflow-hidden border-b border-white/5">
      <video
        className="h-[46vh] w-full object-cover md:h-[58vh]"
        src="/hero-puzzle-hands.mp4"
        poster="/hero-puzzle-hands-poster.jpg"
        autoPlay
        muted
        loop
        playsInline
      />
      <Stats />
    </section>
  );
}

/* ---------------- stats ---------------- */
function Stats() {
  return (
    <div className="absolute inset-x-0 bottom-0 z-20">
      <div className="mx-auto max-w-6xl px-5">
        <div className="grid grid-cols-2 overflow-hidden rounded-t-2xl border border-b-0 border-white/10 bg-[#05070a]/85 backdrop-blur-md md:grid-cols-4">
          {landing.stats.map((s, i) => (
            <div
              key={s.label}
              className={[
                "px-2 py-2.5 text-center sm:px-5 sm:py-6 md:py-8",
                i % 2 === 1 ? "border-r border-white/5" : "",
                i < 2 ? "border-b border-white/5 md:border-b-0" : "",
                i > 0 && i % 4 !== 0 ? "md:border-r md:border-white/5" : "",
              ].join(" ")}
            >
              <p className="bg-gradient-to-l from-cyan-200 to-sky-400 bg-clip-text text-sm font-black text-transparent sm:text-2xl md:text-3xl">
                <CountUp value={s.value} />
              </p>
              <p className="mt-0.5 text-[9px] uppercase leading-tight tracking-[0.1em] text-slate-500 sm:mt-1 sm:text-xs sm:tracking-[0.14em]">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- product showcase (typing chat) ---------------- */
function Showcase() {
  const s = landing.showcase;
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-5 py-24">
      <div className="grid items-center gap-12 md:grid-cols-2">
        <Reveal>
          <Eyebrow>{s.title}</Eyebrow>
          <h2 className="mt-4 text-3xl font-black tracking-tight text-white md:text-4xl">{s.subtitle}</h2>
          <ul className="mt-8 space-y-4">
            {s.chat
              .filter((m) => m.from === "bot")
              .slice(0, 3)
              .map((m, i) => (
                <li key={i} className="flex items-start gap-3 text-slate-400">
                  <span className="mt-1 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-cyan-500/15 text-cyan-300">
                    <CheckMini />
                  </span>
                  <span className="text-sm leading-relaxed">{m.text}</span>
                </li>
              ))}
          </ul>
        </Reveal>
        <Reveal delay={120}>
          <TypingChat messages={s.chat} caption={s.caption} appName={he.appName} />
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- how it works ---------------- */
function How() {
  return (
    <section id="how" className="relative z-10 mx-auto max-w-6xl px-5 py-24">
      <SectionHead eyebrow={landing.eyebrows.how} title={landing.howTitle} subtitle={landing.howSubtitle} />
      <div className="mt-16 grid gap-5 md:grid-cols-3">
        {landing.steps.map((step, i) => (
          <Reveal key={step.n} delay={i * 90}>
            <div className="group h-full rounded-2xl border border-white/8 bg-white/[0.02] p-7 transition hover:border-cyan-400/30 hover:bg-white/[0.04]">
              <span className="text-5xl font-black text-cyan-400/25 transition group-hover:text-cyan-400/40">
                {step.n}
              </span>
              <h3 className="mt-4 text-xl font-bold text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{step.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------------- features ---------------- */
function Features() {
  return (
    <section id="features" className="relative z-10 mx-auto max-w-6xl px-5 py-24">
      <SectionHead
        eyebrow={landing.eyebrows.features}
        title={landing.featuresTitle}
        subtitle={landing.featuresSubtitle}
      />
      <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {landing.features.map((f, i) => (
          <Reveal key={f.title} delay={(i % 3) * 80}>
            <div className="group h-full rounded-2xl border border-white/8 bg-white/[0.02] p-7 transition hover:border-cyan-400/30 hover:bg-white/[0.04]">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300 transition group-hover:scale-110 group-hover:border-cyan-400/40">
                <FeatureIcon name={f.icon} />
              </div>
              <h3 className="mt-5 text-lg font-bold text-white">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------------- pricing ---------------- */
function Pricingsection() {
  return (
    <section id="pricing" className="relative z-10 mx-auto max-w-6xl px-5 py-24">
      <SectionHead
        eyebrow={landing.eyebrows.pricing}
        title={landing.pricing.title}
        subtitle={landing.pricing.subtitle}
      />
      <div className="mt-14">
        <Pricing />
      </div>
    </section>
  );
}

/* ---------------- faq ---------------- */
function Faq() {
  return (
    <section id="faq" className="relative z-10 mx-auto max-w-3xl px-5 py-24">
      <SectionHead eyebrow={landing.eyebrows.faq} title={landing.faqTitle} />
      <div className="mt-12 space-y-3">
        {landing.faq.map((item, i) => (
          <Reveal key={item.q} delay={i * 50}>
            <details className="group rounded-xl border border-white/8 bg-white/[0.02] px-5 transition open:border-cyan-400/25 open:bg-white/[0.04]">
              <summary className="flex cursor-pointer list-none items-center justify-between py-4 font-semibold text-white">
                {item.q}
                <span className="text-xl text-cyan-400 transition group-open:rotate-45">+</span>
              </summary>
              <p className="pb-4 text-sm leading-relaxed text-slate-400">{item.a}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------------- final CTA ---------------- */
function FinalCta() {
  const f = landing.finalCta;
  return (
    <section className="relative z-10 mx-auto max-w-5xl px-5 py-24">
      <Reveal>
        <div className="relative overflow-hidden rounded-3xl border border-cyan-400/25 bg-gradient-to-br from-cyan-500/10 via-[#070c12] to-[#05070a] p-12 text-center md:p-16">
          <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-96 -translate-x-1/2 rounded-full bg-cyan-400/20 blur-[90px]" />
          <h2 className="relative text-3xl font-black tracking-tight text-white md:text-5xl">{f.title}</h2>
          <p className="relative mx-auto mt-5 max-w-xl text-slate-400">{f.subtitle}</p>
          <Link
            href="/register"
            className="relative mt-9 inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-400 px-8 py-4 text-base font-bold text-slate-950 shadow-[0_0_50px_-10px_rgba(34,211,238,0.9)] transition hover:bg-cyan-300"
          >
            {f.cta}
            <Arrow />
          </Link>
          <p className="relative mt-4 text-sm text-slate-500">{f.note}</p>
        </div>
      </Reveal>
    </section>
  );
}

/* ---------------- footer ---------------- */
function Footer() {
  const f = landing.footer;
  return (
    <footer className="relative z-10 border-t border-white/5">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-5 py-10 text-center md:flex-row md:text-right">
        <div>
          <div className="flex items-center justify-center gap-2 md:justify-start">
            <Logo />
            <span className="text-lg font-extrabold text-white">{he.appName}</span>
          </div>
          <p className="mt-2 max-w-sm text-sm text-slate-500">{f.tagline}</p>
        </div>
        <div className="flex items-center gap-6 text-sm text-slate-400">
          <a href="#pricing" className="transition hover:text-white">{landing.nav.pricing}</a>
          <Link href="/login" className="transition hover:text-white">{landing.nav.login}</Link>
          <Link href="/register" className="transition hover:text-white">{landing.nav.cta}</Link>
        </div>
      </div>
      <p className="pb-8 text-center text-xs text-slate-600">
        © {he.appName} · {f.rights}
      </p>
    </footer>
  );
}

/* ---------------- shared bits ---------------- */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px w-8 bg-cyan-400/50" />
      <span className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/90">{children}</span>
    </div>
  );
}

function SectionHead({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      {eyebrow && (
        <div className="mb-5 flex justify-center">
          <span className="inline-flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/90">
            <span className="h-px w-8 bg-cyan-400/50" />
            {eyebrow}
            <span className="h-px w-8 bg-cyan-400/50" />
          </span>
        </div>
      )}
      <h2 className="text-3xl font-black tracking-tight text-white md:text-5xl">{title}</h2>
      {subtitle && <p className="mt-4 text-lg text-slate-400">{subtitle}</p>}
    </Reveal>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 rotate-180" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Logo({ small }: { small?: boolean }) {
  const size = small ? "h-5 w-5" : "h-8 w-8";
  return (
    <span
      className={`flex ${size} items-center justify-center rounded-lg bg-gradient-to-br from-cyan-300 to-sky-500 text-slate-950 shadow-[0_0_20px_-6px_rgba(34,211,238,0.9)]`}
    >
      <svg viewBox="0 0 24 24" className="h-1/2 w-1/2" fill="currentColor">
        <path d="M12 2a10 10 0 0 0-8.7 15l-1.2 4.4a.8.8 0 0 0 1 1l4.5-1.2A10 10 0 1 0 12 2Zm0 3a1.3 1.3 0 1 1 0 2.6A1.3 1.3 0 0 1 12 5Zm2 12h-4a1 1 0 0 1 0-2h.5v-3H10a1 1 0 0 1 0-2h1.5a1 1 0 0 1 1 1v4h.5a1 1 0 0 1 0 2Z" />
      </svg>
    </span>
  );
}

function CheckMini() {
  return (
    <svg viewBox="0 0 20 20" className="h-3 w-3" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.3 3.29 6.8-6.8a1 1 0 0 1 1.4 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function FeatureIcon({ name }: { name: string }) {
  const cls = "h-6 w-6";
  switch (name) {
    case "bolt":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
        </svg>
      );
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      );
    case "users":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "megaphone":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m3 11 18-5v12L3 13v-2Z" />
          <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
        </svg>
      );
    case "bell":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
      );
    case "shield":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        </svg>
      );
    default:
      return null;
  }
}
