import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/700.css';
import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  Loop,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { VideoScript } from '../lib/api/laoli-video-script';
import { buildMetricCards } from '../lib/api/laoli-video-motion';

export interface LaoliTalkingHeadClipProp {
  src: string;
  startSec: number;
  durationSec: number;
  subtitle: string;
}

export interface LaoliCompositionProps extends Record<string, unknown> {
  script: VideoScript;
  referenceImage: string;
  rawVideo?: string;
  briefImage?: string;
  degraded: boolean;
  /** true 且 clips 非空 → 「老李口播为主」全屏出镜对口型版式。 */
  talkingHead?: boolean;
  clips?: LaoliTalkingHeadClipProp[];
  totalSec?: number;
}

const GREEN = '#37f27f';
const CYAN = '#26d9ff';
const YELLOW = '#ffd84a';
const INK = '#071017';

export const LaoliVideo: React.FC<LaoliCompositionProps> = ({
  script,
  referenceImage,
  rawVideo,
  briefImage,
  degraded,
  talkingHead,
  clips,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const score = script.title.match(/(\d+:\d+)/)?.[1] || '赛果已定';
  const titleParts = script.title.split('·')[0]?.trim().split(/\s+/) ?? [];
  const home = titleParts[0] || '主队';
  const away = titleParts.at(-1) || '客队';

  if (talkingHead && clips && clips.length > 0) {
    return (
      <AbsoluteFill style={{ backgroundColor: INK, color: 'white', fontFamily: '"Noto Sans SC", sans-serif' }}>
        <TalkingHeadStage clips={clips} home={home} away={away} score={score} fps={fps} />
        <AigcWatermark text={script.watermark} />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: INK, color: 'white', fontFamily: '"Noto Sans SC", sans-serif' }}>
      <MovingBackdrop
        referenceImage={referenceImage}
        rawVideo={rawVideo}
        frame={frame}
        fps={fps}
      />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(3,10,15,.2), rgba(3,10,15,.82) 55%, #071017)' }} />

      <Sequence from={0} durationInFrames={3 * fps}>
        <Hook home={home} away={away} score={score} quote={script.segments[0]?.subtitle || ''} />
      </Sequence>
      <Sequence from={3 * fps} durationInFrames={21 * fps}>
        <DataStory
          briefImage={briefImage}
          lines={script.segments.slice(1, 3).map((segment) => segment.subtitle)}
        />
      </Sequence>
      <Sequence from={24 * fps} durationInFrames={5 * fps}>
        <Quote text={script.segments.find((segment) => segment.visual === 'quote')?.subtitle || ''} />
      </Sequence>
      <Sequence from={29 * fps} durationInFrames={6 * fps}>
        <Outro text={script.segments.at(-1)?.subtitle || ''} degraded={degraded} />
      </Sequence>

      <Subtitle text={subtitleAtFrame(script, frame, fps)} />
      <AigcWatermark text={script.watermark} />
    </AbsoluteFill>
  );
};

const TalkingHeadStage: React.FC<{
  clips: LaoliTalkingHeadClipProp[];
  home: string;
  away: string;
  score: string;
  fps: number;
}> = ({ clips, home, away, score, fps }) => {
  const frame = useCurrentFrame();
  const subtitle = clipSubtitleAtFrame(clips, frame, fps);
  return (
    <AbsoluteFill>
      {clips.map((clip, index) => (
        <Sequence
          key={`${clip.src}-${index}`}
          from={Math.round(clip.startSec * fps)}
          durationInFrames={Math.max(1, Math.round(clip.durationSec * fps))}
        >
          <AbsoluteFill>
            <OffthreadVideo
              src={staticFile(clip.src)}
              muted
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </AbsoluteFill>
        </Sequence>
      ))}
      {/* 上下渐变保证顶部比分条与底部字幕可读,老李仍是主体 */}
      <AbsoluteFill style={{
        background: 'linear-gradient(180deg, rgba(3,10,15,.55) 0%, rgba(3,10,15,0) 26%, rgba(3,10,15,0) 60%, rgba(3,10,15,.88) 100%)',
      }} />
      <ScoreChip home={home} away={away} score={score} />
      <Subtitle text={subtitle} />
    </AbsoluteFill>
  );
};

const ScoreChip: React.FC<{ home: string; away: string; score: string }> = ({ home, away, score }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 150 } });
  return (
    <div style={{
      position: 'absolute',
      top: 120,
      left: 48,
      display: 'flex',
      alignItems: 'center',
      gap: 18,
      padding: '16px 28px',
      background: 'rgba(4,14,20,.72)',
      border: `2px solid ${GREEN}`,
      borderRadius: 14,
      transform: `translateY(${(1 - enter) * -60}px)`,
      opacity: enter,
    }}>
      <span style={{ fontSize: 38, fontWeight: 700 }}>{home}</span>
      <span style={{ fontSize: 52, fontWeight: 700, color: GREEN }}>{score}</span>
      <span style={{ fontSize: 38, fontWeight: 700 }}>{away}</span>
    </div>
  );
};

const MovingBackdrop: React.FC<{
  referenceImage: string;
  rawVideo?: string;
  frame: number;
  fps: number;
}> = ({ referenceImage, rawVideo, frame, fps }) => {
  const zoom = interpolate(frame, [0, 35 * fps], [1.02, 1.12], { extrapolateRight: 'clamp' });
  if (rawVideo) {
    return (
      <AbsoluteFill style={{ opacity: 0.72 }}>
        <Loop durationInFrames={4 * fps}>
          <OffthreadVideo
            src={staticFile(rawVideo)}
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </Loop>
      </AbsoluteFill>
    );
  }
  return (
    <Img
      src={staticFile(referenceImage)}
      style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})` }}
    />
  );
};

const Hook: React.FC<{ home: string; away: string; score: string; quote: string }> = ({
  home,
  away,
  score,
  quote,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 150 } });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 76 }}>
      <div style={{ fontSize: 52, fontWeight: 700, color: GREEN, transform: `translateY(${(1 - enter) * -70}px)` }}>
        {home} 对 {away}
      </div>
      <div style={{ fontSize: 220, lineHeight: 1, fontWeight: 700, margin: '30px 0', transform: `scale(${enter})` }}>
        {score}
      </div>
      <div style={{
        maxWidth: 900,
        fontSize: 48,
        lineHeight: 1.45,
        textAlign: 'center',
        opacity: interpolate(frame, [12, 28], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
      }}>
        {quote}
      </div>
    </AbsoluteFill>
  );
};

const DataStory: React.FC<{ briefImage?: string; lines: string[] }> = ({ briefImage, lines }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const metrics = buildMetricCards(lines);
  return (
    <AbsoluteFill style={{ padding: '180px 64px 330px', justifyContent: 'center' }}>
      {briefImage ? (
        <Img
          src={staticFile(briefImage)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0.28,
            filter: 'blur(5px)',
            transform: `scale(${interpolate(frame, [0, 21 * fps], [1.12, 1.02])})`,
          }}
        />
      ) : null}
      <div style={{ fontSize: 38, color: CYAN, fontWeight: 700, marginBottom: 34 }}>90 秒抓住胜负手</div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 22,
        padding: 24,
        background: 'rgba(4,14,20,.7)',
        border: '1px solid rgba(38,217,255,.28)',
      }}>
        {metrics.map((metric, index) => {
          const local = frame - index * 18;
          const enter = spring({ frame: local, fps, config: { damping: 16 } });
          const bar = interpolate(local, [4, 35], [0, metric.percent], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <div
              key={`${metric.label}-${index}`}
              style={{
                background: 'rgba(8,20,27,.88)',
                border: `2px solid ${index % 2 ? CYAN : GREEN}`,
                padding: '30px',
                minHeight: 190,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transform: `translateY(${(1 - enter) * 90}px) scale(${0.94 + enter * 0.06})`,
                opacity: enter,
              }}
            >
              <div style={{ fontSize: 34, fontWeight: 700, color: index % 2 ? CYAN : GREEN }}>
                {metric.homeValue === undefined ? '关键回合' : metric.label}
              </div>
              {metric.homeValue !== undefined && metric.awayValue !== undefined ? (
                <div style={{ fontSize: 66, lineHeight: 1, fontWeight: 700 }}>
                  {Math.round(metric.homeValue * Math.min(1, Math.max(0, local / 28)))}{metric.suffix}
                  <span style={{ color: '#87949d', fontSize: 34, margin: '0 14px' }}>:</span>
                  {Math.round(metric.awayValue * Math.min(1, Math.max(0, local / 28)))}{metric.suffix}
                </div>
              ) : (
                <div style={{ fontSize: 34, lineHeight: 1.4, fontWeight: 700 }}>{metric.label}</div>
              )}
              <div style={{ height: 12, background: 'rgba(255,255,255,.14)' }}>
                <div style={{ width: `${bar}%`, height: '100%', background: index % 2 ? CYAN : GREEN }} />
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Quote: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 12 } });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: 80 }}>
      <div style={{ color: YELLOW, fontSize: 36, fontWeight: 700, marginBottom: 26 }}>老李一句话</div>
      <div style={{
        fontSize: 70,
        fontWeight: 700,
        lineHeight: 1.38,
        borderLeft: `12px solid ${GREEN}`,
        paddingLeft: 42,
        transform: `translateY(${(1 - enter) * 120}px)`,
        opacity: enter,
      }}>
        {text}
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ text: string; degraded: boolean }> = ({ text, degraded }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 13 } });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 90 }}>
      <div style={{ fontSize: 82, color: GREEN, fontWeight: 700, transform: `scale(${enter})` }}>超帧球后说</div>
      <div style={{ fontSize: 46, lineHeight: 1.5, textAlign: 'center', marginTop: 36 }}>{text}</div>
      {degraded ? <div style={{ marginTop: 30, color: '#aebbc4', fontSize: 28 }}>动态数据保底版</div> : null}
    </AbsoluteFill>
  );
};

const Subtitle: React.FC<{ text: string }> = ({ text }) => (
  <div style={{
    position: 'absolute',
    left: 48,
    right: 48,
    bottom: 118,
    background: 'rgba(0,0,0,.74)',
    borderLeft: `8px solid ${GREEN}`,
    padding: '24px 30px',
    fontSize: 38,
    lineHeight: 1.45,
    fontWeight: 700,
    textAlign: 'center',
  }}>
    {text}
  </div>
);

const AigcWatermark: React.FC<{ text: string }> = ({ text }) => (
  <div style={{
    position: 'absolute',
    top: 42,
    right: 42,
    padding: '12px 20px',
    background: 'rgba(0,0,0,.7)',
    border: '2px solid rgba(255,255,255,.55)',
    color: 'white',
    fontSize: 27,
    fontWeight: 700,
  }}>
    {text}
  </div>
);

function subtitleAtFrame(script: VideoScript, frame: number, fps: number): string {
  const second = frame / fps;
  return script.segments.find((segment) => second >= segment.startSec && second < segment.endSec)?.subtitle || '';
}

function clipSubtitleAtFrame(clips: LaoliTalkingHeadClipProp[], frame: number, fps: number): string {
  const second = frame / fps;
  const active = clips.find((clip) => second >= clip.startSec && second < clip.startSec + clip.durationSec);
  return (active ?? clips.at(-1))?.subtitle || '';
}
