self.onmessage = function(e){
  const {image, options} = e.data;
  const width = image.width;
  const height = image.height;
  const buffer = image.buffer || image.data || null;
  if (!buffer){
    postMessage({ascii:'', cols:0, rows:0});
    return;
  }
  const data = new Uint8ClampedArray(buffer);
  const ramp = (options && options.ramp) ? options.ramp : '@%#*+=-:. ';
  const cols = Math.max(1, options.columns || 80);
  const fontRatio = options.fontRatio || 0.6;
  const quality = options.quality || 'fast';

  const cellW = Math.max(1, Math.floor(width / cols));
  const cellHFloat = cellW / Math.max(0.1, fontRatio);
  const cellH = Math.max(1, Math.floor(cellHFloat));
  const rows = Math.max(1, Math.floor(height / cellH));

  let out = [];
  for (let r=0;r<rows;r++){
    let line = '';
    const startY = r * cellH;
    for (let c=0;c<cols;c++){
      const startX = c * cellW;
      const endX = Math.min(width, startX + cellW);
      const endY = Math.min(height, startY + cellH);

      let lum = 0;
      if (quality === 'fast'){
        const cx = Math.floor((startX + endX) / 2);
        const cy = Math.floor((startY + endY) / 2);
        const idx = (cy * width + cx) * 4;
        const rC = data[idx], gC = data[idx+1], bC = data[idx+2];
        lum = 0.2126 * rC + 0.7152 * gC + 0.0722 * bC;
      } else {
        let sum = 0, count = 0;
        const step = Math.max(1, Math.floor(Math.min(endX-startX, endY-startY) / 2));
        for (let yy = startY; yy < endY; yy += step){
          for (let xx = startX; xx < endX; xx += step){
            const idx = (yy * width + xx) * 4;
            const rC = data[idx], gC = data[idx+1], bC = data[idx+2];
            sum += 0.2126 * rC + 0.7152 * gC + 0.0722 * bC;
            count++;
          }
        }
        lum = count ? (sum / count) : 0;
      }

      const t = 1 - (lum / 255);
      const ri = Math.max(0, Math.min(ramp.length - 1, Math.floor(t * (ramp.length - 1))));
      line += ramp.charAt(ri);
    }
    out.push(line);
  }

  postMessage({ascii: out.join('\n'), cols, rows});
};
