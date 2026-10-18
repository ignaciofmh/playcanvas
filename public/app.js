const $ = id => document.getElementById(id);
const labels = { inspect: 'Revisar video', frames: 'Extraer imágenes', features: 'Detectar detalles', matching: 'Conectar imágenes', mapping: 'Calcular posiciones', training: 'Reconstruir espacio', prepare: 'Preparar recorrido' };
const statusLabels = { uploading: 'Subiendo video', queued: 'En espera', processing: 'Procesando', ready: 'Listo para explorar', failed: 'Necesita revisión', cancelled: 'Cancelado' };
const messages = { inspect: 'Comprobando la duración y el formato de la captura.', frames: 'Seleccionando imágenes del video para reconstruir el espacio.', features: 'Buscando detalles que se repiten entre imágenes.', matching: 'Encontrando las conexiones entre los distintos ángulos.', mapping: 'Calculando las posiciones de la cámara. Esta etapa puede tardar varios minutos.', training: 'Creando la escena 3D. Esta es la etapa más larga; el tiempo depende del tamaño de la captura.', prepare: 'Comprimiendo el resultado y preparando los puntos de vista.' };
let selectedFile = null, selectedSource = 'video', selectedId = null, jobs = [], health = null, uploading = false, frameId = null;
const bytes = n => `${(n / (1024 * 1024)).toFixed(1)} MB`;
function showError(message) { $('error').textContent = message; $('error').hidden = false; }

async function request(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación');
  return data;
}

const canProcess = () => !!health?.sources[selectedSource];
function choose(file) {
  if (!file) return;
  $('error').hidden = true;
  const source = /\.ply$/i.test(file.name) ? 'ply' : 'video';
  if ((source === 'video' && !file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v)$/i.test(file.name)) || !file.size || file.size > 1024 ** 3) {
    showError('Selecciona un video o un Splat PLY de hasta 1 GB.'); return;
  }
  selectedFile = file; selectedSource = source;
  $('file-title').textContent = file.name;
  $('file-info').textContent = `${bytes(file.size)} · listo para cargar`;
  $('upload-zone').classList.add('selected');
  $('choose-file').firstChild.textContent = source === 'ply' ? 'Elegir video ' : 'Cambiar video ';
  $('quality-field').hidden = source === 'ply';
  $('capture-note').textContent = source === 'ply' ? 'Splat PLY binario sin compresión · hasta 2 millones de splats. Se abrirá en exploración libre.' : 'Empieza con una habitación y un video de 30–90 segundos.';
  $('create-button').disabled = uploading || !canProcess();
}

$('choose-file').addEventListener('click', () => $('video-file').click());
$('open-camera').addEventListener('click', () => $('camera-file').click());
$('choose-splat').addEventListener('click', () => $('splat-file').click());
for (const id of ['video-file', 'camera-file', 'splat-file']) $(id).addEventListener('change', event => choose(event.target.files[0]));
$('upload-zone').addEventListener('dragover', event => { event.preventDefault(); $('upload-zone').classList.add('dragging'); });
$('upload-zone').addEventListener('dragleave', () => $('upload-zone').classList.remove('dragging'));
$('upload-zone').addEventListener('drop', event => { event.preventDefault(); $('upload-zone').classList.remove('dragging'); if (!uploading) choose(event.dataTransfer.files[0]); });

function upload(file, title, profile) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/jobs?title=${encodeURIComponent(title)}&profile=${profile}&source=${selectedSource}`);
    xhr.setRequestHeader('Content-Type', selectedSource === 'ply' ? 'application/octet-stream' : (file.type || 'application/octet-stream'));
    xhr.timeout = 15 * 60 * 1000;
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) { const percent = Math.round(event.loaded / event.total * 100); $('upload-meter').value = percent; $('upload-label').textContent = percent === 100 ? 'Guardando captura…' : `Subiendo archivo · ${percent}%`; }
    };
    xhr.onerror = () => reject(new Error('Se perdió la conexión durante la carga. Vuelve a seleccionar el archivo.'));
    xhr.ontimeout = () => reject(new Error('La carga tardó demasiado. Revisa la conexión y vuelve a intentarlo.'));
    xhr.onload = () => {
      try { const data = JSON.parse(xhr.responseText); xhr.status < 300 ? resolve(data) : reject(new Error(data.error)); }
      catch { reject(new Error('El servidor no pudo completar la carga.')); }
    };
    xhr.send(file);
  });
}

$('capture-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!selectedFile || uploading || !canProcess()) return;
  const title = $('title').value.trim();
  if (!title) return $('title').focus();
  uploading = true; $('error').hidden = true; $('create-button').disabled = true;
  $('choose-file').disabled = true; $('open-camera').disabled = true; $('choose-splat').disabled = true;
  $('upload-progress').hidden = false; $('upload-meter').value = 0;
  try {
    const job = await upload(selectedFile, title, $('profile').value);
    selectedId = job.id; jobs.unshift(job); render();
    $('upload-label').textContent = 'Captura recibida. Ya puedes seguir el procesamiento.';
    await refreshJobs();
  } catch (error) { showError(error.message); }
  finally { uploading = false; $('create-button').disabled = !selectedFile || !canProcess(); $('choose-file').disabled = false; $('open-camera').disabled = false; $('choose-splat').disabled = false; }
});

function renderHistory() {
  $('job-count').textContent = jobs.length;
  const list = $('job-list'); list.replaceChildren();
  if (!jobs.length) { const p = document.createElement('p'); p.className = 'empty-history'; p.textContent = 'Tu primera captura aparecerá aquí.'; list.append(p); }
  for (const job of jobs) {
    const button = document.createElement('button'); button.className = `job-item${job.id === selectedId ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(job.id === selectedId));
    if (job.source !== 'ply' && (job.hasPoster || job.frameCount)) { const image = document.createElement('img'); image.src = `/assets/${job.id}/poster.jpg`; image.alt = ''; button.append(image); }
    else { const placeholder = document.createElement('div'); placeholder.className = 'job-placeholder'; placeholder.textContent = '⌑'; button.append(placeholder); }
    const content = document.createElement('div'), name = document.createElement('strong'), date = document.createElement('span'), status = document.createElement('p');
    name.textContent = job.title; date.textContent = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(job.createdAt));
    status.className = 'job-status'; status.textContent = statusLabels[job.status]; content.append(name, date, status); button.append(content);
    button.addEventListener('click', () => { selectedId = job.id; render(); }); list.append(button);
  }
}

function render() {
  renderHistory();
  const job = jobs.find(j => j.id === selectedId);
  for (const id of ['empty-preview', 'processing', 'failed-preview', 'tour-viewer', 'result-actions', 'warnings', 'log-details']) $(id).hidden = true;
  $('preview-badge').textContent = job ? statusLabels[job.status].toUpperCase() : 'VISTA PREVIA';
  if (!job) { $('empty-preview').hidden = false; return; }
  if (job.status === 'ready') {
    $('tour-viewer').hidden = false; $('result-actions').hidden = false;
    if (frameId !== job.id) { $('tour-viewer').src = `/tour/${job.id}?noanim`; frameId = job.id; }
    $('result-name').textContent = job.title;
    const seconds = job.startedAt && job.completedAt ? Math.round((new Date(job.completedAt) - new Date(job.startedAt)) / 1000) : null;
    const elapsed = seconds === null ? '' : ` · ${seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`} de procesamiento`;
    $('result-meta').textContent = `${job.source === 'ply' ? 'Exploración libre' : `${job.views || 0} vistas`} · ${bytes(job.sceneBytes)}${elapsed}`;
    $('download-link').href = `/assets/${job.id}/scene.sog?download=1`; $('open-tour').href = `/tour/${job.id}?noanim`;
  } else {
    if (frameId) { $('tour-viewer').removeAttribute('src'); frameId = null; }
    if (['failed', 'cancelled'].includes(job.status)) {
      $('failed-preview').hidden = false;
      $('failed-title').textContent = job.status === 'cancelled' ? 'Procesamiento cancelado' : 'La captura necesita otra revisión';
      $('failed-message').textContent = job.error?.includes(' terminó con código ') ? 'No se pudo terminar esta etapa. Abre el diagnóstico para ver el detalle; puedes reintentar con el archivo guardado.' : (job.error || 'No se pudo completar el recorrido.');
      $('retry-button').hidden = !job.sourceReady;
    } else {
      $('processing').hidden = false;
      $('processing-title').textContent = job.status === 'queued' ? 'Tu captura está en espera' : 'Procesando captura';
      $('processing-message').textContent = job.status === 'queued' ? 'Se procesará cuando termine la captura anterior.' : job.source === 'ply' ? 'Validando y preparando el escaneo para verlo en el navegador.' : (messages[job.stage] || 'Recibiendo captura.');
      $('cancel-button').hidden = !['queued', 'processing'].includes(job.status);
      const stages = job.source === 'ply' ? ['inspect', 'prepare'] : health?.stages || [];
      $('stage-list').replaceChildren(); const index = stages.indexOf(job.stage);
      for (const [i, stage] of stages.entries()) { const li = document.createElement('li'); li.textContent = job.source === 'ply' && stage === 'inspect' ? 'Revisar escaneo' : labels[stage]; li.className = i < index ? 'done' : i === index ? 'current' : ''; $('stage-list').append(li); }
    }
  }
  if (job.warnings?.length) { $('warnings').hidden = false; $('warnings').textContent = job.warnings.join(' '); }
  $('log-details').hidden = job.status === 'uploading';
}

for (const action of ['cancel', 'retry']) $(`${action}-button`).addEventListener('click', async () => {
  const button = $(`${action}-button`); button.disabled = true;
  try { await request(`/api/jobs/${selectedId}/${action}`, { method: 'POST' }); await refreshJobs(); }
  catch (error) { showError(error.message); } finally { button.disabled = false; }
});
$('log-details').addEventListener('toggle', async () => {
  if (!$('log-details').open || !selectedId) return;
  try { const { text } = await request(`/api/jobs/${selectedId}/log`); $('log-output').textContent = text || 'Todavía no hay diagnóstico.'; }
  catch (error) { $('log-output').textContent = error.message; }
});

async function refreshJobs() {
  jobs = await request('/api/jobs');
  if (!selectedId && jobs.length) selectedId = jobs[0].id;
  render();
}

async function init() {
  try {
    health = await request('/api/health');
    if (!health.ready) { $('setup-notice').textContent = `Faltan herramientas para reconstruir videos. Consulta la instalación del proyecto.${health.sources.ply ? ' Puedes importar un escaneo PLY existente.' : ''}`; $('setup-notice').hidden = false; }
    if (health.connectionUrls.length) {
      $('connection').hidden = false;
      $('pairing-code').textContent = health.pairingCode;
      for (const url of health.connectionUrls) { const link = document.createElement('a'); const address = new URL(url).origin; link.href = address; link.textContent = address; $('connection-links').append(link); }
    }
    $('create-button').disabled = !selectedFile || !canProcess();
    await refreshJobs();
  } catch { showError('No se pudo conectar con el servidor local. Revisa que esté encendido.'); }
  poll();
}
async function poll() {
  const active = jobs.some(j => ['queued', 'processing', 'uploading'].includes(j.status));
  setTimeout(async () => {
    try { await refreshJobs(); } catch { /* Retain the last persisted state during a temporary disconnection. */ }
    poll();
  }, active ? 5000 : 15000);
}
void init();
