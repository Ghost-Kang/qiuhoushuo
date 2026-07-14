/**
 * PNG 隐式（元数据）标识注入
 *
 * 《人工智能生成合成内容标识办法》(2025-09 生效) 要求 AI 生成内容同时添加
 * 显式标识（可见，分享卡片已有品牌 "· AI 生成" + 战报 footer「AI 生成内容」）
 * 与隐式标识（文件元数据）。本模块把 AIGC 隐式标识写入分享卡片 PNG 的 tEXt/iTXt 块。
 *
 * 实现自带 CRC32（PNG 多项式 0xEDB88320），不依赖 Node 版本的 zlib.crc32，便于单测与跨环境。
 * 注：精确字段结构后续可对齐 GB 45438-2025，本版为合规 MVP（明确标注 AI 生成 + 服务提供者）。
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** PNG/zlib CRC32（多项式 0xEDB88320）。 */
export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const idx = (c ^ (buf[i] ?? 0)) & 0xff;
    c = ((CRC_TABLE[idx] ?? 0) ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** 组装一个 PNG 块：length(4) + type(4) + data + crc(4)，CRC 覆盖 type+data。 */
export function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** tEXt 块（Latin-1）：keyword + 0x00 + text。仅用于 ASCII 内容。 */
export function pngTextChunk(keyword: string, text: string): Buffer {
  const data = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]);
  return pngChunk('tEXt', data);
}

/** iTXt 块（UTF-8）：keyword + 0 + compressionFlag(0) + compressionMethod(0) + langTag + 0 + translatedKeyword + 0 + text。用于中文。 */
export function pngITextChunk(keyword: string, text: string): Buffer {
  const data = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0]), // keyword 终止
    Buffer.from([0, 0]), // compressionFlag=0 + compressionMethod=0（未压缩）
    Buffer.from([0]), // 空 language tag + 终止
    Buffer.from([0]), // 空 translated keyword + 终止
    Buffer.from(text, 'utf8'),
  ]);
  return pngChunk('iTXt', data);
}

export function isPng(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

const IHDR_END = 8 + 4 + 4 + 13 + 4; // 签名(8) + IHDR(len4+type4+data13+crc4) = 33

/**
 * 在 IHDR 之后、首个非 IHDR 块之前插入文本块（tEXt/iTXt 属辅助块，放此处合法，查看器忽略未知辅助块）。
 * 非 PNG 或缺 IHDR 时抛错（生产由 resvg 产出合法 PNG；malformed 应暴露而非静默）。
 */
export function addPngTextMetadata(png: Buffer, chunks: Buffer[]): Buffer {
  if (!isPng(png)) throw new Error('addPngTextMetadata: 输入不是 PNG（签名不符）');
  if (png.subarray(12, 16).toString('latin1') !== 'IHDR') throw new Error('addPngTextMetadata: 缺 IHDR');
  if (chunks.length === 0) return png;
  return Buffer.concat([png.subarray(0, IHDR_END), ...chunks, png.subarray(IHDR_END)]);
}

/** AIGC 隐式标识块集合（依《标识办法》随显式标识一同添加）。 */
export function aigcMetadataChunks(): Buffer[] {
  const label = JSON.stringify({
    AIGC: true,
    label: '人工智能生成',
    generated_by: 'AI',
    service: '超帧球后说 QiuHouShuo',
    provider: '深圳市宝安区超帧智能科技工作室',
  });
  return [pngITextChunk('AIGC', label), pngTextChunk('Software', 'QiuHouShuo-AIGC')];
}
