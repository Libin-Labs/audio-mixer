# @lp-labs/audio-mixer

Mixes finite planar audio clips into new Float32Array channels with explicit placement, gain, pan law and clip accounting. Catalog identity 485; standalone package version 1.0.0.
No runtime, peer, or sibling dependencies. Node >=18, ESM and CommonJS with declarations.

## Install

```sh
npm install @lp-labs/audio-mixer
```

## Quickstart (runnable JavaScript)

```js
import assert from 'node:assert/strict';
import { mix } from '@lp-labs/audio-mixer';
const result = mix(
  [
    { channels: [[0.5, 0.5, 0.5]], startSample: 0, gain: 0.5, pan: -1 },
    {
      channels: [
        [0.25, 0.25],
        [0.5, 0.5],
      ],
      startSample: 2,
    },
  ],
  { channelCount: 2, panLaw: 'linear', clipMode: 'hard' },
);
assert.equal(result.length, 4);
assert.deepEqual(Array.from(result.channels[0]), [0.25, 0.25, 0.5, 0.25]);
assert.deepEqual(Array.from(result.channels[1]), [0, 0, 0.5, 0.5]);
assert.equal(result.clippedSamples, 0);
```

## Configuration and errors

`mix(clips, options)`: `options.channelCount` (1..32) is required. A clip supplies planar `channels` (Float32Array, Float64Array or number arrays of equal length) that are either 1 (mono, spread to every output channel) or exactly `channelCount`; `startSample` is a non-negative integer output frame; `gain` is a linear multiplier (default 1); `pan` is -1..1 (default 0) and is only legal when `channelCount` is 2. `panLaw` is `constant-power` (default) or `linear`; `clipMode` is `none` (default, values are left unclamped) or `hard` (clamp to [-1, 1]). `length` fixes the output frames (longer clips are truncated); otherwise it is the end of the last clip. `maxClips` (default 256) and `maxOutputSamples` (frames * channels, default 16777216) are budgets.

Pan laws: a mono source is panned (constant-power: `cos/sin((pan+1)π/4)`, centre −3 dB per side; linear: `(1∓pan)/2`, centre 0.5). A stereo source is balanced (centre = unity; the opposite side is attenuated by `cos(|pan|π/2)` or `1−|pan|`). Channel counts other than 2 get gain only.

Errors: `TypeError` for wrong container/option types or unknown law/mode; `RangeError` for non-finite samples, bad counts, positions, pan/gain, mismatched channel lengths and exceeded budgets. Nothing is returned on failure.

## Complete public declarations

Every runtime export and public type is shown below. This is the complete emitted declaration surface.

```ts
export type SampleBuffer = Float32Array | Float64Array | readonly number[];
export type PanLaw = 'constant-power' | 'linear';
export type ClipMode = 'none' | 'hard';
export interface MixClip {
  channels: readonly SampleBuffer[];
  startSample: number;
  gain?: number;
  pan?: number;
}
export interface MixOptions {
  channelCount: number;
  length?: number;
  panLaw?: PanLaw;
  clipMode?: ClipMode;
  maxClips?: number;
  maxOutputSamples?: number;
}
export interface MixResult {
  channels: Float32Array[];
  length: number;
  peak: number;
  clippedSamples: number;
}
export declare const MAX_CHANNELS = 32;
export declare function panGains(
  pan: number,
  law: PanLaw,
  sourceChannels: 1 | 2,
): readonly [number, number];
export declare function mix(clips: readonly MixClip[], options: MixOptions): MixResult;
```

## Performance, boundaries and limitations

No resampling, format/codec decoding, channel-layout remixing (for example 5.1 to stereo), fades, ducking or limiter: clips must already share one sample rate and channel count, and conversions are the caller's explicit job. Accumulation is done in double precision and stored as Float32. `peak` is the largest absolute accumulated value before clamping and `clippedSamples` counts samples above 1 in magnitude whether or not they were clamped. Work is O(total clip samples + output samples); memory is one Float64Array and one Float32Array per output channel, bounded by `maxOutputSamples`. Inputs are never modified and outputs are new arrays.

## Development

```sh
npm ci --offline
npm run build
npm run typecheck
npm test
npm run format:check
```

The offline install requires the locked development dependencies already in the npm cache.
Build emits separate ESM/CJS and declarations; type checks include bare-package .mts/.cts consumers with negative cases.
Runtime tests import only the single-quoted standalone dist entry and also run against installed offline tarballs.
No build artifacts or development dependencies are required at runtime.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
