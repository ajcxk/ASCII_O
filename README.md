# ASCII Art Converter (Client-side)

This is a single-page client-side app that converts uploaded images into ASCII art. It supports raw ASCII text output and exporting the ASCII rendered onto a black JPEG.

Quick start (recommended):

1. Run a local static server in this folder (recommended for consistent font loading):

```bash
python -m http.server 8000
```

2. Open http://localhost:8000 in your browser and use the UI.

Notes:
- The app looks for an embedded monospace font at `assets/fonts/DejaVuSansMono.ttf`. If you want perfectly consistent exported images, place a `.ttf` at that location. If the font is missing, the browser fallback monospace font will be used.
- The UI includes a Quality toggle (`Fast` uses center-pixel sampling; `High` averages pixels for better fidelity).
- Use the `Ramp` selector to try different character ramps. Choose `Custom` to enter your own ramp string.

New features:
- Optional dithering (Floyd–Steinberg) to preserve texture and detail for photographic images. Toggle `Dither` in the UI.
- PNG export and adjustable JPEG quality slider for smaller or higher-quality JPEG outputs.
- Explicit progress indicator and cancel button for better handling of large images. Very large images are automatically downscaled to avoid memory issues.

If you want immediate consistent output across machines, drop `DejaVuSansMono.ttf` into `assets/fonts/`.

Files added:
- `index.html` — main UI
- `static/style.css` — styles and font-face
- `static/app.js` — main UI & logic
- `static/worker.js` — Web Worker for conversion
- `assets/fonts/README.txt` — instructions for adding a local font
