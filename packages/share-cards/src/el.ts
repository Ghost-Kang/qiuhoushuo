export type SatoriNode = {
  type: string;
  props: Record<string, unknown> & { children?: unknown };
};

/** 队名后小国旗(3:2 圆角;src 已由 web 包装层 fetch→base64)。无旗返回 null(由 el 自动过滤,不占位)。
 *  h=旗高,宽=1.5h(国旗约 3:2),左留间距;放在「队名 + 旗」的横向 flex 行里。 */
export function flagImg(flagUrl: string | undefined, h: number): SatoriNode | null {
  if (!flagUrl) return null;
  const w = Math.round(h * 1.5);
  return el('img', { src: flagUrl, width: w, height: h, style: { width: w, height: h, objectFit: 'cover', borderRadius: 4, marginLeft: Math.round(h * 0.34) } });
}

export function el(type: string, props?: Record<string, unknown> | null, ...children: unknown[]): SatoriNode {
  const filteredChildren = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  let finalProps = props || {};
  if (type === 'div') {
    const style = (finalProps.style || {}) as Record<string, unknown>;
    if (!style.display) {
      finalProps = { ...finalProps, style: { display: 'flex', ...style } };
    }
  }
  return {
    type,
    props: {
      ...finalProps,
      children: filteredChildren.length === 1 ? filteredChildren[0] : filteredChildren,
    },
  };
}
