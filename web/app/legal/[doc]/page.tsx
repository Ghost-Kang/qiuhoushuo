/**
 * 用户协议三件套 web 页：/legal/agreement | /legal/privacy | /legal/minor。
 * 服务号 H5（球迷形象同意）与站点页脚可直接链到此处；内容源 @/lib/legal/content（与小程序同源）。
 */
import type { Metadata } from 'next';
import { LEGAL_DOCS, LEGAL_META, type LegalDoc } from '@/lib/legal/content';

type DocKey = keyof typeof LEGAL_DOCS;
const KEYS: DocKey[] = ['agreement', 'privacy', 'minor'];

function resolveDoc(raw: string | undefined): LegalDoc {
  const key = (raw && (KEYS as string[]).includes(raw) ? raw : 'agreement') as DocKey;
  return LEGAL_DOCS[key];
}

export function generateStaticParams(): Array<{ doc: string }> {
  return KEYS.map((doc) => ({ doc }));
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const { doc } = await params;
  return { title: `${resolveDoc(doc).title} · 超帧球后说` };
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const data = resolveDoc(doc);
  return (
    <main className="min-h-screen px-5 py-10">
      <article className="max-w-2xl mx-auto">
        <header className="pb-4 mb-2 border-b border-white/10">
          <h1 className="text-2xl font-bold">{data.title}</h1>
          <p className="mt-2 text-xs text-[color:var(--text-muted)]">
            超帧球后说 · 版本 {LEGAL_META.version} · 更新 {LEGAL_META.updated}
          </p>
        </header>

        {data.blocks.map((b, i) => {
          if (b.t === 'h') {
            return (
              <h2 key={i} className="mt-7 mb-2 text-base font-semibold text-[#00b8cc]">
                {b.x}
              </h2>
            );
          }
          if (b.t === 'note') {
            return (
              <p
                key={i}
                className="my-3 px-4 py-3 text-sm leading-relaxed font-medium rounded-lg border-l-4 border-[#00b8cc] bg-[#00b8cc]/10 text-justify"
              >
                {b.x}
              </p>
            );
          }
          if (b.t === 'li') {
            return (
              <p key={i} className="my-2 ml-4 pl-3 text-sm leading-relaxed text-[color:var(--text-muted)] relative">
                <span className="absolute left-0 text-[#00b8cc]">·</span>
                {b.x}
              </p>
            );
          }
          return (
            <p key={i} className="my-3 text-sm leading-relaxed text-[color:var(--text-muted)] text-justify">
              {b.x}
            </p>
          );
        })}

        <footer className="mt-12 pt-5 border-t border-white/10 text-xs text-[color:var(--text-muted)]">
          如对本协议有任何疑问，请联系 {LEGAL_META.contact}
        </footer>
      </article>
    </main>
  );
}
