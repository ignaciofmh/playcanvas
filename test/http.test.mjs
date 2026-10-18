import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, networkInterfaces } from 'node:os';
import { once } from 'node:events';
import { createApp, parseRange } from '../server.mjs';
import { defaultSettings } from '@playcanvas/supersplat-viewer/settings';

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'recorrido-http-'));
  const tools = Object.fromEntries(['ffmpeg', 'ffprobe', 'colmap', 'brush', 'transform'].map(k => [k, process.execPath]));
  const app = createApp({ dataRoot: dir, tools, maxUpload: 1000, ...options });
  app.server.listen(0, options.lan ? '0.0.0.0' : '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { app.queue.stop(); await new Promise(r => app.server.close(r)); await rm(dir, { recursive: true, force: true }); });
  return { ...app, url: `http://127.0.0.1:${app.server.address().port}` };
}
const post = (url, body = 'video', headers = {}) => fetch(`${url}/api/jobs?title=Living&profile=quick`, { method: 'POST', headers: { 'Content-Type': 'video/mp4', ...headers }, body });

async function connectionForm(url) {
  const page = await fetch(`${url}/connect`);
  const html = await page.text();
  return { token: /name="token" value="([^"]+)"/.exec(html)?.[1], cookie: page.headers.get('set-cookie')?.split(';')[0] };
}
async function enterCode(url, code, origin = url) {
  const { token, cookie } = await connectionForm(url);
  return fetch(`${url}/connect`, { method: 'POST', headers: { Origin: origin, Cookie: cookie }, body: new URLSearchParams({ code, token }), redirect: 'manual' });
}

test('rechaza cargas inválidas y peticiones de otro origen antes de crear un trabajo', async t => {
  const app = await fixture(t);
  assert.equal((await post(app.url, 'v', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post(app.url, 'x'.repeat(1001))).status, 413);
  assert.equal((await post(app.url, 'v', { Origin: 'https://otro-sitio.example' })).status, 403);
  assert.equal((await fetch(`${app.url}/api/jobs?title=&profile=quick`, { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: 'v' })).status, 400);
  assert.equal((await fetch(`${app.url}/api/jobs?title=Living&profile=__proto__`, { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: 'v' })).status, 400);
  assert.equal(app.store.list().length, 0);
});

test('bloquea el procesamiento cuando faltan herramientas', async t => {
  const app = await fixture(t, { tools: { brush: '/no-existe/brush' } });
  assert.equal((await post(app.url)).status, 503);
  assert.equal(app.store.list().length, 0);
});

test('persiste la carga, sirve escena y visor local, y no expone archivos privados', async t => {
  const app = await fixture(t, { processJob: async (job, store) => {
    const output = join(store.dir(job.id), 'output'); await mkdir(output);
    await writeFile(join(output, 'scene.sog'), 'scene-data');
    await writeFile(join(output, 'settings.json'), JSON.stringify(defaultSettings()));
    store.update(job.id, { status: 'ready', sceneBytes: 10, views: 0 });
  } });
  const response = await post(app.url); assert.equal(response.status, 202);
  const job = await response.json();
  for (let i = 0; i < 100 && app.store.get(job.id).status !== 'ready'; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(app.store.get(job.id).status, 'ready');
  assert.equal(await readFile(join(app.store.dir(job.id), 'source.video'), 'utf8'), 'video');
  const view = await fetch(`${app.url}/tour/${job.id}`); assert.equal(view.status, 200);
  const html = await view.text(); assert.match(html, /sse-bootstrap/); assert.match(html, /scene\.sog/); assert.match(html, /\/viewer\//);
  const range = await fetch(`${app.url}/assets/${job.id}/scene.sog`, { headers: { Range: 'bytes=0-4' } });
  assert.equal(range.status, 206); assert.equal(await range.text(), 'scene');
  const badRange = await fetch(`${app.url}/assets/${job.id}/scene.sog`, { headers: { Range: 'bytes=100-200' } }); assert.equal(badRange.status, 416);
  for (const path of [`/assets/${job.id}/source.video`, `/assets/${job.id}/job.json`, '/server.mjs', `/assets/${job.id}/%2e%2e%2fjob.json`]) assert.equal((await fetch(app.url + path)).status, 404);
  assert.equal((await fetch(`${app.url}/api/jobs/${job.id}/retry`, { method: 'POST' })).status, 409);
});

test('un fallo real es visible y reintentar reutiliza el video original', async t => {
  let calls = 0;
  const app = await fixture(t, { processJob: async () => { calls++; throw new Error('No se conectaron imágenes'); } });
  const job = await (await post(app.url)).json();
  for (let i = 0; i < 100 && app.store.get(job.id).status !== 'failed'; i++) await new Promise(r => setTimeout(r, 10));
  const current = await (await fetch(`${app.url}/api/jobs/${job.id}`)).json();
  assert.equal(current.status, 'failed'); assert.match(current.error, /imágenes/);
  assert.equal((await fetch(`${app.url}/tour/${job.id}`)).status, 404);
  assert.equal((await fetch(`${app.url}/api/jobs/${job.id}/retry`, { method: 'POST' })).status, 202);
  for (let i = 0; i < 100 && app.store.get(job.id).status !== 'failed'; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(calls, 2); assert.equal(await readFile(join(app.store.dir(job.id), 'source.video'), 'utf8'), 'video');
});

test('rangos normales, sufijos y límites de archivos', () => {
  assert.deepEqual(parseRange('bytes=5-', 10), { start: 5, end: 9 });
  assert.deepEqual(parseRange('bytes=-4', 10), { start: 6, end: 9 });
  assert.throws(() => parseRange('bytes=-0', 10));
  assert.throws(() => parseRange('bytes=0-1,4-5', 10));
  assert.throws(() => parseRange('bytes=5-1', 10));
});

test('permite importar sin Brush ni COLMAP y conserva el PLY al reintentar', async t => {
  let calls = 0;
  const app = await fixture(t, { tools: { transform: process.execPath, brush: '/no-existe' }, processJob: async () => { calls++; throw new Error('PLY inválido'); } });
  const health = await (await fetch(`${app.url}/api/health`)).json();
  assert.equal(health.sources.video, false); assert.equal(health.sources.ply, true);
  const response = await fetch(`${app.url}/api/jobs?title=Escaneo&source=ply`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: 'ply-source' });
  assert.equal(response.status, 202); const job = await response.json();
  for (let i = 0; i < 100 && app.store.get(job.id).status !== 'failed'; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(job.source, 'ply');
  assert.equal(await readFile(join(app.store.dir(job.id), 'source.ply'), 'utf8'), 'ply-source');
  assert.equal((await fetch(`${app.url}/api/jobs/${job.id}/retry`, { method: 'POST' })).status, 202);
  for (let i = 0; i < 100 && calls !== 2; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(calls, 2);
  assert.equal((await fetch(`${app.url}/api/jobs?title=Escaneo&source=unknown`, { method: 'POST', body: 'v' })).status, 400);
});

test('conecta desde la red local con código, protege APIs y conserva los enlaces anteriores', async t => {
  const ip = Object.values(networkInterfaces()).flat().find(i => i && !i.internal && i.family === 'IPv4')?.address;
  if (!ip) return t.skip('Se necesita una interfaz IPv4 para probar un cliente de red local');
  const app = await fixture(t, { lan: true });
  const remote = `http://${ip}:${app.server.address().port}`;
  const health = await (await fetch(`${app.url}/api/health`)).json();
  assert.match(health.pairingCode, /^[A-F0-9]{4}-[A-F0-9]{4}$/);
  const landing = await fetch(remote);
  assert.equal(landing.status, 200); assert.match(await landing.text(), /Código de conexión/);
  assert.equal((await fetch(`${remote}/api/jobs`)).status, 403);
  assert.equal((await fetch(`${remote}/api/health`)).status, 403);
  const invalid = await enterCode(remote, 'INCORRECTO');
  assert.equal(invalid.status, 403); assert.match(await invalid.text(), /El código no coincide/);
  const login = await enterCode(remote, health.pairingCode.toLowerCase());
  assert.equal(login.status, 303); assert.equal(login.headers.get('location'), '/');
  const cookie = login.headers.get('set-cookie'); assert.match(cookie, /HttpOnly; SameSite=Lax/);
  const headers = { Cookie: cookie.split(';')[0] };
  const home = await fetch(remote, { headers }); assert.equal(home.status, 200); assert.match(await home.text(), /Tu espacio, en 3D/);
  assert.equal((await fetch(`${remote}/api/jobs`, { headers })).status, 200);
  const remoteHealth = await (await fetch(`${remote}/api/health`, { headers })).json();
  assert.equal(remoteHealth.pairingCode, null); assert.deepEqual(remoteHealth.connectionUrls, []);
  const oldLogin = await fetch(health.connectionUrls[0], { redirect: 'manual' }); assert.equal(oldLogin.status, 303);
  const stale = await fetch(`${remote}/connect?key=caducada`); assert.equal(stale.status, 200); assert.match(await stale.text(), /El enlace caducó/);
});

test('limita los intentos del código y rechaza el envío desde otro origen', async t => {
  const app = await fixture(t, { lan: true });
  assert.equal((await enterCode(app.url, 'incorrecto', 'https://otro.example')).status, 403);
  for (let i = 0; i < 10; i++) assert.equal((await enterCode(app.url, 'incorrecto')).status, 403);
  const blocked = await enterCode(app.url, 'incorrecto');
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '60');
  assert.match(await blocked.text(), /Demasiados intentos/);
});

test('el formulario conserva Origin en navegaciones POST del mismo sitio', async t => {
  const app = await fixture(t, { lan: true });
  // Fetch: no-referrer makes navigate-mode form POSTs send Origin:null.
  // A same-origin policy keeps their real origin while withholding cross-site referrers.
  const page = await fetch(`${app.url}/connect`);
  assert.equal(page.headers.get('referrer-policy'), 'same-origin');
  assert.match(await page.text(), /method="post" action="\/connect"/);
  const health = await (await fetch(`${app.url}/api/health`)).json();
  const body = () => new URLSearchParams({ code: health.pairingCode });
  for (const Origin of ['null', 'http://otro-sitio.example']) {
    const rejected = await fetch(`${app.url}/connect`, { method: 'POST', headers: { Origin }, body: body(), redirect: 'manual' });
    assert.equal(rejected.status, 403); assert.ok(!rejected.headers.get('set-cookie')?.startsWith('recorrido='));
  }
  const accepted = await enterCode(app.url, health.pairingCode);
  assert.equal(accepted.status, 303); assert.ok(accepted.headers.get('set-cookie'));
});

test('un Origin opaco puede conectar únicamente con formulario firmado, cookie y código correctos', async t => {
  const app = await fixture(t, { lan: true });
  const health = await (await fetch(`${app.url}/api/health`)).json();
  const signed = await connectionForm(app.url);
  const submit = (token, cookie, code = health.pairingCode) => fetch(`${app.url}/connect`, {
    method: 'POST', headers: { Origin: 'null', Cookie: cookie || '' },
    body: new URLSearchParams({ token, code }), redirect: 'manual'
  });
  for (const [token, cookie] of [[signed.token, ''], ['', signed.cookie], [signed.token.replace(/.$/, 'z'), signed.cookie]]) {
    const rejected = await submit(token, cookie);
    assert.equal(rejected.status, 403); assert.ok(!rejected.headers.get('set-cookie')?.startsWith('recorrido='));
  }
  // A forged matching double-submit cookie is insufficient without a valid server signature.
  const forged = `${Date.now()}.${'a'.repeat(24)}.${'b'.repeat(64)}`;
  assert.equal((await submit(forged, `recorrido_connect=${forged}`)).status, 403);
  const invalidCode = await enterCode(app.url, 'incorrecto', 'null'); assert.equal(invalidCode.status, 403);
  const accepted = await enterCode(app.url, health.pairingCode, 'null');
  assert.equal(accepted.status, 303); assert.ok(accepted.headers.get('set-cookie')?.startsWith('recorrido='));
  const opaqueNavigation = await fetch(app.url, { headers: { Origin: 'null', Cookie: accepted.headers.get('set-cookie').split(';')[0] } });
  assert.equal(opaqueNavigation.status, 200); assert.match(await opaqueNavigation.text(), /Tu espacio, en 3D/);
  assert.equal((await post(app.url, 'video', { Origin: 'null' })).status, 403);
  assert.equal((await enterCode(app.url, health.pairingCode, 'https://otro.example')).status, 403);
});
