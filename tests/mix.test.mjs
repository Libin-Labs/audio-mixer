import test from 'node:test';
import assert from 'node:assert/strict';
import { mix, panGains, MAX_CHANNELS } from '../dist/esm/index.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

function reference(clips, channelCount, length, law) {
  const out = Array.from({ length: channelCount }, () => new Array(length).fill(0));
  for (let f = 0; f < length; f++) {
    for (let c = 0; c < channelCount; c++) {
      for (const clip of clips) {
        const i = f - clip.startSample;
        const n = clip.channels[0].length;
        if (i < 0 || i >= n) continue;
        const gain = clip.gain ?? 1;
        const pan = clip.pan ?? 0;
        const mono = clip.channels.length === 1;
        let g = gain;
        if (channelCount === 2) {
          let l;
          let r;
          if (mono && law === 'linear') [l, r] = [(1 - pan) / 2, (1 + pan) / 2];
          else if (mono)
            [l, r] = [Math.cos(((pan + 1) * Math.PI) / 4), Math.sin(((pan + 1) * Math.PI) / 4)];
          else if (law === 'linear') [l, r] = [Math.min(1, 1 - pan), Math.min(1, 1 + pan)];
          else
            [l, r] = [
              Math.min(1, Math.cos((Math.max(pan, 0) * Math.PI) / 2)),
              Math.min(1, Math.cos((Math.max(-pan, 0) * Math.PI) / 2)),
            ];
          g *= c === 0 ? l : r;
        }
        out[c][f] += clip.channels[mono ? 0 : c][i] * g;
      }
    }
  }
  return out;
}

test('rejects malformed clips and options', () => {
  const ok = { channels: [[0.1]], startSample: 0 };
  assert.throws(() => mix('x', { channelCount: 1 }), TypeError);
  assert.throws(() => mix([ok], null), TypeError);
  for (const channelCount of [0, 1.5, -1, MAX_CHANNELS + 1, undefined, '2']) {
    assert.throws(() => mix([ok], { channelCount }), RangeError);
  }
  assert.throws(() => mix([ok], { channelCount: 1, panLaw: 'sine' }), TypeError);
  assert.throws(() => mix([ok], { channelCount: 1, clipMode: 'soft' }), TypeError);
  assert.throws(() => mix([null], { channelCount: 1 }), TypeError);
  assert.throws(() => mix([{ channels: 'x', startSample: 0 }], { channelCount: 1 }), TypeError);
  assert.throws(
    () => mix([{ channels: [[1], [1], [1]], startSample: 0 }], { channelCount: 2 }),
    RangeError,
  );
  assert.throws(
    () => mix([{ channels: [[1], [1, 2]], startSample: 0 }], { channelCount: 2 }),
    RangeError,
  );
  assert.throws(
    () => mix([{ channels: [new Int8Array(1)], startSample: 0 }], { channelCount: 1 }),
    TypeError,
  );
  assert.throws(
    () => mix([{ channels: [[Number.NaN]], startSample: 0 }], { channelCount: 1 }),
    RangeError,
  );
  for (const startSample of [-1, 1.5, undefined]) {
    assert.throws(() => mix([{ channels: [[1]], startSample }], { channelCount: 1 }), RangeError);
  }
  assert.throws(() => mix([{ ...ok, gain: Infinity }], { channelCount: 1 }), RangeError);
  assert.throws(() => mix([{ ...ok, pan: 2 }], { channelCount: 2 }), RangeError);
  assert.throws(() => mix([{ ...ok, pan: 0.5 }], { channelCount: 1 }), RangeError);
  assert.throws(() => mix([ok, ok], { channelCount: 1, maxClips: 1 }), RangeError);
  assert.throws(
    () => mix([ok], { channelCount: 2, length: 100, maxOutputSamples: 199 }),
    RangeError,
  );
  assert.throws(() => panGains(Number.NaN, 'linear', 1), RangeError);
  assert.throws(() => panGains(0, 'bad', 1), TypeError);
});

test('empty mix and explicit length produce silence', () => {
  const empty = mix([], { channelCount: 2 });
  assert.equal(empty.length, 0);
  assert.equal(empty.channels.length, 2);
  const padded = mix([], { channelCount: 1, length: 3 });
  assert.deepEqual(Array.from(padded.channels[0]), [0, 0, 0]);
});

test('matches an independent per-sample reference for mono/stereo clips and both laws', () => {
  const clips = [
    { channels: [[0.2, 0.4, -0.6, 0.8]], startSample: 0, gain: 0.7, pan: -0.5 },
    {
      channels: [
        [0.1, -0.2, 0.3],
        [0.5, 0.25, -0.75],
      ],
      startSample: 2,
      gain: 1.5,
      pan: 0.6,
    },
    { channels: [[1, 1]], startSample: 5 },
  ];
  for (const law of ['constant-power', 'linear']) {
    const result = mix(clips, { channelCount: 2, panLaw: law });
    assert.equal(result.length, 7);
    const expected = reference(clips, 2, 7, law);
    for (let c = 0; c < 2; c++)
      for (let i = 0; i < 7; i++) near(result.channels[c][i], expected[c][i]);
  }
});

test('multichannel without pan sums per channel; mono spreads to every channel', () => {
  const result = mix(
    [
      { channels: [[1, 1]], startSample: 0, gain: 0.5 },
      {
        channels: [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
        startSample: 1,
      },
    ],
    { channelCount: 3 },
  );
  assert.deepEqual(
    result.channels.map((c) => Array.from(c)),
    [
      [0.5, 1.5, 2],
      [0.5, 3.5, 4],
      [0.5, 5.5, 6],
    ],
  );
});

test('pan law identities', () => {
  const [l, r] = panGains(0, 'constant-power', 1);
  near(l, Math.SQRT1_2);
  near(r, Math.SQRT1_2);
  assert.deepEqual(panGains(0, 'linear', 1), [0.5, 0.5]);
  assert.deepEqual(panGains(0, 'constant-power', 2), [1, 1]);
  near(panGains(1, 'constant-power', 2)[0], 0, 1e-12);
  assert.deepEqual(panGains(-1, 'linear', 2), [1, 0]);
  for (const p of [-1, -0.3, 0.8]) {
    const [a, b] = panGains(p, 'constant-power', 1);
    near(a * a + b * b, 1);
  }
});

test('truncation, overlap, peak and clip accounting', () => {
  const clips = [
    { channels: [[0.9, 0.9, 0.9]], startSample: 0 },
    { channels: [[0.9, 0.9, 0.9]], startSample: 1 },
  ];
  const raw = mix(clips, { channelCount: 1, length: 3 });
  near(raw.peak, 1.8);
  assert.equal(raw.clippedSamples, 2);
  near(raw.channels[0][1], 1.8);
  const hard = mix(clips, { channelCount: 1, clipMode: 'hard' });
  assert.equal(hard.length, 4);
  assert.equal(Math.max(...hard.channels[0]), 1);
  assert.equal(mix(clips, { channelCount: 1, length: 2 }).length, 2);
});

test('outputs are owned and inputs are not mutated', () => {
  const data = new Float32Array([0.25, 0.5]);
  const clip = { channels: [data], startSample: 0 };
  const a = mix([clip], { channelCount: 1 });
  a.channels[0][0] = 9;
  assert.deepEqual(Array.from(data), [0.25, 0.5]);
  assert.equal(mix([clip], { channelCount: 1 }).channels[0][0], 0.25);
  assert.notEqual(a.channels[0].buffer, data.buffer);
});
