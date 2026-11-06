export type SampleBuffer = Float32Array | Float64Array | readonly number[];
export type PanLaw = 'constant-power' | 'linear';
export type ClipMode = 'none' | 'hard';

export interface MixClip {
  /** Planar channels; either one (mono) or exactly options.channelCount channels of equal length. */
  channels: readonly SampleBuffer[];
  /** Output frame at which the first sample is placed. */
  startSample: number;
  /** Linear gain multiplier, default 1. */
  gain?: number;
  /** -1 (left) .. 1 (right); only allowed when channelCount is 2. Default 0. */
  pan?: number;
}

export interface MixOptions {
  channelCount: number;
  /** Output frames; defaults to the end of the last clip. Longer clips are truncated. */
  length?: number;
  panLaw?: PanLaw;
  clipMode?: ClipMode;
  maxClips?: number;
  /** Budget for frames * channelCount (default 16777216). */
  maxOutputSamples?: number;
}

export interface MixResult {
  channels: Float32Array[];
  length: number;
  /** Largest absolute accumulated value before any clamping. */
  peak: number;
  /** Number of output samples whose accumulated absolute value exceeded 1. */
  clippedSamples: number;
}

export const MAX_CHANNELS = 32;

function integer(name: string, value: unknown, min: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    throw new RangeError(`${name} must be a safe integer >= ${min}`);
  }
  return value;
}

/** Gains for [left, right]. Mono sources are panned; stereo sources are balanced (center = unity). */
export function panGains(
  pan: number,
  law: PanLaw,
  sourceChannels: 1 | 2,
): readonly [number, number] {
  if (typeof pan !== 'number' || !Number.isFinite(pan) || pan < -1 || pan > 1) {
    throw new RangeError('pan must be a finite number from -1 to 1');
  }
  if (law !== 'constant-power' && law !== 'linear') throw new TypeError('unknown panLaw');
  if (sourceChannels === 1) {
    if (law === 'constant-power') {
      const angle = ((pan + 1) * Math.PI) / 4;
      return [Math.cos(angle), Math.sin(angle)];
    }
    return [(1 - pan) / 2, (1 + pan) / 2];
  }
  if (law === 'constant-power') {
    return [
      pan > 0 ? Math.cos((pan * Math.PI) / 2) : 1,
      pan < 0 ? Math.cos((-pan * Math.PI) / 2) : 1,
    ];
  }
  return [pan > 0 ? 1 - pan : 1, pan < 0 ? 1 + pan : 1];
}

/** Mixes finite planar clips into new Float32Array channels. Inputs are never modified. */
export function mix(clips: readonly MixClip[], options: MixOptions): MixResult {
  if (!Array.isArray(clips)) throw new TypeError('clips must be an array');
  if (typeof options !== 'object' || options === null)
    throw new TypeError('options must be an object');
  const channelCount = integer('channelCount', options.channelCount, 1);
  if (channelCount > MAX_CHANNELS) throw new RangeError(`channelCount must be <= ${MAX_CHANNELS}`);
  const panLaw = options.panLaw ?? 'constant-power';
  if (panLaw !== 'constant-power' && panLaw !== 'linear') throw new TypeError('unknown panLaw');
  const clipMode = options.clipMode ?? 'none';
  if (clipMode !== 'none' && clipMode !== 'hard') throw new TypeError('unknown clipMode');
  const maxClips = options.maxClips === undefined ? 256 : integer('maxClips', options.maxClips, 0);
  const maxOutput =
    options.maxOutputSamples === undefined
      ? 16_777_216
      : integer('maxOutputSamples', options.maxOutputSamples, 0);
  if (clips.length > maxClips) throw new RangeError('clip count exceeds maxClips');

  let end = 0;
  const prepared = clips.map((clip, index) => {
    if (typeof clip !== 'object' || clip === null || !Array.isArray(clip.channels)) {
      throw new TypeError(`clips[${index}].channels must be an array of sample buffers`);
    }
    const sources = clip.channels as readonly unknown[];
    if (sources.length !== 1 && sources.length !== channelCount) {
      throw new RangeError(`clips[${index}] must have 1 or ${channelCount} channels`);
    }
    const start = integer(`clips[${index}].startSample`, clip.startSample, 0);
    const gain = clip.gain ?? 1;
    if (typeof gain !== 'number' || !Number.isFinite(gain)) {
      throw new RangeError(`clips[${index}].gain must be finite`);
    }
    const pan = clip.pan ?? 0;
    if (typeof pan !== 'number' || !Number.isFinite(pan) || pan < -1 || pan > 1) {
      throw new RangeError(`clips[${index}].pan must be from -1 to 1`);
    }
    if (pan !== 0 && channelCount !== 2) {
      throw new RangeError(`clips[${index}].pan requires channelCount 2`);
    }
    let frames = -1;
    for (const [c, source] of sources.entries()) {
      if (!(
        source instanceof Float32Array ||
        source instanceof Float64Array ||
        Array.isArray(source)
      )) {
        throw new TypeError(
          `clips[${index}].channels[${c}] must be a Float32Array, Float64Array or array`,
        );
      }
      const values = source as ArrayLike<unknown>;
      if (frames === -1) frames = values.length;
      else if (frames !== values.length)
        throw new RangeError(`clips[${index}] channels differ in length`);
      for (let i = 0; i < values.length; i++) {
        const value = values[i];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new RangeError(`clips[${index}].channels[${c}][${i}] must be a finite number`);
        }
      }
    }
    end = Math.max(end, start + frames);
    const mono = sources.length === 1;
    let gains: number[];
    if (channelCount === 2) {
      const [left, right] = panGains(pan, panLaw, mono ? 1 : 2);
      gains = [gain * left, gain * right];
    } else {
      gains = Array.from({ length: channelCount }, () => gain);
    }
    return { sources: sources as readonly SampleBuffer[], start, gains, mono };
  });

  const length = options.length === undefined ? end : integer('length', options.length, 0);
  if (length * channelCount > maxOutput) throw new RangeError('output exceeds maxOutputSamples');
  const accumulators = Array.from({ length: channelCount }, () => new Float64Array(length));
  for (const clip of prepared) {
    for (let c = 0; c < channelCount; c++) {
      const source = clip.sources[clip.mono ? 0 : c]!;
      const target = accumulators[c]!;
      const gain = clip.gains[c]!;
      const count = Math.min(source.length, length - clip.start);
      for (let i = 0; i < count; i++) target[clip.start + i]! += source[i]! * gain;
    }
  }
  let peak = 0;
  let clippedSamples = 0;
  const channels = accumulators.map((accumulator) => {
    const output = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const value = accumulator[i]!;
      const magnitude = Math.abs(value);
      if (magnitude > peak) peak = magnitude;
      if (magnitude > 1) clippedSamples++;
      output[i] = clipMode === 'hard' ? Math.max(-1, Math.min(1, value)) : value;
    }
    return output;
  });
  return { channels, length, peak, clippedSamples };
}
