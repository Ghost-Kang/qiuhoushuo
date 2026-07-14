'use client';

/**
 * 服务号 H5 球迷形象页（iOS 走这条:scene=jsapi_mp 付 ¥1 → 生成,绕开小程序 iOS 虚拟支付禁令）。
 *
 * openid 来自服务号网页授权(OAuth):无 token 时跳 /api/wx/oauth?to=avatar&sku=avatar_card,
 * 回来即带 ?t=<HMAC token>。本页:选图 + 球队 + 同意 → 付 ¥1(create avatar_card jsapi_mp +
 * WeixinJSBridge) → 查单结算(/payment/query) → 生成(/api/avatar,x-openid-token 鉴权) → 出图。
 *
 * 合规:人脸属 PIPL 敏感个人信息——必须显式单独勾选同意才提交;照片只读入内存转 base64,不落盘。
 */

import { useEffect, useRef, useState } from 'react';

interface PayParams {
  appId: string; timeStamp: string; nonceStr: string; package: string; signType: string; paySign: string;
}
interface WeixinJSBridgeType {
  invoke(method: 'getBrandWCPayRequest', params: Record<string, string>, cb: (res: { err_msg: string }) => void): void;
}
declare global {
  interface Window { WeixinJSBridge?: WeixinJSBridgeType }
}

const MAX_SELFIE_BYTES = 4 * 1024 * 1024;
type Status = 'idle' | 'creating' | 'paying' | 'generating' | 'success' | 'failed';
type Mode = 'solo' | 'costar';

// 「与球星合影」候选(costar);选中即带出对应球队(球衣)。与小程序 STAR_OPTIONS 同源。
// costar 是否放行由后端 feature.fan_avatar_costar 决定(关时 /api/avatar 返 403 FEATURE_DISABLED)。
const STAR_OPTIONS: { name: string; team: string; flag: string }[] = [
  { name: 'C罗', team: '葡萄牙', flag: '🇵🇹' },
  { name: '梅西', team: '阿根廷', flag: '🇦🇷' },
  { name: '内马尔', team: '巴西', flag: '🇧🇷' },
  { name: '姆巴佩', team: '法国', flag: '🇫🇷' },
  { name: '哈兰德', team: '挪威', flag: '🇳🇴' },
  { name: '贝林厄姆', team: '英格兰', flag: '🏴' },
];

// 收费开关(默认关 → 免费生成):=1 才走「下单 → 付 ¥1 → 生成」;空=跳过支付直接生成。
// 收费链路(jsapi_mp 付 ¥1)已验证,先关开关让用户免费用起来。须与服务端 AVATAR_PAYMENT_REQUIRED 一起翻。
const PAYMENT_LIVE = process.env.NEXT_PUBLIC_AVATAR_PAYMENT_LIVE === '1';

export default function AvatarPage() {
  const [token, setToken] = useState('');
  const [mode, setMode] = useState<Mode>('solo'); // solo=插画球迷 | costar=与球星合影(写实,高风险)
  const [costarEntry, setCostarEntry] = useState(false); // 与小程序一致:costar 入口由服务端 feature.fan_avatar_costar_entry 控制,默认隐藏
  const [star, setStar] = useState(''); // costar 选中的球星名
  const [team, setTeam] = useState('');
  const [imageB64, setImageB64] = useState(''); // data:image/...;base64,xxx
  const [preview, setPreview] = useState('');
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get('t') ?? '';
    const err = q.get('err');
    // 无 token 且未授权失败过 → 服务号静默网页授权换 openid(回来带签名 token)
    if (!t && !err) {
      window.location.replace('/api/wx/oauth?to=avatar&sku=avatar_card');
      return;
    }
    setToken(t);
    if (err) setMessage('授权失败，请从微信内重新进入');
  }, []);

  // 与球星合影(costar)入口与小程序同源由服务端 flag 控制(feature.fan_avatar_costar_entry):
  // 仅 costar_entry===true 才露出合影入口;拉取失败/未开一律隐藏(fail-closed,高风险模式默认不露出)。
  useEffect(() => {
    fetch('/api/avatar/config')
      .then((r) => r.json())
      .then((d) => { if (d?.costar_entry === true) setCostarEntry(true); })
      .catch(() => undefined);
  }, []);

  const busy = status === 'creating' || status === 'paying' || status === 'generating';

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_SELFIE_BYTES) { setMessage('图片需小于 4MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setImageB64(dataUrl);
      setPreview(dataUrl);
      setMessage('');
    };
    reader.onerror = () => setMessage('读取图片失败，请重试');
    reader.readAsDataURL(file);
  }

  function guard(): string | null {
    if (!token) return '缺少用户标识，请从微信内重新进入';
    if (!imageB64) return '请先选择照片';
    if (mode === 'costar' && !star.trim()) return '请先选择球星';
    if (!team.trim()) return '请填写支持的球队';
    if (!consent) return '请先阅读并勾选同意';
    return null;
  }

  async function handlePayAndGenerate() {
    const bad = guard();
    if (bad) { setStatus('failed'); setMessage(bad); return; }
    // 收费开关关:跳过下单/支付,直接免费生成(空 paymentId 不查单,直接打 /api/avatar)
    if (!PAYMENT_LIVE) { await settleAndGenerate(''); return; }
    setStatus('creating'); setMessage('');
    try {
      const createRes = await fetch('/api/payment/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-openid-token': token },
        body: JSON.stringify({ sku: 'avatar_card', scene: 'jsapi_mp' }),
      });
      const createData = await createRes.json();
      if (!createRes.ok || !createData.payParams) {
        setStatus('failed');
        setMessage(createData.error === 'MINOR_BLOCKED' ? '未成年人模式不可付费' : '下单失败，请重试');
        return;
      }
      invokePay(createData.payParams as PayParams, createData.paymentId as string);
    } catch {
      setStatus('failed'); setMessage('网络异常，请重试');
    }
  }

  function invokePay(p: PayParams, paymentId: string) {
    const bridge = window.WeixinJSBridge;
    if (!bridge) { setStatus('failed'); setMessage('请在微信内打开本页面完成支付'); return; }
    setStatus('paying');
    bridge.invoke('getBrandWCPayRequest', {
      appId: p.appId, timeStamp: p.timeStamp, nonceStr: p.nonceStr, package: p.package, signType: p.signType, paySign: p.paySign,
    }, async (r) => {
      if (r.err_msg === 'get_brand_wcpay_request:ok') {
        await settleAndGenerate(paymentId);
      } else if (r.err_msg === 'get_brand_wcpay_request:cancel') {
        setStatus('idle'); setMessage('已取消支付');
      } else {
        setStatus('failed'); setMessage('支付未完成，请重试');
      }
    });
  }

  // 支付成功 → 主动查单结算(不依赖 notify 时序)→ 生成(权益此时已成功且未兑付)
  async function settleAndGenerate(paymentId: string) {
    setStatus('generating'); setMessage('正在为你作画，约 10–20 秒…');
    try {
      if (paymentId) {
        await fetch('/api/payment/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-openid-token': token },
          body: JSON.stringify({ paymentId }),
        }).catch(() => undefined);
      }
      const genRes = await fetch('/api/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-openid-token': token },
        // costar 时带 star;solo 省略。后端按 mode 选 prompt,costar 再过 feature.fan_avatar_costar 门。
        body: JSON.stringify({ image_b64: imageB64, team: team.trim(), consent: true, mode, star: mode === 'costar' ? star.trim() : undefined }),
      });
      const genData = await genRes.json();
      if (genRes.ok && genData.url) {
        setResultUrl(genData.url); setStatus('success'); setMessage('');
      } else {
        // 已付但生成失败:权益保留,可重试不二次扣费。FEATURE_DISABLED=costar 开关未翻(或 fan_avatar 关)。
        setStatus('failed');
        setMessage(
          genData.error === 'FEATURE_DISABLED' ? '功能暂未开放，敬请期待'
            : genData.error === 'PAYMENT_REQUIRED' ? '支付确认中，请稍候重试生成'
              : '生成失败，已付款可重试生成（不会二次扣费）',
        );
      }
    } catch {
      setStatus('failed'); setMessage('生成超时，已付款可重试生成（不会二次扣费）');
    }
  }

  // 已付款重试生成(不重复支付)
  async function retryGenerate() {
    const bad = guard();
    if (bad) { setStatus('failed'); setMessage(bad); return; }
    await settleAndGenerate('');
  }

  return (
    <main className="min-h-screen flex flex-col items-center px-6 py-10">
      <div className="w-full max-w-sm space-y-5">
        <h1 className="text-2xl font-black tracking-tight text-center">超帧球后说 · {mode === 'costar' ? '与球星合影' : '球迷形象'}</h1>

        {/* AIGC 显著标识:AI 生成页面顶部强提示,满足《人工智能生成合成内容标识办法》显著标识 + 对齐小程序 .aigc-banner */}
        <div className="rounded-2xl border border-cyan-400/60 bg-cyan-400/10 px-4 py-3 text-center text-sm font-semibold tracking-wide text-cyan-300">
          ⚡ 内容由 AI 生成 · 人工智能生成
        </div>

        {status !== 'success' && (
          <>
            {/* 模式切换:球迷形象(插画) / 与球星合影(写实,高风险)。costar 入口由服务端 flag 控制,关时整块隐藏(只剩插画球迷)。 */}
            {costarEntry && (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setMode('solo')}
                  className={`rounded-2xl border py-2.5 text-sm font-semibold ${mode === 'solo' ? 'border-cyan-400/60 bg-cyan-400/10 text-cyan-300' : 'border-white/10 bg-white/5 text-[color:var(--text-muted)]'}`}>
                  球迷形象
                </button>
                <button type="button" onClick={() => setMode('costar')}
                  className={`rounded-2xl border py-2.5 text-sm font-semibold ${mode === 'costar' ? 'border-cyan-400/60 bg-cyan-400/10 text-cyan-300' : 'border-white/10 bg-white/5 text-[color:var(--text-muted)]'}`}>
                  与球星合影
                </button>
              </div>
            )}

            <p className="text-sm text-[color:var(--text-muted)] text-center">
              {mode === 'costar' ? '上传一张照片，AI 合成你与喜欢球星的合影' : '上传一张照片，AI 把你画成支持球队的插画球迷'}
            </p>
            {mode === 'solo' && (
              <div className="flex gap-2 overflow-x-auto -mx-1 px-1">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
                  <img key={n} src={`/avatar-samples/${n}.jpg`} alt="球迷形象示例" className="h-44 flex-none rounded-2xl" />
                ))}
              </div>
            )}

            <label className="block">
              <span className="text-sm text-[color:var(--text-muted)]">选一张你的照片（小于 4MB）</span>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg" onChange={onPickFile} className="mt-2 block w-full text-sm" />
            </label>
            {preview && <img src={preview} alt="预览" className="w-full rounded-2xl" />}

            {mode === 'costar' ? (
              <div className="space-y-2">
                <span className="text-sm text-[color:var(--text-muted)]">想和哪位球星合影</span>
                <div className="grid grid-cols-3 gap-2">
                  {STAR_OPTIONS.map((s) => (
                    <button key={s.name} type="button" onClick={() => { setStar(s.name); setTeam(s.team); }}
                      className={`rounded-2xl border py-3 text-center ${star === s.name ? 'border-cyan-400/60 bg-cyan-400/10' : 'border-white/10 bg-white/5'}`}>
                      <div className="text-2xl leading-none">{s.flag}</div>
                      <div className="mt-1 text-sm">{s.name}</div>
                    </button>
                  ))}
                </div>
                <input value={star} onChange={(e) => setStar(e.target.value)} maxLength={20} placeholder="其他球星（手动输入）"
                  className="mt-1 block w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3" />
                <input value={team} onChange={(e) => setTeam(e.target.value)} maxLength={20} placeholder="球队（球衣）"
                  className="block w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3" />
                <p className="text-xs text-[color:var(--text-muted)]">合影由 AI 合成 · 非本人、非真实合影</p>
              </div>
            ) : (
              <label className="block">
                <span className="text-sm text-[color:var(--text-muted)]">支持的球队</span>
                <input value={team} onChange={(e) => setTeam(e.target.value)} maxLength={20} placeholder="如：阿根廷"
                  className="mt-2 block w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3" />
              </label>
            )}

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-[color:var(--text-muted)] leading-relaxed">
              · 照片仅用于本次形象生成，生成完成即丢弃，不会被保存<br />
              {mode === 'costar' ? '· 结果为 AI 合成的合影图（非本人、非真实合影），自动带 AI 生成标识水印' : '· 生成结果为卡通插画风格，自动带 AI 生成标识水印'}<br />
              · 未成年人账号不可使用本功能
            </div>
            <label className="flex items-start gap-2 text-xs text-[color:var(--text-muted)]">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
              <span>{mode === 'costar' ? '我已阅读上方说明，同意将本张照片用于本次 AI 合影生成' : '我已阅读上方说明，同意将本张照片用于本次球迷形象生成'}</span>
            </label>

            <button type="button" onClick={handlePayAndGenerate} disabled={busy}
              className="block w-full rounded-2xl bg-white text-black font-semibold py-4 disabled:opacity-50">
              {status === 'creating' ? '下单中…' : status === 'paying' ? '支付中…' : status === 'generating' ? '生成中…' : (PAYMENT_LIVE ? '同意并支付 ¥1 生成' : '同意并生成')}
            </button>
            {status === 'failed' && message.includes('重试生成') && (
              <button type="button" onClick={retryGenerate} disabled={busy}
                className="block w-full rounded-2xl border border-white/15 py-3 text-sm disabled:opacity-50">
                重试生成（不再扣费）
              </button>
            )}
          </>
        )}

        {status === 'success' && resultUrl && (
          <div className="space-y-4 text-center">
            <p className="text-lg font-semibold">{mode === 'costar' ? `你和 ${star} 同框啦 ⚽` : '这就是球场上的你 ⚽'}</p>
            <img src={resultUrl} alt={mode === 'costar' ? '与球星合影' : '球迷形象'} className="w-full rounded-2xl" />
            {mode === 'costar' && <p className="text-xs text-[color:var(--text-muted)]">本图由 AI 合成 · 非本人、非真实合影</p>}
            <p className="text-xs text-[color:var(--text-muted)]">长按图片即可保存到相册</p>
          </div>
        )}

        {message && status !== 'success' && (
          <p className={status === 'failed' ? 'text-sm text-red-400' : 'text-sm text-[color:var(--text-muted)]'}>{message}</p>
        )}
        <p className="text-xs text-[color:var(--text-muted)] text-center pt-2">{PAYMENT_LIVE ? '支付由微信支付提供 · 个体工商户主体 · AI 生成内容' : '个体工商户主体 · AI 生成内容'}</p>
      </div>
    </main>
  );
}
