import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://qiuhoushuo.com'),
  title: '超帧球后说 · 赛后两分钟，比赛才刚开始',
  description: '看完一场球，5 分钟内看完一篇懂的战报。AI 生成内容。',
  openGraph: {
    title: '超帧球后说',
    description: '赛后两分钟，比赛才刚开始',
    images: ['/og-default.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
