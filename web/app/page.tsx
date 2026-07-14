/**
 * 站点首页（落地页 / 兜底）
 * 主流量入口是 `/m/[shortCode]`（来自分享卡片回流）
 * 此页面承担：品牌展示 + 引导关注小程序 + SEO（如允许的话）
 */
export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-16">
      <div className="max-w-md text-center space-y-6">
        <h1 className="text-4xl font-black tracking-tight">超帧球后说</h1>
        <p className="text-lg text-[color:var(--text-muted)]">
          赛后两分钟，比赛才刚开始。
        </p>
        <p className="text-sm text-[color:var(--text-muted)]">
          每场比赛结束 5 分钟，三种风格的战报自动生成：
          <br />
          硬核派 · 段子手派 · 情绪流派
        </p>

        <div className="pt-6 space-y-3">
          <a
            href="weixin://dl/business/?ticket=qiuhoushuo"
            className="block w-full rounded-2xl bg-white text-black font-semibold py-4"
          >
            打开微信小程序
          </a>
          <a
            href="/m/sample"
            className="block w-full rounded-2xl border border-white/15 text-white/90 py-4"
          >
            看一篇样例战报
          </a>
        </div>

        <p className="text-xs text-[color:var(--text-muted)] pt-12">
          AI 生成内容 · 内容仅供娱乐参考
          <br />
          <a href="/legal/agreement" className="text-[color:var(--text-muted)] underline-offset-2 hover:underline">用户协议</a>
          {' · '}
          <a href="/legal/privacy" className="text-[color:var(--text-muted)] underline-offset-2 hover:underline">隐私政策</a>
          {' · '}
          <a href="/legal/minor" className="text-[color:var(--text-muted)] underline-offset-2 hover:underline">未成年人保护</a>
          <br />
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noreferrer"
            className="text-[color:var(--text-muted)] underline-offset-2 hover:underline"
          >
            以线上公示为准
          </a>{' '}
          · 超帧球后说 · 2026
        </p>
      </div>
    </main>
  );
}
