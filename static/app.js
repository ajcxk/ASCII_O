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

let worker = null;
let lastRenderCanvas = null;

function ensureWorker(){
  if (worker || !window.Worker) return;
  worker = new Worker('static/worker.js');
  worker.onmessage = e => {
    const {ascii, cols, rows} = e.data;
    asciiOutput.textContent = ascii;
    btnDownloadTxt.disabled = false;
    btnDownloadJpeg.disabled = false;
    renderAsciiToCanvas(ascii, cols, rows);
  };
}

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
  const cols = computeColumns(img.naturalWidth || img.width, fontSize);
  sourceCanvas.width = img.naturalWidth || img.width;
  sourceCanvas.height = img.naturalHeight || img.height;
  const ctx = sourceCanvas.getContext('2d');
  ctx.clearRect(0,0,sourceCanvas.width, sourceCanvas.height);
  ctx.drawImage(img, 0, 0);
  let imageData;
  try{
    imageData = ctx.getImageData(0,0,sourceCanvas.width, sourceCanvas.height);
  }catch(err){
    alert('Unable to access image pixels (CORS?). Try running via a local server.');
    return;
  }

  const ramp = (rampSelect.value === 'custom' && customRamp.value.trim()) ? customRamp.value : (RAMPS[rampSelect.value] || RAMPS.detailed);
  const fontWidth = measureFontWidth(fontSize);
  const fontRatio = fontWidth / fontSize;
  const options = {columns: cols, quality: qualitySelect.value, ramp, fontRatio};
  ensureWorker();
  asciiOutput.textContent = 'Converting...';
  worker.postMessage({image:{width:imageData.width,height:imageData.height,buffer:imageData.data.buffer}, options}, [imageData.data.buffer]);
}

function renderAsciiToCanvas(ascii, cols, rows){
  const fontSize = parseInt(fontSizeInput.value, 10) || 12;
  const font = `${fontSize}px DejaVuSansMonoLocal, monospace`;
  const tmp = document.createElement('canvas');
  const ctx = tmp.getContext('2d');
  ctx.font = font;
  const fm = ctx.measureText('M');
  const charW = fm.width || (fontSize * 0.6);
  const lineH = Math.ceil(fontSize * 1.2);
  tmp.width = Math.ceil(cols * charW);
  tmp.height = Math.ceil(rows * lineH);
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
    renderedPreview.src = tmp.toDataURL('image/jpeg', 0.92);
  }catch(e){
    // ignore
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
    const url = lastRenderCanvas.toDataURL('image/jpeg', 0.92);
    const a = document.createElement('a'); a.href = url; a.download = 'ascii.jpg'; document.body.appendChild(a); a.click(); a.remove();
  });

  // initialize defaults
  widthRange.disabled = widthAuto.checked;
  widthValue.textContent = widthRange.value;
  ensureWorker();
});
