#!/usr/bin/env python3
"""Build four original crystal-facet Android launcher icons.

The prism artwork is original vector geometry, not a copy of a brand or supplied
artwork. It generates Settings previews, adaptive foreground/background layers,
monochrome masks, and fixed Cream Champagne Gold default/round icons.
Requires Pillow, NumPy, and CairoSVG.
Run from any directory: python3 scripts/build_icon_assets.py
"""
from io import BytesIO
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
import cairosvg

ROOT = Path(__file__).resolve().parents[1]
ARTWORK_DIR = ROOT / "scripts" / "icon-artwork-source"
RES = ROOT / "app" / "src" / "main" / "res"
PREVIEW_DIR = ROOT / "app" / "src" / "main" / "assets" / "icons"
SIZE = 432
SOURCE_SIZE = 1024
PREVIEW_SIZE = 320
# Keep the crystal within the adaptive-icon center mask-safe area.
ART_SCALE = 0.70

# Backgrounds and facet stops remain within their named palette family.
PALETTES = {
    "cream": {
        "background": ("#E9D9B5", "#F4E8CA", "#FCF7EB", "#FFFDF7"),
        "edge": "#FFF9E8",
        "edge_shadow": "#A8792F",
        "shadow": "#684A22",
        "facet_top_left": ("#FFF8E7", "#EBD59A", "#C99D4A", "#F8E8BE"),
        "facet_top_right": ("#FFF4D6", "#DAB86E", "#F7E6BB", "#B98532"),
        "facet_left": ("#F8E7B8", "#D0A64F", "#F9E9C0", "#B78736"),
        "facet_right": ("#FFF7E2", "#E4C77F", "#C18E3B", "#F5E2B1"),
        "facet_bottom_left": ("#C49139", "#F1D996", "#FFF2D2", "#C9953F"),
        "facet_bottom_right": ("#F9E8BC", "#D2A44B", "#F5DFA8", "#A9772E"),
        "shine": "#FFFDF4",
        "accent_facet": None,
    },
    "glacier": {
        "background": ("#8FC8E5", "#C5E5F3", "#F1FAFF", "#FFFFFF"),
        "edge": "#F5FCFF",
        "edge_shadow": "#4B91BA",
        "shadow": "#315C7A",
        "facet_top_left": ("#F4FCFF", "#B7E3F4", "#72BFDF", "#DDF6FF"),
        "facet_top_right": ("#EAF9FF", "#83C8E8", "#C7EDFA", "#5AA8D0"),
        "facet_left": ("#BEEAFA", "#65B6D9", "#E2F8FF", "#4A9CC5"),
        "facet_right": ("#F3FCFF", "#A5DDF1", "#59A9D2", "#D1F1FC"),
        "facet_bottom_left": ("#5DA9D1", "#A6DDF0", "#F2FCFF", "#6CB7D9"),
        "facet_bottom_right": ("#E7F8FF", "#78BEDF", "#BCE7F5", "#498DB9"),
        "shine": "#FFFFFF",
        "accent_facet": None,
    },
    "cherry": {
        "background": ("#E5A6B8", "#F1CCD4", "#FFF2F5", "#FFFCFD"),
        "edge": "#FFF7F8",
        "edge_shadow": "#B7627D",
        "shadow": "#74404F",
        "facet_top_left": ("#FFF7F8", "#F4C7D2", "#DE8DA5", "#FBE0E7"),
        "facet_top_right": ("#FFF1F4", "#E995AC", "#F7D1DA", "#C96783"),
        "facet_left": ("#F7D4DC", "#D77794", "#FFF0F3", "#BC5A79"),
        "facet_right": ("#FFF8F9", "#F0B6C5", "#C96482", "#F7DCE2"),
        "facet_bottom_left": ("#C75F7E", "#EBA3B5", "#FFF2F5", "#D16F8A"),
        "facet_bottom_right": ("#FDE8EC", "#D9859D", "#F3C3CF", "#B95172"),
        "shine": "#FFFBFC",
        "accent_facet": None,
    },
    "bluegold": {
        "background": ("#082A68", "#10458F", "#225FAE", "#4A7CC0"),
        "edge": "#B9D9FF",
        "edge_shadow": "#071C4A",
        "shadow": "#061638",
        "facet_top_left": ("#E6F2FF", "#76B8F0", "#2D72C1", "#B5D8FF"),
        "facet_top_right": ("#BFE3FF", "#3F8DDB", "#8FC6FF", "#1558A7"),
        "facet_left": ("#7EB8ED", "#1D64B1", "#A9D2FF", "#0B448D"),
        "facet_right": ("#D6ECFF", "#5B9FDF", "#1257A6", "#9AC9FA"),
        "facet_bottom_left": ("#124F9C", "#4D91D4", "#C1E0FF", "#276BB5"),
        "facet_bottom_right": ("#9BCBFB", "#347BC5", "#73A8E1", "#0B3C80"),
        "shine": "#EDF7FF",
        "accent_facet": ("#FFD976", "#F0B946", "#D88C20", "#FFF0B5"),
    },
}


def rgb(hex_color):
    return tuple(int(hex_color[i:i + 2], 16) for i in (1, 3, 5))


def make_gradient(size, colors):
    start, middle, end, glow = [np.array(rgb(c), dtype=np.float32) for c in colors]
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    t = (xx + yy) / max(1, 2 * (size - 1))
    first = np.clip(t * 2, 0, 1)[..., None]
    second = np.clip((t - 0.5) * 2, 0, 1)[..., None]
    linear = start * (1 - first) + middle * first
    linear = np.where((t <= 0.5)[..., None], linear, middle * (1 - second) + end * second)
    radius = np.sqrt(((xx - (size - 1) / 2) / size) ** 2 + ((yy - (size - 1) / 2) / size) ** 2)
    halo = (0.17 * np.exp(-(radius ** 2) / 0.075))[..., None]
    pixels = np.clip(linear * (1 - halo) + glow * halo, 0, 255).astype(np.uint8)
    return Image.fromarray(pixels, "RGB").convert("RGBA")


def svg_gradient(name, colors, opacity=None):
    stops = []
    for index, color in enumerate(colors):
        offset = index * 100 / (len(colors) - 1)
        alpha = f' stop-opacity="{opacity[index]}"' if opacity else ""
        stops.append(f'<stop offset="{offset:.0f}%" stop-color="{color}"{alpha}/>')
    return (
        f'<linearGradient id="{name}" x1="0" y1="0" x2="1" y2="1">'
        f'{"".join(stops)}</linearGradient>'
    )


def build_prism_svg(name, palette):
    gradient_ids = (
        "facet_top_left", "facet_top_right", "facet_left", "facet_right",
        "facet_bottom_left", "facet_bottom_right",
    )
    gradients = [svg_gradient(key, palette[key]) for key in gradient_ids]
    gradients.append(svg_gradient("accent_facet", palette["accent_facet"] or palette["facet_bottom_right"]))
    accent = ""
    if palette["accent_facet"]:
        accent = '''
    <path d="M575 540 L704 666 L620 772 L548 646 Z" fill="url(#accent_facet)" stroke="%s" stroke-width="5" stroke-linejoin="round"/>
    <path d="M585 557 L614 583 L583 631 Z" fill="#FFF7D9" fill-opacity=".74"/>
''' % palette["edge"]

    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{SOURCE_SIZE}" height="{SOURCE_SIZE}" viewBox="0 0 1024 1024">
  <defs>
    {''.join(gradients)}
    <linearGradient id="edgeLight" x1="0" y1="0" x2="1" y2="1"><stop stop-color="{palette['edge']}" stop-opacity=".96"/><stop offset=".52" stop-color="{palette['shine']}" stop-opacity=".52"/><stop offset="1" stop-color="{palette['edge_shadow']}" stop-opacity=".82"/></linearGradient>
    <radialGradient id="aura"><stop stop-color="{palette['edge']}" stop-opacity=".28"/><stop offset="1" stop-color="{palette['edge']}" stop-opacity="0"/></radialGradient>
    <filter id="crystalShadow" x="-30%" y="-20%" width="160%" height="160%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="14" result="blur"/><feOffset dy="17" result="offset"/><feComponentTransfer><feFuncA type="linear" slope=".24"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="softGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="15"/></filter>
  </defs>
  <ellipse cx="512" cy="510" rx="310" ry="390" fill="url(#aura)" filter="url(#softGlow)"/>
  <ellipse cx="512" cy="855" rx="184" ry="28" fill="{palette['shadow']}" fill-opacity=".22" filter="url(#softGlow)"/>
  <g filter="url(#crystalShadow)">
    <path d="M512 142 L744 278 L744 704 L512 882 L280 704 L280 278 Z" fill="url(#facet_top_left)" stroke="url(#edgeLight)" stroke-width="18" stroke-linejoin="round"/>
    <path d="M512 142 L280 278 L512 476 Z" fill="url(#facet_top_left)"/>
    <path d="M512 142 L744 278 L603 484 L512 476 Z" fill="url(#facet_top_right)"/>
    <path d="M280 278 L512 476 L280 704 Z" fill="url(#facet_left)"/>
    <path d="M744 278 L744 704 L603 484 L512 476 Z" fill="url(#facet_right)"/>
    <path d="M280 704 L512 476 L512 882 Z" fill="url(#facet_bottom_left)"/>
    <path d="M512 476 L744 704 L512 882 Z" fill="url(#facet_bottom_right)"/>
    {accent}
    <path d="M512 142 L512 882 M280 278 L512 476 L744 278 M280 704 L512 476 L744 704 M603 484 L512 882" fill="none" stroke="{palette['edge']}" stroke-opacity=".60" stroke-width="6" stroke-linejoin="round"/>
    <path d="M512 157 L300 283 L300 674" fill="none" stroke="{palette['shine']}" stroke-opacity=".82" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M532 167 L726 284 L726 533" fill="none" stroke="{palette['shine']}" stroke-opacity=".58" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M300 702 L512 864 L721 702" fill="none" stroke="{palette['edge']}" stroke-opacity=".42" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M337 309 L476 225 L476 419 L338 548 Z" fill="{palette['shine']}" fill-opacity=".18"/>
    <path d="M677 319 L716 344 L716 468 L640 550 L615 506 Z" fill="{palette['shine']}" fill-opacity=".17"/>
  </g>
</svg>'''


def prepare_foreground(svg_path):
    rendered = cairosvg.svg2png(url=str(svg_path), output_width=SOURCE_SIZE, output_height=SOURCE_SIZE)
    source = Image.open(BytesIO(rendered)).convert("RGBA")
    alpha = source.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value >= 12 else 0).getbbox()
    if not bbox:
        raise ValueError(f"No visible prism in {svg_path}")
    subject = source.crop(bbox)
    subject.thumbnail((round(SIZE * ART_SCALE), round(SIZE * ART_SCALE)), Image.Resampling.LANCZOS)
    foreground = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    foreground.alpha_composite(subject, ((SIZE - subject.width) // 2, (SIZE - subject.height) // 2))
    return foreground


def write_resource_xml(name, colors):
    start, middle, end, _ = colors
    bg_xml = f'''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <gradient android:type="linear" android:angle="45" android:startColor="{start}" android:centerColor="{middle}" android:endColor="{end}" android:centerX="0.5" android:centerY="0.5" android:useLevel="false" />
</shape>
'''
    (RES / "drawable" / f"icon_bg_{name}.xml").write_text(bg_xml, encoding="utf-8")
    adaptive = f'''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/icon_bg_{name}" />
    <foreground android:drawable="@drawable/icon_fg_{name}" />
    <monochrome android:drawable="@drawable/icon_mono_{name}" />
</adaptive-icon>
'''
    (RES / "mipmap-anydpi-v26" / f"ic_launcher_{name}.xml").write_text(adaptive, encoding="utf-8")
    if name == "cream":
        (RES / "mipmap-anydpi-v26" / "ic_launcher_cream_round.xml").write_text(adaptive, encoding="utf-8")


def make_round_icon(icon):
    rounded = icon.copy()
    mask = Image.new("L", icon.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, icon.width - 1, icon.height - 1), fill=255)
    rounded.putalpha(mask)
    return rounded


def build_one(name, palette, foreground):
    colors = palette["background"]
    mono = Image.new("RGBA", foreground.size, (255, 255, 255, 0))
    mono.putalpha(foreground.getchannel("A"))
    mono.save(RES / "drawable-nodpi" / f"icon_mono_{name}.png", optimize=True)

    icon = Image.alpha_composite(make_gradient(SIZE, colors), foreground)
    icon.save(RES / "mipmap-nodpi" / f"ic_launcher_{name}.png", optimize=True)
    icon.save(RES / "drawable-nodpi" / f"icon_{name}.png", optimize=True)
    icon.resize((PREVIEW_SIZE, PREVIEW_SIZE), Image.Resampling.LANCZOS).save(
        PREVIEW_DIR / f"icon_{name}.png", optimize=True
    )
    if name == "cream":
        make_round_icon(icon).save(RES / "mipmap-nodpi" / "ic_launcher_cream_round.png", optimize=True)
    write_resource_xml(name, colors)
    print(f"Built {name}: original faceted prism, adaptive layers, monochrome mask, preview")


def main():
    for directory in (ARTWORK_DIR, PREVIEW_DIR, RES / "drawable", RES / "drawable-nodpi",
                      RES / "mipmap-anydpi-v26", RES / "mipmap-nodpi"):
        directory.mkdir(parents=True, exist_ok=True)
    for name, palette in PALETTES.items():
        svg_path = ARTWORK_DIR / f"{name}_prism.svg"
        svg_path.write_text(build_prism_svg(name, palette), encoding="utf-8")
        foreground = prepare_foreground(svg_path)
        foreground.save(RES / "drawable-nodpi" / f"icon_fg_{name}.png", optimize=True)
        build_one(name, palette, foreground)
    print("Fixed Cream Champagne Gold default and round icons regenerated; four launcher aliases remain selectable.")


if __name__ == "__main__":
    main()
