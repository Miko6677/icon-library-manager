(() => {
  'use strict';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const lightness = (max + min) / 2;
    let hue = 0;
    let saturation = 0;
    if (delta > 0) {
      saturation = delta / (1 - Math.abs(2 * lightness - 1));
      if (max === r) hue = ((g - b) / delta) % 6;
      else if (max === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue = (hue * 60 + 360) % 360;
    }
    return [hue, saturation, lightness];
  }

  function hslToHex(hue, saturation, lightness) {
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
    const m = lightness - chroma / 2;
    let rgb;
    if (hue < 60) rgb = [chroma, x, 0];
    else if (hue < 120) rgb = [x, chroma, 0];
    else if (hue < 180) rgb = [0, chroma, x];
    else if (hue < 240) rgb = [0, x, chroma];
    else if (hue < 300) rgb = [x, 0, chroma];
    else rgb = [chroma, 0, x];
    return `#${rgb.map((value) => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('')}`;
  }

  function srgbToLinear(value) {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  }

  function linearToSrgb(value) {
    const bounded = clamp(value, 0, 1);
    const encoded = bounded <= 0.0031308 ? bounded * 12.92 : 1.055 * (bounded ** (1 / 2.4)) - 0.055;
    return Math.round(encoded * 255);
  }

  function extractDominantAccent(imageData, width, height) {
    if (!imageData || !imageData.length || !Number.isFinite(width) || !Number.isFinite(height)
        || width < 1 || height < 1 || imageData.length < width * height * 4) return null;

    const buckets = new Map();
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      const alpha = imageData[offset + 3] / 255;
      if (alpha < 0.55) continue;

      const r = imageData[offset];
      const g = imageData[offset + 1];
      const b = imageData[offset + 2];
      const [hue, saturation, lightness] = rgbToHsl(r, g, b);
      // Ignore near-black, near-white and near-neutral pixels: they dominate many
      // photos but rarely make a useful or recognizable interface accent.
      if (saturation < 0.09 || lightness < 0.07 || lightness > 0.96) continue;

      // Fairly broad perceptual buckets keep nearby shades from splitting a
      // single dominant color into many tiny RGB-only groups.
      const hueBin = Math.floor(hue / 18);
      const saturationBin = Math.min(4, Math.floor(saturation / 0.2));
      const lightnessBin = Math.min(7, Math.floor(lightness / 0.125));
      const key = `${hueBin}:${saturationBin}:${lightnessBin}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { weight: 0, r: 0, g: 0, b: 0 };
        buckets.set(key, bucket);
      }

      const weight = alpha * (0.88 + Math.min(saturation, 0.8) * 0.15);
      bucket.weight += weight;
      bucket.r += srgbToLinear(r) * weight;
      bucket.g += srgbToLinear(g) * weight;
      bucket.b += srgbToLinear(b) * weight;
    }

    let chosen = null;
    for (const bucket of buckets.values()) {
      if (!chosen || bucket.weight > chosen.weight) chosen = bucket;
    }
    if (!chosen || chosen.weight <= 0) return null;

    const channels = [chosen.r, chosen.g, chosen.b]
      .map((value) => linearToSrgb(value / chosen.weight));
    return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  }

  function customAccentVariants(hex, dark) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return null;
    const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
    const [hue, sourceSaturation, sourceLightness] = rgbToHsl(...channels);
    // Preserve the sampled hue and most of its saturation. Only nudge very pale
    // colors slightly, and constrain lightness so interactive controls remain legible.
    const saturation = clamp(sourceSaturation, 0.12, 0.76);
    const primaryLightness = dark
      ? clamp(sourceLightness, 0.62, 0.76)
      : clamp(sourceLightness, 0.38, 0.48);
    const darkLightness = dark
      ? clamp(primaryLightness - 0.14, 0.48, 0.64)
      : clamp(primaryLightness - 0.11, 0.27, 0.39);
    const lightLightness = dark
      ? clamp(primaryLightness + 0.10, 0.72, 0.88)
      : clamp(primaryLightness + 0.18, 0.58, 0.76);
    return {
      primary: hslToHex(hue, saturation, primaryLightness),
      primaryDark: hslToHex(hue, saturation, darkLightness),
      primaryLight: hslToHex(hue, saturation, lightLightness),
      primaryOnDark: hslToHex(hue, saturation, clamp(sourceLightness, 0.66, 0.78))
    };
  }

  function sampleExactPixel(image, x, y) {
    if (!image || !Number.isInteger(x) || !Number.isInteger(y)
        || !image.naturalWidth || !image.naturalHeight
        || x < 0 || y < 0 || x >= image.naturalWidth || y >= image.naturalHeight) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      if (pixel[3] < 128) return null;
      return `#${[pixel[0], pixel[1], pixel[2]].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
    } catch {
      return null;
    }
  }

  window.CueAccentColor = { extractDominantAccent, customAccentVariants, sampleExactPixel };
})();
