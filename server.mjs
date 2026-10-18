import http from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat, readFile, access, rm } from 'node:fs/promises';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';
import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { renderViewerHtml, js as viewerJs } from '@playcanvas/supersplat-viewer';
import { Store, validId } from './lib/store.mjs';
import { Queue, profiles, stages, toolsFor, toolStatus } from './lib/pipeline.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
export const MAX_UPLOAD = 1024 * 1024 * 1024;
const OUTPUT_FILES = new Set(['poster.jpg', 'scene.sog', 'scene.ply', 'settings.json']);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.sog': 'application/octet-stream', '.ply': 'application/octet-stream' };
const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const localIps = () => Object.values(networkInterfaces()).flat().filter(i => i && !i.internal && i.family === 'IPv4').map(i => i.address);

function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
function problem(status, message) { return Object.assign(new Error(message), { status }); }
function equal(a, b) { const x = Buffer.from(a || ''), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function requestCookie(req, name) { return req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1); }
function safeOrigin(value) { try { return new URL(value).origin; } catch { return value === 'null' ? 'null' : 'ausente o inválido'; } }

export function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw problem(416, 'Rango inválido');
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) throw problem(416, 'Rango fuera del archivo');
  return { start, end };
}

async function sendFile(req, res, file, download = false) {
  const info = await stat(file);
  if (!info.isFile()) throw problem(404, 'Archivo inexistente');
  let range;
  try { range = parseRange(req.headers.range, info.size); }
  catch (error) { res.setHeader('Content-Range', `bytes */${info.size}`); throw error; }
  const start = range?.start ?? 0, end = range?.end ?? info.size - 1;
  res.writeHead(range ? 206 : 200, {
    'Content-Type': MIME[extname(file)] || 'application/octet-stream',
    'Content-Length': range ? end - start + 1 : info.size,
    'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-cache',
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}),
    ...(download ? { 'Content-Disposition': `attachment; filename="${file.split('/').pop()}"` } : {})
  });
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(file, range || undefined);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

export function createApp({ root = ROOT, dataRoot = join(root, 'data/jobs'), tools = toolsFor(root), processJob, lan = false, maxUpload = MAX_UPLOAD } = {}) {
  const store = new Store(dataRoot), queue = new Queue(store, tools, processJob);
  const key = randomBytes(24).toString('hex');
  const pairingCode = randomBytes(4).toString('hex').toUpperCase();
  let attempts = 0, attemptsSince = Date.now();
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]', ...localIps()]);
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // no-referrer turns HTML form POSTs into Origin:null, breaking our origin check.
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    try {
      const url = new URL(req.url, 'http://localhost');
      const host = new URL(`http://${req.headers.host}`).hostname;
      if (!hosts.has(host)) throw problem(403, 'Host no permitido');
      const local = loopback(req.socket.remoteAddress);
      const cookie = requestCookie(req, 'recorrido');
      const sameOrigin = `http://${req.headers.host}`;
      const pairingPost = lan && url.pathname === '/connect' && req.method === 'POST';
      const readOnly = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      // Navigation redirects can retain an opaque Origin. Reads remain protected by
      // authentication and the browser's same-origin policy; writes require provenance.
      if (!readOnly && req.headers.origin && req.headers.origin !== sameOrigin && !(pairingPost && req.headers.origin === 'null')) {
        console.warn('[acceso] origen rechazado', JSON.stringify({ method: req.method, origin: safeOrigin(req.headers.origin), expected: sameOrigin }));
        throw problem(403, 'Origen no permitido');
      }
      const sign = payload => createHmac('sha256', key).update(payload).digest('hex');
      const connectPage = async (status = 200, message = '') => {
        const page = await readFile(join(root, 'public/connect.html'), 'utf8');
        const payload = `${Date.now()}.${randomBytes(12).toString('hex')}`;
        const token = `${payload}.${sign(payload)}`;
        res.setHeader('Set-Cookie', `recorrido_connect=${token}; HttpOnly; SameSite=Lax; Path=/connect; Max-Age=600`);
        res.writeHead(status, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        res.end(page.replace('<!--MESSAGE-->', message).replace('<!--TOKEN-->', token));
      };
      const connect = () => {
        // Lax also carries the session on navigation from another app, such as a shared link.
        // Mutating requests still require a matching Origin above.
        res.writeHead(303, { 'Set-Cookie': `recorrido=${key}; HttpOnly; SameSite=Lax; Path=/`, Location: '/' });
        return res.end();
      };
      if (pairingPost) {
        console.info('[acceso] formulario de conexión', JSON.stringify({ origin: safeOrigin(req.headers.origin), expected: sameOrigin }));
        const length = Number(req.headers['content-length']);
        if (!Number.isSafeInteger(length) || length < 1 || length > 512) throw problem(400, 'Código inválido');
        if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers['content-type'] || '')) throw problem(415, 'Formato inválido');
        if (Date.now() - attemptsSince >= 60000) { attempts = 0; attemptsSince = Date.now(); }
        if (attempts >= 10) { res.setHeader('Retry-After', '60'); return await connectPage(429, 'Demasiados intentos. Espera un minuto y vuelve a intentarlo.'); }
        let body = '';
        for await (const chunk of req) { body += chunk.toString(); if (body.length > 512) throw problem(400, 'Código inválido'); }
        const form = new URLSearchParams(body), token = form.get('token') || '';
        const match = /^(\d{13})\.([a-f0-9]{24})\.([a-f0-9]{64})$/.exec(token);
        if (!match || !equal(token, requestCookie(req, 'recorrido_connect') || '') || !equal(match[3], sign(`${match[1]}.${match[2]}`)) || Number(match[1]) > Date.now() || Date.now() - Number(match[1]) > 600000) {
          return await connectPage(403, 'Vuelve a escribir el código en este formulario. Si el error se repite, permite las cookies de este sitio.');
        }
        const code = (form.get('code') || '').replace(/[\s-]/g, '').toUpperCase();
        if (!equal(code, pairingCode)) { attempts++; return await connectPage(403, 'El código no coincide. Recarga la web en el Mac y usa el código que aparece allí.'); }
        console.info('[acceso] conexión autorizada');
        return connect();
      }
      if (lan && url.pathname === '/connect' && req.method === 'GET') {
        if (equal(url.searchParams.get('key'), key)) return connect();
        return await connectPage(200, url.searchParams.has('key') ? 'El enlace caducó. Usa el código que aparece ahora en el Mac.' : '');
      }
      if (!local && lan && !equal(cookie, key) && req.method === 'GET' && url.pathname === '/') return await connectPage();
      if (!local && (!lan || !equal(cookie, key))) throw problem(403, 'Abre el enlace de conexión desde el computador para acceder al MVP.');
      if (req.method === 'GET' && url.pathname === '/api/health') {
        const available = await toolStatus(tools);
        const ready = Object.values(available).every(Boolean);
        return json(res, 200, { tools: available, ready, sources: { video: ready, ply: !!available.transform }, maxUpload, stages, lan, pairingCode: local && lan ? `${pairingCode.slice(0, 4)}-${pairingCode.slice(4)}` : null, connectionUrls: local && lan ? localIps().map(ip => `http://${ip}:${server.address().port}/connect?key=${key}`) : [] });
      }
      if (req.method === 'GET' && url.pathname === '/api/jobs') return json(res, 200, store.list());
      if (req.method === 'POST' && url.pathname === '/api/jobs') {
        const available = await toolStatus(tools);
        const sourceType = url.searchParams.get('source') || 'video';
        if (!['video', 'ply'].includes(sourceType)) throw problem(400, 'Tipo de captura inválido');
        if (sourceType === 'video' ? !Object.values(available).every(Boolean) : !available.transform) throw problem(503, 'Faltan herramientas de procesamiento. Ejecuta npm run setup en el computador.');
        const title = (url.searchParams.get('title') || '').trim();
        const profile = url.searchParams.get('profile') || 'quick';
        if (!title || title.length > 120 || /[\x00-\x1f]/.test(title)) throw problem(400, 'Escribe un nombre de entre 1 y 120 caracteres');
        if (!Object.hasOwn(profiles, profile)) throw problem(400, 'Calidad inválida');
        const contentType = req.headers['content-type'] || '';
        if (!(sourceType === 'video' ? /^(video\/[a-z0-9.+-]+|application\/octet-stream)(;|$)/i : /^application\/octet-stream(;|$)/i).test(contentType)) throw problem(415, 'Formato de carga no permitido');
        const size = Number(req.headers['content-length']);
        if (!Number.isSafeInteger(size) || size < 1 || size > maxUpload) throw problem(413, 'El archivo debe pesar entre 1 byte y 1 GB');
        const job = store.create({ title, profile, source: sourceType });
        const source = join(store.dir(job.id), `source.${sourceType}`);
        const output = createWriteStream(source, { flags: 'wx' });
        let bytes = 0;
        try {
          const limit = new Transform({ transform(chunk, encoding, callback) {
            bytes += chunk.length;
            callback(bytes > maxUpload || bytes > size ? problem(413, 'Archivo demasiado grande') : null, chunk);
          } });
          await streamPipeline(req, limit, output);
          if (bytes !== size) throw problem(400, 'La carga quedó incompleta');
          store.update(job.id, { status: 'queued', sourceReady: true, uploadBytes: bytes });
        } catch (error) {
          await rm(source, { force: true });
          store.update(job.id, { status: 'failed', sourceReady: false, error: 'No se pudo completar la carga. Vuelve a seleccionar el archivo.' });
          throw error;
        }
        json(res, 202, store.get(job.id));
        void queue.kick();
        return;
      }
      const apiMatch = /^\/api\/jobs\/([a-f0-9-]{36})(?:\/(cancel|retry|log))?$/.exec(url.pathname);
      if (apiMatch) {
        const [, id, action] = apiMatch, job = store.get(id);
        if (!job) throw problem(404, 'Tour inexistente');
        if (req.method === 'GET' && !action) return json(res, 200, job);
        if (req.method === 'GET' && action === 'log') {
          let text = '';
          try { text = (await readFile(join(store.dir(id), 'process.log'), 'utf8')).slice(-24000); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          return json(res, 200, { text });
        }
        if (req.method === 'POST' && action === 'cancel') {
          if (!queue.cancel(id)) throw problem(409, 'Este tour ya no está en procesamiento');
          return json(res, 200, { ok: true });
        }
        if (req.method === 'POST' && action === 'retry') {
          if (!['failed', 'cancelled'].includes(job.status) || !job.sourceReady) throw problem(409, 'Este tour no se puede reintentar');
          await access(join(store.dir(id), `source.${job.source === 'ply' ? 'ply' : 'video'}`));
          store.update(id, { status: 'queued', stage: 'inspect', error: null, warnings: [], frameCount: null, registeredCount: null, hasPoster: false, sceneBytes: null, views: null, completedAt: null });
          json(res, 202, store.get(id)); void queue.kick(); return;
        }
        throw problem(405, 'Método no permitido');
      }
      const viewMatch = /^\/tour\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (viewMatch && req.method === 'GET') {
        const id = viewMatch[1], job = store.get(id);
        if (!job || job.status !== 'ready') throw problem(404, 'El tour todavía no está disponible');
        const settings = JSON.parse(await readFile(join(store.dir(id), 'output/settings.json'), 'utf8'));
        const html = renderViewerHtml({
          baseHref: '/viewer/', inlineCss: true,
          bootstrap: { settings, contentUrl: `/assets/${id}/scene.sog`, ...(job.source !== 'ply' ? { posterUrl: `/assets/${id}/poster.jpg` } : {}) }
        });
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' }); res.end(html); return;
      }
      if (['GET', 'HEAD'].includes(req.method) && url.pathname === '/viewer/index.js') {
        res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'private, max-age=3600' });
        return res.end(req.method === 'HEAD' ? undefined : viewerJs);
      }
      const assetMatch = /^\/assets\/([a-f0-9-]{36})\/([^/]+)$/.exec(url.pathname);
      if (assetMatch && ['GET', 'HEAD'].includes(req.method)) {
        const [, id, name] = assetMatch, job = store.get(id);
        if (!validId(id) || !job || !OUTPUT_FILES.has(name) || (job.status !== 'ready' && name !== 'poster.jpg')) throw problem(404, 'Archivo inexistente');
        return await sendFile(req, res, join(store.dir(id), 'output', name), url.searchParams.has('download'));
      }
      const publicFiles = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
      if (['GET', 'HEAD'].includes(req.method) && Object.hasOwn(publicFiles, url.pathname)) {
        return await sendFile(req, res, join(root, 'public', publicFiles[url.pathname]));
      }
      throw problem(404, 'Página inexistente');
    } catch (error) {
      if (!res.headersSent) json(res, error.status || (error.code === 'ENOENT' ? 404 : 500), { error: error.status ? error.message : 'No se pudo completar la operación. Revisa el servidor.' });
      else res.destroy();
    }
  });
  server.requestTimeout = 15 * 60 * 1000;
  return { server, store, queue, start: () => void queue.kick() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const lan = process.argv.includes('--lan');
  const app = createApp({ lan });
  app.server.listen(Number(process.env.PORT || 4173), lan ? '0.0.0.0' : '127.0.0.1', () => {
    console.log(`Recorrido MVP: http://localhost:${app.server.address().port}`);
    if (lan) console.log('Modo red local. Abre la web en este computador para obtener el enlace de conexión del celular.');
    app.start();
  });
  const stop = () => { app.queue.stop(); app.server.close(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
