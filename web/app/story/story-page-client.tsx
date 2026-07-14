'use client';

import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { AudienceId, LeadRole, StoryContent } from '@/lib/story/story-content';

interface StoryPageClientProps {
  content: StoryContent;
}

type SubmitState = 'idle' | 'sending' | 'success' | 'error';

export function StoryPageClient({ content }: StoryPageClientProps) {
  const [audienceId, setAudienceId] = useState<AudienceId>('client');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const selectedAudience = content.hero.audiences.find((item) => item.id === audienceId) ?? content.hero.audiences[0]!;
  const sortedAudiences = useMemo(
    () => [
      selectedAudience,
      ...content.hero.audiences.filter((item) => item.id !== audienceId),
    ],
    [audienceId, content.hero.audiences, selectedAudience],
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState('sending');
    const data = new FormData(event.currentTarget);
    const payload = {
      role: String(data.get('role') || 'other') as LeadRole,
      industry: optionalString(data.get('industry')),
      need: optionalString(data.get('need')),
      contact: String(data.get('contact') || ''),
    };
    const res = await fetch('/api/story/lead', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setSubmitState(res?.ok ? 'success' : 'error');
    if (res?.ok) event.currentTarget.reset();
  }

  return (
    <main className="story-page min-h-screen bg-[#08090b] text-slate-100">
      <nav className="story-nav sticky top-0 z-30 border-b border-white/10 bg-[#08090b]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl gap-3 overflow-x-auto px-4 py-3 text-xs text-slate-300 sm:px-6">
          {[content.hero, ...Object.values(content.sections)].map((section) => (
            <a key={section.id} href={`#${section.id}`} className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 transition hover:border-cyan-300/60 hover:text-white">
              {section.title}
            </a>
          ))}
        </div>
      </nav>

      <section id={content.hero.id} className="story-section scroll-mt-20 border-b border-white/10 px-4 py-14 sm:px-6 lg:py-20">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div className="space-y-8">
            <div className="space-y-5">
              <h1 className="max-w-4xl text-4xl font-black leading-tight tracking-normal text-white sm:text-5xl lg:text-6xl">
                {content.hero.title}
              </h1>
              <p className="max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">{content.hero.lead}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {content.hero.counters.map((counter) => (
                <div key={counter.label} className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
                  <div className="text-3xl font-black text-cyan-200">{counter.value}</div>
                  <div className="mt-2 text-sm font-semibold text-white">{counter.label}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-400">{counter.note}</div>
                </div>
              ))}
            </div>

            <div className="story-tabs story-interactive flex flex-wrap gap-2">
              {content.hero.audiences.map((audience) => (
                <button
                  key={audience.id}
                  type="button"
                  onClick={() => setAudienceId(audience.id)}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${audience.id === audienceId ? 'border-cyan-300 bg-cyan-300 text-slate-950' : 'border-white/15 bg-white/[0.03] text-slate-200 hover:border-white/30'}`}
                >
                  {audience.label}
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
              <div className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 p-5">
                <div className="text-sm font-semibold text-cyan-100">{selectedAudience.badge}</div>
                <p className="mt-3 text-sm leading-6 text-slate-200">{selectedAudience.highlight}</p>
              </div>
              <div className="flex flex-wrap content-start gap-2">
                {sortedAudiences.map((audience) => (
                  <span key={audience.id} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300">
                    {audience.cta}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.88),rgba(2,6,23,0.95))] p-6">
            <div className="w-full rounded-lg border border-dashed border-white/20 p-8 text-center text-sm font-semibold text-slate-300">
              {content.hero.assetPlaceholder}
            </div>
          </div>
        </div>
      </section>

      <SectionShell section={content.sections.facts}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {content.stats.map((stat) => (
            <article key={stat.label} className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-300">{stat.label}</h3>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${stat.verified ? 'bg-emerald-300/15 text-emerald-200' : 'bg-amber-300/15 text-amber-100'}`}>
                  {stat.verified ? content.labels.verified : content.labels.unverified}
                </span>
              </div>
              <div className="mt-4 text-2xl font-black text-white">{stat.value}</div>
              <div className="mt-3 text-xs leading-5 text-slate-400">{stat.asOf}</div>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell section={content.sections.proof}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {content.proofFeatures.map((feature) => (
            <article key={feature.title} className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
              <h3 className="text-lg font-bold text-white">{feature.title}</h3>
              <Rows rows={[
                [content.labels.userSees, feature.userSees],
                [content.labels.systemDoes, feature.systemDoes],
                [content.labels.transferableTo, feature.transferableTo],
              ]} />
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell section={content.sections.org}>
        <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
          <div className="space-y-3">
            {content.org.layers.map((layer, index) => (
              <div key={layer.title} className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-300/15 text-sm font-black text-cyan-100">{index + 1}</span>
                  <h3 className="text-base font-bold text-white">{layer.title}</h3>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {layer.members.map((member) => (
                    <div key={member} className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-300">{member}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
            <div className="grid gap-2">
              {content.org.roster.map((member) => (
                <div key={member} className="rounded-md border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-300">{member}</div>
              ))}
            </div>
          </div>
        </div>
      </SectionShell>

      <SectionShell section={content.sections.factory}>
        <div className="space-y-3">
          {content.factory.lanes.map((lane) => (
            <article key={lane.title} className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
              <h3 className="text-sm font-bold text-white">{lane.title}</h3>
              <div className="mt-4 grid gap-2 md:grid-cols-5">
                {lane.steps.map((step) => (
                  <div key={step} className="rounded-md border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-300">{step}</div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell section={content.sections.cost}>
        <div className="grid gap-4 lg:grid-cols-3">
          {content.cost.pairs.map((pair) => (
            <article key={pair.title} className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
              <h3 className="text-lg font-bold text-white">{pair.title}</h3>
              <Rows rows={[
                [content.labels.before, pair.before],
                [content.labels.after, pair.after],
              ]} />
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell section={content.sections.governance}>
        <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="grid content-start gap-3">
            {content.governance.badges.map((badge) => (
              <div key={badge.label} className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-4">
                <div className="text-sm font-bold text-emerald-100">{badge.label}</div>
                <div className="mt-2 text-sm text-slate-300">{badge.status}</div>
              </div>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {content.governance.wall.map((item) => (
              <article key={item.title} className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
                <h3 className="text-sm font-bold text-white">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-300">{item.summary}</p>
              </article>
            ))}
          </div>
        </div>
      </SectionShell>

      <SectionShell section={content.sections.timeline}>
        <div className="space-y-4">
          {content.timeline.map((item) => (
            <article key={`${item.date}-${item.title}`} className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-5 md:grid-cols-[160px_1fr]">
              <div className="text-sm font-black text-cyan-200">{item.date}</div>
              <div>
                <h3 className="text-base font-bold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{item.fix}</p>
              </div>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell section={content.sections.assets}>
        <div className="grid gap-4 lg:grid-cols-[1fr_0.45fr]">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {content.assets.playbooks.map((item) => (
              <article key={item.title} className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
                <h3 className="text-sm font-bold text-white">{item.title}</h3>
                <p className="mt-3 text-xs leading-5 text-slate-400">{item.summary}</p>
              </article>
            ))}
          </div>
          <div className="grid content-start gap-3">
            {content.assets.skills.map((skill) => (
              <article key={skill.title} className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-4">
                <h3 className="text-sm font-bold text-cyan-100">{skill.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-300">{skill.summary}</p>
              </article>
            ))}
          </div>
        </div>
      </SectionShell>

      <SectionShell section={content.sections.contact}>
        <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
          <div className="grid gap-3 sm:grid-cols-2">
            {content.contact.ctas.map((cta) => (
              <article key={cta.role} className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                <h3 className="text-base font-bold text-white">{cta.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-300">{cta.body}</p>
              </article>
            ))}
            <div className="rounded-lg border border-white/10 bg-black/20 p-5 text-sm font-semibold text-slate-300">
              {content.contact.miniProgramEntry}
            </div>
          </div>

          <form onSubmit={onSubmit} className="story-lead-form story-interactive rounded-lg border border-white/10 bg-white/[0.04] p-5">
            <h3 className="text-lg font-bold text-white">{content.contact.form.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">{content.contact.form.lead}</p>
            <div className="mt-5 grid gap-4">
              <label className="grid gap-2 text-sm text-slate-300">
                <span>{content.contact.form.roleLabel}</span>
                <select name="role" className="rounded-md border border-white/10 bg-slate-950 px-3 py-3 text-white">
                  {content.contact.form.roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>{content.contact.form.industryLabel}</span>
                <input name="industry" className="rounded-md border border-white/10 bg-slate-950 px-3 py-3 text-white" />
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>{content.contact.form.needLabel}</span>
                <textarea name="need" rows={4} className="rounded-md border border-white/10 bg-slate-950 px-3 py-3 text-white" />
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                <span>{content.contact.form.contactLabel}</span>
                <input name="contact" required minLength={5} maxLength={80} placeholder={content.contact.form.contactPlaceholder} className="rounded-md border border-white/10 bg-slate-950 px-3 py-3 text-white placeholder:text-slate-600" />
              </label>
              <button type="submit" disabled={submitState === 'sending'} className="rounded-md bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60">
                {submitState === 'sending' ? content.contact.form.sending : content.contact.form.submit}
              </button>
              {submitState === 'success' ? <p className="text-sm text-emerald-200">{content.contact.form.success}</p> : null}
              {submitState === 'error' ? <p className="text-sm text-amber-100">{content.contact.form.error}</p> : null}
            </div>
          </form>
        </div>
      </SectionShell>

      <style jsx global>{`
        .story-section {
          break-inside: avoid;
        }

        @media print {
          html,
          body {
            background: #ffffff !important;
            color: #111827 !important;
          }

          .story-page {
            background: #ffffff !important;
            color: #111827 !important;
          }

          .story-section {
            break-inside: avoid;
            page-break-inside: avoid;
            border-color: #d1d5db !important;
          }

          .story-nav,
          .story-tabs,
          .story-interactive,
          .story-lead-form {
            display: none !important;
          }

          .story-page * {
            box-shadow: none !important;
            text-shadow: none !important;
          }
        }
      `}</style>
    </main>
  );
}

function SectionShell({ section, children }: { section: { id: string; title: string; lead: string }; children: ReactNode }) {
  return (
    <section id={section.id} className="story-section scroll-mt-20 border-b border-white/10 px-4 py-12 sm:px-6 lg:py-16">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 max-w-3xl">
          <h2 className="text-2xl font-black tracking-normal text-white sm:text-3xl">{section.title}</h2>
          <p className="mt-3 text-sm leading-7 text-slate-300 sm:text-base">{section.lead}</p>
        </div>
        {children}
      </div>
    </section>
  );
}

function Rows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="mt-5 space-y-3">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-md border border-white/10 bg-black/20 p-3">
          <dt className="text-xs font-semibold text-cyan-100">{label}</dt>
          <dd className="mt-2 text-sm leading-6 text-slate-300">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function optionalString(value: FormDataEntryValue | null): string | undefined {
  const text = String(value || '').trim();
  return text ? text : undefined;
}
