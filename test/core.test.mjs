import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../lib/store.mjs';
import { Queue, run, inspectSplat, pipeline } from '../lib/pipeline.mjs';
import { cameraPose, readCameras, tourSettings, levelCameras } from '../lib/cameras.mjs';

async function fixture(t) { const dir = await mkdtemp(join(tmpdir(), 'recorrido-test-')); t.after(() => rm(dir, { recursive: true, force: true })); return new Store(dir); }
const waitFor = async fn => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error('Timeout de prueba'); };

test('recupera trabajos en espera y marca un procesamiento interrumpido conservando el original', async t => {
  const store = await fixture(t);
  const a = store.create({ title: 'Habitación', profile: 'quick' });
  store.update(a.id, { status: 'processing', sourceReady: true });
  await writeFile(join(store.dir(a.id), 'source.video'), 'original');
  const b = store.create({ title: 'Living', profile: 'detailed' }); store.update(b.id, { status: 'queued' });
  const recovered = new Store(store.root);
  assert.equal(recovered.get(a.id).status, 'failed');
  assert.equal(recovered.get(a.id).sourceReady, true);
  assert.equal(await readFile(join(store.dir(a.id), 'source.video'), 'utf8'), 'original');
  assert.equal(recovered.get(b.id).status, 'queued');
  assert.throws(() => store.dir('../private'));
});

test('la cola ejecuta un solo trabajo aunque reciba disparos duplicados', async t => {
  const store = await fixture(t), ids = [];
  for (let i = 0; i < 2; i++) { const job = store.create({ title: `Espacio ${i}`, profile: 'quick' }); ids.push(job.id); store.update(job.id, { status: 'queued' }); }
  let active = 0, max = 0; const seen = [];
  const queue = new Queue(store, {}, async job => {
    active++; max = Math.max(max, active); seen.push(job.id);
    await new Promise(r => setTimeout(r, 20)); active--;
    store.update(job.id, { status: 'ready' });
  });
  const first = queue.kick(); void queue.kick(); void queue.kick(); await first;
  await waitFor(() => store.list().every(j => j.status === 'ready'));
  assert.equal(max, 1); assert.equal(seen.length, 2); assert.deepEqual(new Set(seen), new Set(ids));
});

test('cancelar el activo permite continuar la cola y un fallo no se presenta como éxito', async t => {
  const store = await fixture(t), ids = [];
  for (let i = 0; i < 2; i++) { const job = store.create({ title: `Espacio ${i}`, profile: 'quick' }); ids.push(job.id); store.update(job.id, { status: 'queued' }); }
  let firstId;
  const queue = new Queue(store, {}, async (job, _store, _tools, signal) => {
    if (!firstId) { firstId = job.id; await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelado')), { once: true })); }
    else throw new Error('captura sin solapamiento');
  });
  const task = queue.kick(); assert.equal(queue.cancel(firstId), true); await task;
  await waitFor(() => store.list().every(j => ['cancelled', 'failed'].includes(j.status)));
  assert.equal(store.get(firstId).status, 'cancelled');
  const other = ids.find(id => id !== firstId); assert.equal(store.get(other).status, 'failed');
  assert.match(store.get(other).error, /solapamiento/);
});

test('ejecuta argumentos como datos, detecta fallo y termina un proceso cancelado', async () => {
  assert.match(await run(process.execPath, ['-e', 'console.log(process.argv[1])', ';echo injected']), /;echo injected/);
  await assert.rejects(run(process.execPath, ['-e', 'console.error("fallo real");process.exit(2)']), /fallo real/);
  const controller = new AbortController();
  const task = run(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { signal: controller.signal });
  controller.abort(); await assert.rejects(task, /cancelado/);
});

test('transforma cámaras COLMAP al espacio del visor incluyendo orientación', () => {
  assert.deepEqual(cameraPose([1, 0, 0, 0], [-1, -2, -3]), { position: [-1, -2, 3], target: [-1, -2, 4], fov: 75 });
  const p = cameraPose([Math.SQRT1_2, 0, Math.SQRT1_2, 0], [1, 0, 0]);
  assert.ok(Math.abs(p.position[0]) < 1e-10); assert.ok(Math.abs(p.position[2] + 1) < 1e-10);
  assert.ok(Math.abs(p.target[0] - 1) < 1e-10);
  assert.throws(() => cameraPose([0, 0, 0, 0], [0, 0, 0]), /inválida/);
});

test('lee observaciones vacías, conserva orden de captura y genera vistas válidas', () => {
  const poses = readCameras('# camera\n1 PINHOLE 200 200 100 100 100 100\n', '# image\n2 1 0 0 0 -2 0 0 1 frame_00002.jpg\n\n1 1 0 0 0 -1 0 0 1 frame_00001.jpg\n0 0 -1\n3 1 0 0 0 -3 0 0 1 frame_00003.jpg\n\n');
  assert.equal(poses.length, 3); assert.equal(poses[0].name, 'frame_00001.jpg'); assert.equal(poses[0].fov, 90);
  const settings = tourSettings(poses); assert.equal(settings.annotations.length, 3); assert.equal(settings.startMode, 'annotation');
  assert.deepEqual(settings.cameras[0].initial.position, poses[0].position);
  assert.throws(() => tourSettings(poses.slice(0, 2)), /suficientes/);
  assert.throws(() => readCameras('1 SIMPLE_RADIAL 200 200 100 100 100 0', ''), /distorsión/);
});

test('nivela una reconstrucción inclinada rotando escena y cámaras en el mismo sistema', () => {
  const p = { ...cameraPose([1, 0, 0, 0], [-1, -2, -3]), down: [1, 0, 0] };
  const leveled = levelCameras([p]);
  assert.ok(Math.abs(leveled.poses[0].down[0]) < 1e-10);
  assert.ok(Math.abs(leveled.poses[0].down[1] - 1) < 1e-10);
  assert.deepEqual(leveled.rotations, ['0,0,90', '0,0,0']);
  const pose = leveled.poses[0];
  assert.ok(Math.abs(pose.position[0] - 2) < 1e-10);
  assert.ok(Math.abs(pose.position[1] + 1) < 1e-10);
  assert.deepEqual(pose.target.map((v, i) => Math.round(v - pose.position[i])), [0, 0, 1]);
  const tilted = levelCameras([{ ...p, down: [0, Math.SQRT1_2, Math.SQRT1_2] }]);
  assert.ok(Math.abs(tilted.poses[0].down[2]) < 1e-10);
  assert.equal(tilted.rotations[1], '45,0,0');
  assert.throws(() => levelCameras([p, { ...p, down: [-1, 0, 0] }]), /orientación/);
});

function splatFile({ properties = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'], count = 2, truncate = false, newline = '\n' } = {}) {
  const header = ['ply', 'format binary_little_endian 1.0', `element vertex ${count}`, ...properties.map(p => `property float ${p}`), 'end_header', ''].join(newline);
  return Buffer.concat([Buffer.from(header), Buffer.alloc(truncate ? 4 : properties.length * 4 * 2)]);
}

test('importación acepta un splat y rechaza mallas, archivos incompletos y exceso de puntos', async t => {
  const store = await fixture(t), job = store.create({ title: 'Escaneo', profile: 'quick', source: 'ply' });
  const file = join(store.dir(job.id), 'source.ply');
  await writeFile(file, splatFile()); assert.equal(await inspectSplat(file), 2);
  await writeFile(file, splatFile({ newline: '\r\n' })); assert.equal(await inspectSplat(file), 2);
  await writeFile(file, splatFile({ properties: ['x', 'y', 'z'] })); await assert.rejects(inspectSplat(file), /no contiene Gaussian Splats/);
  await writeFile(file, splatFile({ truncate: true })); await assert.rejects(inspectSplat(file), /incompleto/);
  await writeFile(file, splatFile({ count: 2000001 })); await assert.rejects(inspectSplat(file), /2 millones/);
  await writeFile(file, 'otro formato'); await assert.rejects(inspectSplat(file), /no es un PLY/);
});

test('importar reutiliza el escaneo original sin ejecutar herramientas de reconstrucción', async t => {
  const store = await fixture(t), job = store.create({ title: 'Escaneo', profile: 'quick', source: 'ply' });
  const source = splatFile(); await writeFile(join(store.dir(job.id), 'source.ply'), source);
  const tools = { transform: '/transform' }, calls = [];
  await pipeline(job, store, tools, new AbortController().signal, async (command, args) => {
    calls.push({ command, args }); await writeFile(args.at(-1), 'test-output');
  });
  assert.equal(calls.length, 1); assert.equal(calls[0].args[0], tools.transform);
  assert.deepEqual(await readFile(join(store.dir(job.id), 'source.ply')), source);
  const settings = JSON.parse(await readFile(join(store.dir(job.id), 'output/settings.json')));
  assert.deepEqual(settings.cameras, []); assert.deepEqual(settings.annotations, []);
  assert.equal(store.get(job.id).status, 'ready'); assert.equal(store.get(job.id).views, 0);
});

test('un video fuera del límite no llega a reconstrucción ni se marca listo', async t => {
  const store = await fixture(t), job = store.create({ title: 'Video corto', profile: 'quick' });
  await writeFile(join(store.dir(job.id), 'source.video'), 'original');
  let calls = 0;
  await assert.rejects(pipeline(job, store, { ffprobe: 'probe' }, new AbortController().signal, async () => {
    calls++; return JSON.stringify({ format: { duration: '4' }, streams: [{ codec_type: 'video' }] });
  }), /5 segundos/);
  assert.equal(calls, 1); assert.notEqual(store.get(job.id).status, 'ready');
  assert.equal(await readFile(join(store.dir(job.id), 'source.video'), 'utf8'), 'original');
});

test('una reconstrucción incompleta se detiene antes de entrenar splats', async t => {
  const store = await fixture(t), job = store.create({ title: 'Sin solapamiento', profile: 'quick' });
  await writeFile(join(store.dir(job.id), 'source.video'), 'original');
  const calls = [];
  await assert.rejects(pipeline(job, store, { ffprobe: 'probe', ffmpeg: 'frames', colmap: 'colmap', brush: 'brush' }, new AbortController().signal, async (command, args) => {
    calls.push(command);
    if (command === 'probe') return JSON.stringify({ format: { duration: '12' }, streams: [{ codec_type: 'video' }] });
    if (command === 'frames') for (let i = 1; i <= 10; i++) await writeFile(join(store.dir(job.id), 'work/images', `frame_${String(i).padStart(5, '0')}.jpg`), 'fixture');
    if (args[0] === 'mapper') await mkdir(join(store.dir(job.id), 'work/sparse/0'));
    if (args[0] === 'model_converter') await writeFile(join(args[args.indexOf('--output_path') + 1], 'images.txt'), Array.from({ length: 9 }, (_, i) => `${i + 1} 1 0 0 0 0 0 0 1 frame_${i}.jpg`).join('\n'));
    return '';
  }), /Solo se conectaron 9 de 10/);
  assert.ok(!calls.includes('brush')); assert.notEqual(store.get(job.id).status, 'ready');
});
