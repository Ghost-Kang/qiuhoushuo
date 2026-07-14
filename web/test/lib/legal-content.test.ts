import { describe, expect, it } from 'vitest';
import { LEGAL_DOCS, LEGAL_META } from '@/lib/legal/content';

// web 侧用户协议三件套内容（由 miniprogram/utils/legal-text.js 生成，两处同源）。
// 钉死与小程序一致的关键断言：人脸披露已补、占位已回填、无内部起草标记。

describe('legal content（web 副本，与小程序同源）', () => {
  it('三份文档齐全且结构合法', () => {
    for (const key of ['agreement', 'privacy', 'minor'] as const) {
      const doc = LEGAL_DOCS[key];
      expect(doc.title.length).toBeGreaterThan(0);
      expect(doc.blocks.length).toBeGreaterThan(5);
      for (const b of doc.blocks) {
        expect(['h', 'p', 'li', 'note']).toContain(b.t);
        expect(b.x.length).toBeGreaterThan(0);
      }
    }
  });

  it('隐私政策含球迷形象人脸采集披露（按实际代码补）', () => {
    const txt = LEGAL_DOCS.privacy.blocks.map((b) => b.x).join('\n');
    expect(txt).toMatch(/球迷形象/);
    expect(txt).toMatch(/人脸/);
    expect(txt).toMatch(/不存储您上传的人脸原图|不留存原图/);
    expect(txt).toMatch(/单独同意/);
  });

  it('占位已回填：无 PENDING / 起草标记残留，主体与联系方式正确', () => {
    const all = (['agreement', 'privacy', 'minor'] as const)
      .flatMap((k) => LEGAL_DOCS[k].blocks.map((b) => b.x))
      .concat(Object.values(LEGAL_META))
      .join('\n');
    expect(all).not.toMatch(/PENDING/);
    expect(all).not.toMatch(/⚖️|⚙️|🔴/);
    // 经营者/信用代码单点维护于 LEGAL_META,正文插值引用——断言正文确实带上了 META 值(防漏插值回归)
    expect(all).toContain(`经营者 ${LEGAL_META.operator}`);
    expect(all).toContain(LEGAL_META.creditCode);
    expect(LEGAL_META.contact).toBe('wangxukang@superframe.cn');
  });
});
