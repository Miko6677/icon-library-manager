const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let exactDrawArgs = null;
const pixelContext = {
  drawImage: (...args) => { exactDrawArgs = args; },
  getImageData: () => ({ data: new Uint8ClampedArray([42, 76, 110, 255]) })
};
const context = { window: {}, document: {
  createElement: (name) => {
    assert.equal(name, 'canvas');
    return { width: 0, height: 0, getContext: () => pixelContext };
  }
} };
vm.runInNewContext(
  fs.readFileSync('app/src/main/assets/accent-color.js', 'utf8'),
  context,
  { filename: 'accent-color.js' },
);
const colors = context.window.CueAccentColor;
assert.ok(colors, 'accent color module should export its functions');
assert.equal(typeof colors.sampleExactPixel, 'function', 'the image eyedropper should export an exact-pixel sampler');

function imageData(width, height, colorAt) {
  const bytes = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      bytes.set(colorAt(x, y), offset);
    }
  }
  return bytes;
}

function channels(hex) {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function hue(hex) {
  const [r8, g8, b8] = channels(hex);
  const [r, g, b] = [r8, g8, b8].map((value) => value / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (!delta) return 0;
  let result;
  if (max === r) result = ((g - b) / delta) % 6;
  else if (max === g) result = (b - r) / delta + 2;
  else result = (r - g) / delta + 4;
  return (result * 60 + 360) % 360;
}

// Neutral pixels should not drown out the dominant colored subject/background.
const roseAndGray = imageData(100, 30, (x) => (x < 38 ? [190, 83, 116, 255] : [222, 222, 222, 255]));
const rose = colors.extractDominantAccent(roseAndGray, 100, 30);
assert.ok(rose, 'a clear rose region should be extracted');
assert.ok(Math.abs(hue(rose) - hue('#be5374')) < 12, `expected rose hue, got ${rose}`);

// The largest color family wins even when a smaller region is more saturated.
const blueAndOrange = imageData(50, 20, (x) => (x < 35 ? [95, 126, 171, 255] : [244, 92, 31, 255]));
const blue = colors.extractDominantAccent(blueAndOrange, 50, 20);
assert.ok(Math.abs(hue(blue) - hue('#5f7eab')) < 12, `expected dominant blue, got ${blue}`);

// Transparent pixels and monochrome images should not generate false accents.
const transparentRed = imageData(16, 16, () => [245, 20, 30, 0]);
const visibleBlue = imageData(16, 16, () => [79, 115, 164, 255]);
const transparencyCase = new Uint8ClampedArray(transparentRed.length);
for (let i = 0; i < transparencyCase.length; i += 4) {
  const x = (i / 4) % 16;
  transparencyCase.set(x < 8 ? transparentRed.slice(i, i + 4) : visibleBlue.slice(i, i + 4), i);
}
const transparentResult = colors.extractDominantAccent(transparencyCase, 16, 16);
assert.ok(Math.abs(hue(transparentResult) - hue('#4f73a4')) < 12, `transparent red must be ignored, got ${transparentResult}`);
const monochrome = imageData(12, 12, () => [136, 136, 136, 255]);
assert.equal(colors.extractDominantAccent(monochrome, 12, 12), null, 'monochrome images should not be reported as a sampled color');

const sampledPixel = colors.sampleExactPixel({ naturalWidth: 20, naturalHeight: 10 }, 6, 4);
assert.equal(sampledPixel, '#2a4c6e', 'the eyedropper should return the exact selected source pixel');
assert.deepEqual(Array.from(exactDrawArgs.slice(1)), [6, 4, 1, 1, 0, 0, 1, 1], 'the sampler should draw precisely a one-pixel source rectangle');
assert.equal(colors.sampleExactPixel({ naturalWidth: 2, naturalHeight: 2 }, 2, 0), null, 'out-of-bounds pixels should be rejected');

// Theme adjustment must preserve hue while only changing the lightness needed for readability.
const source = '#b85f78';
const light = colors.customAccentVariants(source, false);
const dark = colors.customAccentVariants(source, true);
assert.ok(Math.abs(hue(light.primary) - hue(source)) < 3, 'light variant should retain the sampled hue');
assert.ok(Math.abs(hue(dark.primary) - hue(source)) < 3, 'dark variant should retain the sampled hue');
assert.ok(light.primary !== source && dark.primary !== source, 'theme variants should adjust contrast');
assert.equal(colors.customAccentVariants('invalid', false), null, 'invalid hex values should be rejected');

console.log('Accent color tests passed.');
