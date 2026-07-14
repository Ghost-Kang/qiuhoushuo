import type { DoubaoHighlightImageConfig } from './highlight-image';

export const LAOLI_REFERENCE_PROMPT = [
  '50岁北方退休老球迷，圆脸短发微白，戴老花镜，端搪瓷茶杯，坐书桌前，暖光，',
  '半写实数字插画风（非照片级写实人脸），9:16竖构图，胸像。',
  '球评本为空白本，电视为关闭黑屏，画面无任何可读文字、赛事会徽、球星真人或官方台标。',
].join('');

export function buildLaoliReferenceRequest(config: DoubaoHighlightImageConfig): Record<string, unknown> {
  return {
    model: config.model,
    prompt: LAOLI_REFERENCE_PROMPT,
    size: config.size,
    sequential_image_generation: 'disabled',
    stream: false,
    response_format: 'url',
    watermark: true,
  };
}
