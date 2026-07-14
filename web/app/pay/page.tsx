'use client';

/**
 * 服务号 H5 支付页（scene=jsapi_mp）。
 *
 * iOS 用户走这条：微信内浏览器打开 → WeixinJSBridge 调起支付，绕开小程序 iOS 虚拟支付禁令。
 * openid 来自服务号网页授权（OAuth）：生产环境 OAuth 回调重定向到
 *   /pay?openid=<服务号openid>&sku=<deep_report|final_column>&reportId=<uuid>
 * 本页读取 query 后调 POST /api/payment/create 拿 payParams 并调起支付。
 */

import { useEffect, useState } from 'react';

interface PayParams {
  appId: string;
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: string;
  paySign: string;
}

interface WeixinJSBridgeType {
  invoke(
    method: 'getBrandWCPayRequest',
    params: Record<string, string>,
    callback: (res: { err_msg: string }) => void,
  ): void;
}

declare global {
  interface Window {
    WeixinJSBridge?: WeixinJSBridgeType;
  }
}

const SKU_LABELS: Record<string, { label: string; price: string; desc: string }> = {
  deep_report: { label: '赛事通', price: '¥19', desc: '解锁全程深度战报' },
  final_column: { label: '决赛专栏', price: '¥9', desc: '决赛日深度复盘' },
};

type Status = 'idle' | 'creating' | 'paying' | 'success' | 'failed';

export default function PayPage() {
  const [sku, setSku] = useState('');
  const [reportId, setReportId] = useState('');
  // R4：URL 里带的是 HMAC 签名 token（不是明文 openid），透传给下单路由验签
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get('t') ?? '';
    const s = q.get('sku') ?? '';
    const rid = q.get('reportId') ?? '';
    const err = q.get('err');
    // 无 token 且未授权失败过 → 走服务号网页授权静默换 openid（回来即带签名 token）
    if (!t && s && !err) {
      const params = new URLSearchParams({ sku: s });
      if (rid) params.set('reportId', rid);
      window.location.replace(`/api/wx/oauth?${params.toString()}`);
      return;
    }
    setSku(s);
    setReportId(rid);
    setToken(t);
    if (err) setMessage('授权失败，请重试');
  }, []);

  const info = SKU_LABELS[sku];
  const busy = status === 'creating' || status === 'paying';

  async function handlePay() {
    if (!token) {
      setStatus('failed');
      setMessage('缺少用户标识，请从微信内重新进入');
      return;
    }
    if (!info) {
      setStatus('failed');
      setMessage('商品不存在');
      return;
    }
    setStatus('creating');
    setMessage('');
    try {
      const res = await fetch('/api/payment/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-openid-token': token },
        body: JSON.stringify({ sku, scene: 'jsapi_mp', reportId: reportId || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.payParams) {
        setStatus('failed');
        setMessage(data.error === 'MINOR_BLOCKED' ? '未成年人模式不可付费' : '下单失败，请重试');
        return;
      }
      invokePay(data.payParams as PayParams);
    } catch {
      setStatus('failed');
      setMessage('网络异常，请重试');
    }
  }

  function invokePay(p: PayParams) {
    const bridge = window.WeixinJSBridge;
    if (!bridge) {
      setStatus('failed');
      setMessage('请在微信内打开本页面完成支付');
      return;
    }
    setStatus('paying');
    bridge.invoke(
      'getBrandWCPayRequest',
      {
        appId: p.appId,
        timeStamp: p.timeStamp,
        nonceStr: p.nonceStr,
        package: p.package,
        signType: p.signType,
        paySign: p.paySign,
      },
      (r) => {
        if (r.err_msg === 'get_brand_wcpay_request:ok') {
          setStatus('success');
          setMessage('解锁成功，感谢支持');
        } else if (r.err_msg === 'get_brand_wcpay_request:cancel') {
          setStatus('idle');
          setMessage('已取消支付');
        } else {
          setStatus('failed');
          setMessage('支付未完成，请重试');
        }
      },
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/5 p-8 text-center space-y-6">
        <h1 className="text-2xl font-black tracking-tight">超帧球后说</h1>
        {info ? (
          <div className="space-y-2">
            <p className="text-lg font-semibold">{info.label}</p>
            <p className="text-sm text-[color:var(--text-muted)]">{info.desc}</p>
            <p className="text-4xl font-black pt-2">{info.price}</p>
          </div>
        ) : (
          <p className="text-sm text-[color:var(--text-muted)]">正在载入商品信息…</p>
        )}

        <button
          type="button"
          onClick={handlePay}
          disabled={busy || !info}
          className="block w-full rounded-2xl bg-white text-black font-semibold py-4 disabled:opacity-50"
        >
          {status === 'creating' ? '下单中…' : status === 'paying' ? '支付中…' : '立即支付'}
        </button>

        {message && (
          <p
            className={
              status === 'success'
                ? 'text-sm text-green-400'
                : status === 'failed'
                  ? 'text-sm text-red-400'
                  : 'text-sm text-[color:var(--text-muted)]'
            }
          >
            {message}
          </p>
        )}

        <p className="text-xs text-[color:var(--text-muted)] pt-2">支付由微信支付提供 · 个体工商户主体</p>
      </div>
    </main>
  );
}
