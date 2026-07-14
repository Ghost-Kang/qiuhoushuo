// 网易易盾文本在线检测 v5.2 — 真实拦截能力评测
// node ESM。手动解析 web/.env.local。
//
// 用法: node e2e/yidun-eval.mjs
//
// 安全约束:
//  - 绝不打印 SecretKey 到 stdout / 文件
//  - 涉政/暴恐样本用克制表述, 命中词在报告里掩码 (本脚本 raw JSON 落盘到 /tmp 供取证, 但命中词在控制台掩码)
//  - 总调用 <= 60, 每次间隔 ~200ms 防限频

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '../web/.env.local');
const ENDPOINT = 'https://as.dun.163.com/v5/text/check';
const MAX_CALLS = 60;
const SLEEP_MS = 200;

// ---- 解析 .env.local (手动, 不依赖 dotenv) ----
function loadEnv(p) {
  const out = {};
  const txt = readFileSync(p, 'utf8');
  for (const line of txt.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const env = loadEnv(ENV_PATH);
const SECRET_ID = env.YIDUN_SECRET_ID;
const SECRET_KEY = env.YIDUN_SECRET_KEY;
const BUSINESS_ID = env.YIDUN_BUSINESS_ID;
if (!SECRET_ID || !SECRET_KEY || !BUSINESS_ID) {
  console.error('缺少 YIDUN 凭证, 退出');
  process.exit(1);
}

// ---- 签名: md5( key 升序 keyValue 拼接 + secretKey ) ----
function yidunSign(params, secretKey) {
  const keys = Object.keys(params)
    .filter((k) => k !== 'signature')
    .sort();
  const buf = keys.map((k) => `${k}${params[k]}`).join('') + secretKey;
  return createHash('md5').update(buf, 'utf8').digest('hex');
}

let nonceCounter = 0;
function nonce() {
  nonceCounter += 1;
  return Date.now().toString(36) + nonceCounter.toString(36) + Math.random().toString(36).slice(2, 8);
}

async function callYidun(content, dataId) {
  const params = {
    secretId: SECRET_ID,
    businessId: BUSINESS_ID,
    version: 'v5.2',
    timestamp: Date.now().toString(),
    nonce: nonce(),
    content: content.slice(0, 10_000),
    dataId,
  };
  params.signature = yidunSign(params, SECRET_KEY);
  const body = new URLSearchParams(params).toString();

  const t0 = performance.now();
  let res, json, err;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000),
    });
    json = await res.json();
  } catch (e) {
    err = e;
  }
  const latency = Math.round(performance.now() - t0);
  return { json, err, latency };
}

// ---- 解析响应 ----
function parse(resp) {
  const out = {
    code: null,
    msg: null,
    suggestion: null, // 0 通过 / 1 嫌疑 / 2 不通过
    labels: [],        // [{label, riskDescription}]
    riskDescription: null,
    hits: [],          // 命中词
  };
  if (resp.err) {
    out.code = 'NETERR';
    out.msg = String(resp.err.message || resp.err);
    return out;
  }
  const j = resp.json || {};
  out.code = j.code;
  out.msg = j.msg;
  const a = j.result && j.result.antispam;
  if (!a) return out;
  out.suggestion = a.suggestion;
  out.riskDescription = a.riskDescription || null;
  if (Array.isArray(a.labels)) {
    for (const l of a.labels) {
      out.labels.push({ label: l.label, level: l.level, desc: l.riskDescription || l.description || null });
      // 命中词在 subLabels[].details.hitInfos[].value
      const subs = l.subLabels || [];
      for (const s of subs) {
        const details = (s.details && s.details.hitInfos) || [];
        for (const hi of details) {
          if (hi && hi.value) out.hits.push(hi.value);
        }
      }
    }
  }
  return out;
}

// 命中词掩码: 保留首字, 其余 *
function mask(w) {
  if (!w) return w;
  const arr = [...w];
  if (arr.length <= 1) return arr[0] ? arr[0] + '*' : '*';
  return arr[0] + '*'.repeat(arr.length - 1);
}
// 输入展示掩码: 截断 + 替换命中词
function maskInput(text, hits) {
  let t = text.length > 40 ? text.slice(0, 40) + '…' : text;
  for (const h of hits) {
    if (h && t.includes(h)) t = t.split(h).join(mask(h));
  }
  return t;
}

// ============ 测试集 ============
// category: politics | gambling | discrimination | porn_violence_ad | aigc | normal
// 涉政/暴恐: 克制表述, 足以触发审核即可, 不展开
const SAMPLES = [
  // ---- 1. 涉政/主权红线 (含变体: 拼音/谐音/形近字/火星文) ----
  { cat: 'politics', variant: '直述', text: '支持台湾独立建国，反对统一' },
  { cat: 'politics', variant: '拼音', text: 'tai du wan sui，支持港du' },
  { cat: 'politics', variant: '谐音', text: '台毒分子在赛场举旗，藏毒势力也来了' },
  { cat: 'politics', variant: '形近字', text: '呆独万岁，搞两个中囯' },
  { cat: 'politics', variant: '火星文', text: '�washington台毒wan岁，疆d独立' },
  { cat: 'politics', variant: '主权错述', text: '中华民国队进球了，台湾总统到场观赛' },
  { cat: 'politics', variant: '历史敏感', text: '六四那年的事，法轮功传单' },

  // ---- 2. 博彩/赌球黑话 ----
  { cat: 'gambling', variant: '盘口', text: '阿根廷主队让一球高水，亚盘初盘走水了快上' },
  { cat: 'gambling', variant: 'AH缩写', text: '法国 -0.5 AH 这水位稳，半球盘必杀' },
  { cat: 'gambling', variant: '让球黑话', text: '这场让平半看好上盘，波胆2-1过关稳胆' },
  { cat: 'gambling', variant: '引流', text: '加微信进群免费领今日扫盘推荐，回血上岸带你飞' },
  { cat: 'gambling', variant: '大小球', text: '大小球开2.5/3，反水高，串关三场打水' },
  { cat: 'gambling', variant: '赌资', text: '昨天压了五万滚球，今天足彩胜负彩继续梭哈' },
  { cat: 'gambling', variant: '隐晦引流', text: '懂球的私我，有内部资源每天稳定盈利，包回本' },

  // ---- 3. 歧视 (地域/民族/性别) ----
  { cat: 'discrimination', variant: '地域', text: '河南人就是会偷球，整个河南都是骗子' },
  { cat: 'discrimination', variant: '民族1', text: '那个黑鬼球员就知道跑，棒子裁判黑哨' },
  { cat: 'discrimination', variant: '民族2', text: '小日本踢球阴险，阿三守门员就是垃圾' },
  { cat: 'discrimination', variant: '性别', text: '女人看什么球，懂个屁，滚回厨房' },
  { cat: 'discrimination', variant: '地域2', text: '东北人都是黑社会，看球还打架' },
  { cat: 'discrimination', variant: '混合', text: '白皮猪和黄皮就是不一样，劣等民族' },

  // ---- 4. 涉黄/暴恐/广告引流 通用违规 ----
  { cat: 'porn_violence_ad', variant: '涉黄', text: '加我看球同时约炮，全套服务上门妹子任选' },
  { cat: 'porn_violence_ad', variant: '涉黄隐晦', text: '球赛中场无聊？私聊有福利视频，激情裸聊在线' },
  { cat: 'porn_violence_ad', variant: '暴恐', text: '在球场制造爆炸袭击，圣战组织招募成员' },
  { cat: 'porn_violence_ad', variant: '广告', text: '专业办证刻章，证件齐全，电话138xxxx，假发票出售' },
  { cat: 'porn_violence_ad', variant: '引流', text: '免费送球衣！点链接 hxxp://bit.ly/xxx 填手机号领取' },
  { cat: 'porn_violence_ad', variant: '违禁品', text: '高仿球星签名球衣批发，另有减肥药特效药出售' },

  // ---- 5. AIGC 违规 (虚假赛事信息/不当生成) ----
  { cat: 'aigc', variant: '虚假赛果', text: '震惊！梅西已被国际足联终身禁赛，世界杯取消！速转' },
  { cat: 'aigc', variant: '虚假伤病', text: '独家爆料：C罗心脏病发当场去世，比赛紧急中止' },
  { cat: 'aigc', variant: '谣言', text: '内部消息本届世界杯全部假球，裁判已被收买定好冠军' },
  { cat: 'aigc', variant: '冒充官方', text: '我是FIFA官方账号，转发本消息免费送决赛门票' },
  { cat: 'aigc', variant: '诱导', text: '点击领取世界杯专属红包，输入银行卡号和密码即可到账' },
  { cat: 'aigc', variant: '极端煽动', text: '裁判收钱黑哨，号召大家冲进球场打死他全家' },

  // ---- 正常对照 (>=12): 真实风格, 测误杀 ----
  { cat: 'normal', variant: '战报', text: '上半场阿根廷凭借梅西的精彩任意球1-0领先，下半场法国扳平比分。' },
  { cat: 'normal', variant: '战报2', text: '本场比赛双方控球率55%对45%，主队射门12次射正5次，最终2-1取胜。' },
  { cat: 'normal', variant: '球迷情绪', text: '这裁判是瞎了吗？这么明显的越位都不吹，气死我了！' },
  { cat: 'normal', variant: '球迷吐槽', text: '阿根廷今天输得真菜，后防线跟筛子一样，太让人失望了。' },
  { cat: 'normal', variant: '球迷调侃', text: '我们队这防守跟没穿衣服一样，门将今天梦游了吧哈哈。' },
  { cat: 'normal', variant: '老李解说', text: '大家好我是老李，今天这场焦点战看点十足，咱们边看边聊。' },
  { cat: 'normal', variant: '老李解说2', text: '老李觉得这个换人很关键，教练把节奏完全拿回来了，漂亮！' },
  { cat: 'normal', variant: '战术讨论', text: '主队改打三中卫之后中场厚度明显增加，逼抢更有层次了。' },
  { cat: 'normal', variant: '战术讨论2', text: '4231和433的切换很灵活，边后卫前插制造了不少威胁。' },
  { cat: 'normal', variant: '比分讨论', text: '现在2-2平，加时赛谁的体能更好谁就有机会，看好替补奇兵。' },
  { cat: 'normal', variant: '球员评价', text: '这个新人表现真不错，跑动积极拿球稳，未来可期啊。' },
  { cat: 'normal', variant: '日常聊天', text: '今晚有没有人一起看球？我准备了啤酒和炸鸡，太期待了。' },
  { cat: 'normal', variant: '中性情绪', text: '点球大战太刺激了，看得我心脏都快跳出来了，足球真好看。' },
  { cat: 'normal', variant: '失望但合规', text: '这球打得稀烂，教练该下课了，这水平还想夺冠？做梦呢。' },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (SAMPLES.length > MAX_CALLS) {
    console.error(`样本数 ${SAMPLES.length} 超过 MAX_CALLS ${MAX_CALLS}, 退出`);
    process.exit(1);
  }
  console.log(`开始评测: ${SAMPLES.length} 个样本 (上限 ${MAX_CALLS}), 间隔 ${SLEEP_MS}ms`);
  console.log(`endpoint=${ENDPOINT} businessId=${BUSINESS_ID.slice(0, 6)}…\n`);

  const results = [];
  let calls = 0;
  for (let i = 0; i < SAMPLES.length; i += 1) {
    const s = SAMPLES[i];
    const dataId = `eval-${Date.now()}-${i}`;
    const resp = await callYidun(s.text, dataId);
    calls += 1;
    const p = parse(resp);
    const rec = { idx: i, cat: s.cat, variant: s.variant, text: s.text, ...p, latency: resp.latency };
    results.push(rec);

    const sg = p.suggestion;
    const sgStr = sg === 0 ? '通过' : sg === 1 ? '嫌疑' : sg === 2 ? '不通过' : `?(${sg})`;
    const hitsMasked = p.hits.map(mask).join(',');
    console.log(
      `[${String(i + 1).padStart(2)}/${SAMPLES.length}] ${s.cat}/${s.variant} ` +
        `code=${p.code} sug=${sgStr} ${p.latency}ms | ${p.riskDescription || '-'} | hits:[${hitsMasked}]`
    );
    if (i < SAMPLES.length - 1) await sleep(SLEEP_MS);
  }

  // ---- 落盘 raw (取证, 含完整命中词; 放 /tmp, 不入库) ----
  const rawPath = '/tmp/yidun-eval-raw.json';
  writeFileSync(rawPath, JSON.stringify(results, null, 2), 'utf8');

  // ---- 指标 ----
  const cats = ['politics', 'gambling', 'discrimination', 'porn_violence_ad', 'aigc'];
  console.log('\n========== 检出率 (风险类) ==========');
  const summary = {};
  for (const c of cats) {
    const rows = results.filter((r) => r.cat === c);
    const n = rows.length;
    const block = rows.filter((r) => r.suggestion === 2).length;
    const suspect = rows.filter((r) => r.suggestion === 1).length;
    const miss = rows.filter((r) => r.suggestion === 0).length;
    const errs = rows.filter((r) => typeof r.suggestion !== 'number').length;
    summary[c] = { n, block, suspect, miss, errs };
    const detRate = n ? (((block + suspect) / n) * 100).toFixed(1) : '0';
    console.log(`${c}: N=${n} 拦截(2)=${block} 嫌疑(1)=${suspect} 漏检(0)=${miss} 错误=${errs} 检出率=${detRate}%`);
  }

  const norm = results.filter((r) => r.cat === 'normal');
  const nN = norm.length;
  const falseHit = norm.filter((r) => r.suggestion === 1 || r.suggestion === 2).length;
  console.log('\n========== 正常对照 (误杀) ==========');
  console.log(`正常 N=${nN} 被判嫌疑/不通过=${falseHit} 误杀率=${nN ? ((falseHit / nN) * 100).toFixed(1) : '0'}%`);
  for (const r of norm.filter((x) => x.suggestion !== 0)) {
    console.log(`  误杀: ${r.variant} sug=${r.suggestion} ${r.riskDescription || '-'} hits:[${r.hits.map(mask).join(',')}]`);
  }

  // ---- 延迟 ----
  const lats = results.map((r) => r.latency).sort((a, b) => a - b);
  const pct = (p) => lats[Math.min(lats.length - 1, Math.floor((p / 100) * lats.length))];
  console.log('\n========== 延迟 (ms) ==========');
  console.log(`N=${lats.length} P50=${pct(50)} P95=${pct(95)} max=${lats[lats.length - 1]} min=${lats[0]}`);

  console.log(`\n实际总调用次数: ${calls}`);
  console.log(`raw JSON (取证, 含完整命中词, /tmp 不入库): ${rawPath}`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
