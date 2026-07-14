import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { LaoliVideo, type LaoliCompositionProps } from './laoli-video';
import { XhsNoteVideo, type XhsNoteVideoProps } from './xhs-note-video';
import { buildXhsVideoTimeline, resolveXhsVideoDimensions } from '../lib/api/xhs-video-timeline';

const defaultProps: LaoliCompositionProps = {
  script: {
    version: 'laoli-postmatch-v1',
    width: 1080,
    height: 1920,
    durationSec: 35,
    title: '主队 1:0 客队 · 老李赛后说',
    watermark: 'AI生成内容',
    narration: '',
    segments: [],
  },
  referenceImage: 'reference.jpg',
  degraded: true,
};

const xhsDefaultProps: XhsNoteVideoProps = {
  scenes: [{ kind: 'outro' }],
  watermark: 'AI生成内容',
  outroTitle: '球后~会看球的女孩',
  outroSub: '赛后战报 · 每场更新',
};

const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="LaoliPostmatch"
      component={LaoliVideo}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={1050}
      defaultProps={defaultProps}
    />
    <Composition
      id="XhsNoteVideo"
      component={XhsNoteVideo}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={900}
      defaultProps={xhsDefaultProps}
      calculateMetadata={({ props }) => {
        // props.aspect 缺省 → resolveXhsVideoDimensions 落 'portrait' = 1080x1920,
        // 与上面字面量 width/height 一致 → 未传 aspect 的既有调用零变化。
        const { width, height } = resolveXhsVideoDimensions(props.aspect);
        return {
          durationInFrames: buildXhsVideoTimeline({ scenes: props.scenes }).durationInFrames,
          width,
          height,
        };
      }}
    />
  </>
);

registerRoot(RemotionRoot);
