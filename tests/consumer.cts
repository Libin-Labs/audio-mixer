import {
  mix,
  panGains,
  type ClipMode,
  type MixClip,
  type MixOptions,
  type MixResult,
  type PanLaw,
  type SampleBuffer,
} from '@lp-labs/audio-mixer';
const mono: SampleBuffer = new Float32Array([0.5, -0.5]);
const clip: MixClip = { channels: [mono], startSample: 1, gain: 0.5, pan: -1 };
const law: PanLaw = 'linear';
const clipMode: ClipMode = 'hard';
const options: MixOptions = { channelCount: 2, panLaw: law, clipMode };
const result: MixResult = mix([clip], options);
result.channels[0]?.length.toFixed();
const gains: readonly [number, number] = panGains(0, 'constant-power', 1);
void gains;
// @ts-expect-error channelCount is required
mix([clip], {});
// @ts-expect-error unknown pan law
panGains(0, 'sine', 1);
// @ts-expect-error source channel count is 1 or 2
panGains(0, 'linear', 3);
// @ts-expect-error startSample is required
const missing: MixClip = { channels: [mono] };
void missing;
