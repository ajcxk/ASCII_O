const RAMPS = {
  simple: ' .:-=+*#%@',
  detailed: '@%#*+=-:. ',
  dense: '$@B%8&WM#*oahkbdpqwmZ0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,.'
};

const $ = id => document.getElementById(id);

const fileInput = $('file-input');
const dropArea = $('drop-area');
const btnSelect = $('btn-select');
const btnConvert = $('btn-convert');
const btnDownloadTxt = $('btn-download-txt');
const btnDownloadJpeg = $('btn-download-jpeg');
const btnDownloadPng = $('btn-download-png');
const btnCancel = $('btn-cancel');
const asciiOutput = $('ascii-output');
const renderedPreview = $('rendered-preview');
const sourceCanvas = $('source-canvas');
const widthRange = $('width-range');
const widthValue = $('width-value');
const widthAuto = $('width-auto');
const qualitySelect = $('quality');
const rampSelect = $('ramp-select');
const customRamp = $('custom-ramp');
const fontSizeInput = $('font-size');
const ditherCheckbox = $('dither');
const progressEl = $('progress');
const progressText = $('progress-text');
const jpegQuality = $('jpeg-quality');
const jpegQualityValue = $('jpeg-quality-value');

let currentWorker = null;
let lastRenderCanvas = null;

const MAX_PIXELS = 8000000; // ~8MP cap for memory/time safety

function measureFontWidth(fontSize){
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `${fontSize}px DejaVuSansMonoLocal, monospace`;
  ctx.font = font;
  const m = ctx.measureText('M');
  return m.width || (fontSize * 0.6);
}

function computeColumns(imgWidth, fontSize){
  if (widthAuto.checked){
    const approxChar = measureFontWidth(fontSize);
    let cols = Math.floor(imgWidth / Math.max(1, Math.round(approxChar)));
    cols = Math.max(20, Math.min(200, cols));
    return cols;
  }
  return parseInt(widthRange.value, 10) || 80;
}

function updateProgress(pct, text){
  progressEl.value = pct;
  progressText.textContent = text || `${pct}%`;
}

function handleFile(file){
  if (!file || !file.type.startsWith('image/')){
    alert('Please select an image file.');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => processImage(img);
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function processImage(img){
  const fontSize = parseInt(fontSizeInput.value, 10) || 12;

  // Downscale very large images to avoid OOM and long processing
  let srcW = img.naturalWidth || img.width;
  let srcH = img.naturalHeight || img.height;
  const pixelCount = srcW * srcH;
  let scale = 1;
  if (pixelCount > MAX_PIXELS){
    scale = Math.sqrt(MAX_PIXELS / pixelCount);
  }
  const drawW = Math.max(1, Math.floor(srcW * scale));
  const drawH = Math.max(1, Math.floor(srcH * scale));

  sourceCanvas.width = drawW;
  sourceCanvas.height = drawH;
  const ctx = sourceCanvas.getContext('2d');
  ctx.clearRect(0,0,drawW, drawH);
  ctx.drawImage(img, 0, 0, drawW, drawH);

  let imageData;
  try{
    imageData = ctx.getImageData(0,0,drawW, drawH);
  }catch(err){
    alert('Unable to access image pixels (CORS?). Try running via a local server.');
    return;
  }

  const ramp = (rampSelect.value === 'custom' && customRamp.value.trim()) ? customRamp.value : (RAMPS[rampSelect.value] || RAMPS.detailed);
  const fontWidth = measureFontWidth(fontSize);
  const fontRatio = fontWidth / fontSize;
  const options = {columns: computeColumns(drawW, fontSize), quality: qualitySelect.value, ramp, fontRatio, dither: !!ditherCheckbox.checked};

  // Cancel any running worker
  if (currentWorker){
    try{ currentWorker.terminate(); }catch(e){}
    currentWorker = null;
  }

  asciiOutput.textContent = 'Converting...';
  updateProgress(0,'Starting');
  btnConvert.disabled = true;
  btnCancel.disabled = false;

  const worker = new Worker('static/worker.js');
  currentWorker = worker;

  worker.onmessage = e => {
    const data = e.data;
    if (!data) return;
    if (data.type === 'progress'){
      updateProgress(data.progress, `Row ${data.rowsProcessed} / ${data.totalRows}`);
      return;
    }
    // result
    if (data.type === 'result' || data.ascii){
      const ascii = data.ascii || data;
      asciiOutput.textContent = ascii;
      btnDownloadTxt.disabled = false;
      btnDownloadJpeg.disabled = false;
      btnDownloadPng.disabled = false;
      renderAsciiToCanvas(ascii, data.cols, data.rows, parseInt(jpegQuality.value,10)/100);
      updateProgress(100,'Done');
      btnConvert.disabled = false;
      btnCancel.disabled = true;
      currentWorker = null;
    }
  };

  worker.onerror = err => {
    console.error('Worker error', err);
    asciiOutput.textContent = 'Conversion error';
    updateProgress(0,'Error');
    btnConvert.disabled = false;
    btnCancel.disabled = true;
    currentWorker = null;
  };

  // Transfer pixel buffer to worker
  try{
    worker.postMessage({type:'convert', image:{width:imageData.width, height:imageData.height, buffer:imageData.data.buffer}, options}, [imageData.data.buffer]);
  }catch(ex){
    // If transfer fails, try without transfer
    try{
      worker.postMessage({type:'convert', image:{width:imageData.width, height:imageData.height, data:imageData.data}, options});
    }catch(err){
      // If worker posting also fails, fallback to main-thread conversion
      console.warn('Worker posting failed, falling back to main-thread conversion.', err);
      try{
        mainThreadConvert(imageData, options);
      }catch(inner){
        console.error('Main-thread conversion also failed', inner);
        asciiOutput.textContent = 'Conversion failed';
        updateProgress(0,'Error');
        btnConvert.disabled = false;
        btnCancel.disabled = true;
      }
    }
  }
}

// Fallback conversion on the main thread (same algorithm as worker)
function mainThreadConvert(imageData, options){
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const ramp = (options && options.ramp) ? options.ramp : '@%#*+=-:. ';
  const cols = Math.max(1, options.columns || 80);
  const fontRatio = options.fontRatio || 0.6;
  const quality = options.quality || 'fast';
  const dither = !!options.dither;

  const cellW = Math.max(1, Math.floor(width / cols));
  const cellHFloat = cellW / Math.max(0.1, fontRatio);
  const cellH = Math.max(1, Math.floor(cellHFloat));
  const rows = Math.max(1, Math.floor(height / cellH));

  const lum = new Float64Array(width * height);
  for (let y = 0; y < height; y++){
    for (let x = 0; x < width; x++){
      const i = (y * width + x) * 4;
      const rC = data[i], gC = data[i+1], bC = data[i+2];
      lum[y * width + x] = 0.2126 * rC + 0.7152 * gC + 0.0722 * bC;
    }
  }

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
      updateProgress(progress, `Row ${r} / ${rows}`);
    }
  }

  const ascii = out.join('\n');
  asciiOutput.textContent = ascii;
  btnDownloadTxt.disabled = false;
  btnDownloadJpeg.disabled = false;
  btnDownloadPng.disabled = false;
  renderAsciiToCanvas(ascii, cols, rows, parseInt(jpegQuality.value,10)/100);
  updateProgress(100,'Done');
  btnConvert.disabled = false;
  btnCancel.disabled = true;
}

function renderAsciiToCanvas(ascii, cols, rows, jpegQ){
  const fontSize = parseInt(fontSizeInput.value, 10) || 12;
  const font = `${fontSize}px DejaVuSansMonoLocal, monospace`;
  const tmp = document.createElement('canvas');
  const ctx = tmp.getContext('2d');
  ctx.font = font;
  const fm = ctx.measureText('M');
  const charW = fm.width || (fontSize * 0.6);
  const lineH = Math.ceil(fontSize * 1.2);
  tmp.width = Math.ceil(cols * charW) || 1;
  tmp.height = Math.ceil(rows * lineH) || 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0,0,tmp.width,tmp.height);
  ctx.fillStyle = '#fff';
  ctx.font = font;
  ctx.textBaseline = 'top';
  const lines = ascii.split('\n');
  for (let i=0;i<lines.length;i++){
    ctx.fillText(lines[i], 0, i * lineH);
  }
  lastRenderCanvas = tmp;
  try{
    const q = typeof jpegQ === 'number' ? jpegQ : (parseInt(jpegQuality.value,10)/100);
    renderedPreview.src = tmp.toDataURL('image/jpeg', q);
  }catch(e){
    // ignore preview generation failures
  }
}

// UI wiring
document.addEventListener('DOMContentLoaded', ()=>{
  btnSelect.addEventListener('click', ()=> fileInput.click());
  fileInput.addEventListener('change', e => { if (e.target.files.length) handleFile(e.target.files[0]); });

  dropArea.addEventListener('dragover', e => { e.preventDefault(); dropArea.classList.add('dragging'); });
  dropArea.addEventListener('dragleave', e => { dropArea.classList.remove('dragging'); });
  dropArea.addEventListener('drop', e => { e.preventDefault(); dropArea.classList.remove('dragging'); if (e.dataTransfer.files && e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });

  widthRange.addEventListener('input', ()=> widthValue.textContent = widthRange.value);
  widthAuto.addEventListener('change', ()=> widthRange.disabled = widthAuto.checked);
  rampSelect.addEventListener('change', ()=>{ customRamp.style.display = (rampSelect.value === 'custom') ? 'block' : 'none'; });

  btnConvert.addEventListener('click', ()=>{
    const files = fileInput.files;
    if (files && files.length) handleFile(files[0]); else alert('Choose an image first.');
  });

  btnDownloadTxt.addEventListener('click', ()=>{
    const text = asciiOutput.textContent || '';
    const blob = new Blob([text], {type:'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ascii.txt'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });

  btnDownloadJpeg.addEventListener('click', ()=>{
    if (!lastRenderCanvas) return;
    const q = parseInt(jpegQuality.value,10)/100;
    const url = lastRenderCanvas.toDataURL('image/jpeg', q);
    const a = document.createElement('a'); a.href = url; a.download = 'ascii.jpg'; document.body.appendChild(a); a.click(); a.remove();
  });

  btnDownloadPng.addEventListener('click', ()=>{
    if (!lastRenderCanvas) return;
    const url = lastRenderCanvas.toDataURL('image/png');
    const a = document.createElement('a'); a.href = url; a.download = 'ascii.png'; document.body.appendChild(a); a.click(); a.remove();
  });

  btnCancel.addEventListener('click', ()=>{
    if (currentWorker){
      try{ currentWorker.terminate(); }catch(e){}
      currentWorker = null;
      asciiOutput.textContent = 'Cancelled';
      updateProgress(0,'Cancelled');
      btnConvert.disabled = false;
      btnCancel.disabled = true;
    }
  });

  jpegQuality.addEventListener('input', ()=> jpegQualityValue.textContent = jpegQuality.value + '%');

  // initialize defaults
  widthRange.disabled = widthAuto.checked;
  widthValue.textContent = widthRange.value;
  jpegQualityValue.textContent = jpegQuality.value + '%';
});
