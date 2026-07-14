import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/700.css';
import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {
  buildXhsVideoTimeline,
  resolveXhsImageFitStyle,
  resolveXhsOutroScale,
  type XhsVideoAspect,
  type XhsVideoSceneInput,
  type XhsVideoSceneTiming,
} from '../lib/api/xhs-video-timeline';

export interface XhsNoteVideoProps extends Record<string, unknown> {
  scenes: XhsVideoSceneInput[];
  /** 常驻 AIGC 显著标识,像素层烧入,无开关 */
  watermark: string;
  outroTitle: string;
  outroSub: string;
  outroCta?: string;
  /** 缺省 'portrait'(1080x1920,现状不变);'landscape' = 1920x1080,画布尺寸由 index.tsx 的
   * calculateMetadata 覆写,此处只需按 useVideoConfig() 实际画布比例收敛 OutroScene 字号/间距 */
  aspect?: XhsVideoAspect;
}

const NAVY = '#0b1230';
const NAVY_DEEP = '#070b1e';
const GOLD = '#ffd84a';
const FONT = "'Noto Sans SC', sans-serif";

function useSceneMotion(
  durationInFrames: number,
  kind: XhsVideoSceneTiming['kind'],
  isFirst = false,
) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // 首场景不做入场动画:第 0 帧即完整素材图 → 小红书默认封面(首帧)= 图1
  const enter = isFirst
    ? 1
    : spring({ frame, fps, config: { damping: 200 }, durationInFrames: 16 });
  const exitFade = interpolate(
    frame,
    [Math.max(0, durationInFrames - 9), durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const zoomTo = kind === 'cover' ? 1.08 : 1.035;
  const scale = interpolate(frame, [0, durationInFrames], [1, zoomTo], {
    extrapolateRight: 'clamp',
  });
  const drift = interpolate(frame, [0, durationInFrames], [0, kind === 'cover' ? -18 : -10], {
    extrapolateRight: 'clamp',
  });
  return {
    opacity: enter * exitFade,
    translateY: (1 - enter) * 48,
    scale,
    drift,
  };
}

const ImageScene: React.FC<{ scene: XhsVideoSceneTiming; isFirst?: boolean }> = ({
  scene,
  isFirst,
}) => {
  const motion = useSceneMotion(scene.durationInFrames, scene.kind, isFirst);
  const { width, height } = useVideoConfig();
  const isLandscape = width > height;
  if (!scene.src) return null;
  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: -60,
          backgroundImage: `url(${scene.src})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(42px) brightness(0.45) saturate(1.1)',
          transform: 'scale(1.25)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: motion.opacity,
          transform: `translateY(${motion.translateY}px)`,
        }}
      >
        <Img
          src={scene.src}
          style={{
            ...resolveXhsImageFitStyle(isLandscape),
            borderRadius: 28,
            boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
            transform: `scale(${motion.scale}) translateY(${motion.drift}px)`,
          }}
        />
      </div>
    </>
  );
};

const OutroScene: React.FC<{
  scene: XhsVideoSceneTiming;
  title: string;
  sub: string;
  cta?: string;
}> = ({ scene, title, sub, cta }) => {
  const motion = useSceneMotion(scene.durationInFrames, scene.kind);
  const { width, height } = useVideoConfig();
  // 字号/间距是照竖版 1080x1920 画布调的死值。缩放系数见 resolveXhsOutroScale 注释:
  // 竖版 1080x1920 → scale=1,像素级不变;横版 1920x1080 → scale=1.08(专属基准,经实渲目检)。
  const scale = resolveXhsOutroScale(width, height);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 34 * scale,
        textAlign: 'center',
        color: '#fff',
        opacity: motion.opacity,
        transform: `translateY(${motion.translateY}px)`,
      }}
    >
      <div style={{ fontSize: 84 * scale, fontWeight: 700, letterSpacing: 4 * scale }}>
        {title}
      </div>
      <div
        style={{ fontSize: 44 * scale, color: 'rgba(255,255,255,0.78)', letterSpacing: 3 * scale }}
      >
        {sub}
      </div>
      {cta ? (
        <div
          style={{
            marginTop: 26 * scale,
            padding: `${22 * scale}px ${54 * scale}px`,
            borderRadius: 999,
            border: `${3 * scale}px solid ${GOLD}`,
            color: GOLD,
            fontSize: 42 * scale,
            fontWeight: 700,
            letterSpacing: 3 * scale,
          }}
        >
          {cta}
        </div>
      ) : null}
    </div>
  );
};

export const XhsNoteVideo: React.FC<XhsNoteVideoProps> = (props) => {
  const frame = useCurrentFrame();
  const timeline = buildXhsVideoTimeline({ scenes: props.scenes });
  const progressRatio = Math.min(1, frame / Math.max(1, timeline.durationInFrames - 1));
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${NAVY} 0%, ${NAVY_DEEP} 100%)`,
        fontFamily: FONT,
      }}
    >
      {timeline.scenes.map((scene, i) => (
        <Sequence key={i} from={scene.fromFrame} durationInFrames={scene.durationInFrames}>
          {scene.kind === 'outro' ? (
            <OutroScene
              scene={scene}
              title={props.outroTitle}
              sub={props.outroSub}
              cta={props.outroCta}
            />
          ) : (
            <ImageScene scene={scene} isFirst={i === 0} />
          )}
        </Sequence>
      ))}
      <div
        style={{
          position: 'absolute',
          top: 46,
          right: 40,
          padding: '10px 22px',
          borderRadius: 999,
          background: 'rgba(7,11,30,0.55)',
          color: 'rgba(255,255,255,0.85)',
          fontSize: 26,
          letterSpacing: 2,
          zIndex: 30,
        }}
      >
        {props.watermark}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 40,
          right: 40,
          bottom: 44,
          height: 8,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.18)',
          zIndex: 30,
        }}
      >
        <div
          style={{
            width: `${Math.round(progressRatio * 1000) / 10}%`,
            height: '100%',
            borderRadius: 999,
            background: GOLD,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
