self.onmessage = function(e){
  const msg = e.data || {};
  if (msg.type !== 'convert') return;
  const { image, options } = msg;
  const width = image.width;
  const height = image.height;
  const buffer = image.buffer || image.data || null;
  if (!buffer){
    postMessage({type:'result', ascii:'', cols:0, rows:0});
    return;
  }
  const data = new Uint8ClampedArray(buffer);
  const ramp = (options && options.ramp) ? options.ramp : '@%#*+=-:. ';
  const cols = Math.max(1, options.columns || 80);
  const fontRatio = options.fontRatio || 0.6;
  const quality = options.quality || 'fast';
  const dither = !!options.dither;

  const cellW = Math.max(1, Math.floor(width / cols));
  const cellHFloat = cellW / Math.max(0.1, fontRatio);
  const cellH = Math.max(1, Math.floor(cellHFloat));
  const rows = Math.max(1, Math.floor(height / cellH));

  // Build grayscale luminance array
  const lum = new Float64Array(width * height);
  for (let y = 0; y < height; y++){
    for (let x = 0; x < width; x++){
      const i = (y * width + x) * 4;
      const rC = data[i], gC = data[i+1], bC = data[i+2];
      lum[y * width + x] = 0.2126 * rC + 0.7152 * gC + 0.0722 * bC;
    }
  }

  // Optional Floyd–Steinberg dithering on grayscale
  function clamp(v){ return Math.max(0, Math.min(255, v)); }
  if (dither){
    const levels = Math.max(2, ramp.length);
    const scale = 255 / (levels - 1);
    for (let y = 0; y < height; y++){
      for (let x = 0; x < width; x++){
        const idx = y * width + x;
        const oldVal = lum[idx];
        const quant = Math.round(oldVal / scale) * scale;
        const err = oldVal - quant;
        lum[idx] = quant;
        if (x + 1 < width) lum[idx + 1] = clamp(lum[idx + 1] + err * 7/16);
        if (x - 1 >= 0 && y + 1 < height) lum[(y + 1) * width + (x - 1)] = clamp(lum[(y + 1) * width + (x - 1)] + err * 3/16);
        if (y + 1 < height) lum[(y + 1) * width + x] = clamp(lum[(y + 1) * width + x] + err * 5/16);
        if (x + 1 < width && y + 1 < height) lum[(y + 1) * width + (x + 1)] = clamp(lum[(y + 1) * width + (x + 1)] + err * 1/16);
      }
    }
  }

  // Sample cells and build ASCII lines with progress updates
  const out = [];
  const progressStep = Math.max(1, Math.floor(rows / 100));
  for (let r = 0; r < rows; r++){
    let line = '';
    const startY = r * cellH;
    for (let c = 0; c < cols; c++){
      const startX = c * cellW;
      const endX = Math.min(width, startX + cellW);
      const endY = Math.min(height, startY + cellH);

      let lumVal = 0;
      if (quality === 'fast'){
        const cx = Math.floor((startX + endX) / 2);
        const cy = Math.floor((startY + endY) / 2);
        lumVal = lum[cy * width + cx];
      } else {
        let sum = 0, count = 0;
        const step = Math.max(1, Math.floor(Math.min(endX - startX, endY - startY) / 2));
        for (let yy = startY; yy < endY; yy += step){
          for (let xx = startX; xx < endX; xx += step){
            sum += lum[yy * width + xx];
            count++;
          }
        }
        lumVal = count ? (sum / count) : 0;
      }

      const t = 1 - (lumVal / 255);
      const ri = Math.max(0, Math.min(ramp.length - 1, Math.floor(t * (ramp.length - 1))));
      line += ramp.charAt(ri);
    }
    out.push(line);
    if (r % progressStep === 0){
      const progress = Math.round((r / rows) * 100);
      self.postMessage({type:'progress', progress, rowsProcessed: r, totalRows: rows});
    }
  }

  self.postMessage({type:'result', ascii: out.join('\n'), cols, rows});
};
