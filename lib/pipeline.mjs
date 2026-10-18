import { spawn } from 'node:child_process';
import { access, mkdir, readdir, readFile, writeFile, rm, copyFile, stat, open } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { readCameras, tourSettings, levelCameras } from './cameras.mjs';
import { defaultSettings } from '@playcanvas/supersplat-viewer/settings';

export const profiles = {
  quick: { steps: 3000, resolution: 1024, splats: 500000 },
  detailed: { steps: 10000, resolution: 1280, splats: 1000000 }
};
export const stages = ['inspect', 'frames', 'features', 'matching', 'mapping', 'training', 'prepare'];

export function toolsFor(root) {
  return {
    ffmpeg: process.env.FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg',
    ffprobe: process.env.FFPROBE_PATH || '/opt/homebrew/bin/ffprobe',
    colmap: process.env.COLMAP_PATH || '/opt/homebrew/bin/colmap',
    brush: process.env.BRUSH_PATH || join(root, '.tools/brush/brush-app-aarch64-apple-darwin/brush_app'),
    transform: join(root, 'node_modules/@playcanvas/splat-transform/bin/cli.mjs')
  };
}

export async function toolStatus(tools) {
  return Object.fromEntries(await Promise.all(Object.entries(tools).map(async ([name, path]) => {
    try { await access(path); return [name, true]; } catch { return [name, false]; }
  })));
}

export async function inspectSplat(file) {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString('latin1');
    const end = /end_header\r?\n/.exec(text);
    if (!text.startsWith('ply\n') && !text.startsWith('ply\r\n')) throw new Error('El archivo no es un PLY válido.');
    if (!end) throw new Error('No se encontró un encabezado PLY válido.');
    const header = text.slice(0, end.index), lines = header.split(/\r?\n/);
    const count = Number(/^element vertex (\d+)$/.exec(lines.find(l => l.startsWith('element vertex ')) || '')?.[1]);
    const properties = lines.filter(l => l.startsWith('property '));
    const names = new Set(properties.map(l => l.split(' ')[2]));
    const required = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
    if (!required.every(name => names.has(name))) throw new Error('Este PLY no contiene Gaussian Splats. Exporta como Splat PLY, no como malla o nube de puntos.');
    if (!lines.includes('format binary_little_endian 1.0') || properties.some(l => !/^property (float|float32) \w+$/.test(l)) || lines.filter(l => l.startsWith('element ')).length !== 1) {
      throw new Error('Usa un Splat PLY binario sin compresión. Puedes exportarlo así desde SuperSplat.');
    }
    if (!Number.isSafeInteger(count) || count < 1 || count > 2000000) throw new Error('El escaneo debe contener entre 1 y 2 millones de splats. Recórtalo en SuperSplat si supera el límite.');
    const minimum = end.index + end[0].length + count * properties.length * 4;
    if ((await handle.stat()).size < minimum) throw new Error('El archivo PLY está incompleto. Vuelve a exportarlo.');
    return count;
  } finally { await handle.close(); }
}

export function run(command, args, { cwd, signal, logFile, timeout = 60 * 60 * 1000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) return reject(new Error('Procesamiento cancelado'));
    const child = spawn(command, args, { cwd, shell: false, detached: process.platform !== 'win32', env: { ...process.env, QT_QPA_PLATFORM: 'offscreen' } });
    const log = logFile ? createWriteStream(logFile, { flags: 'a' }) : null;
    let tail = '', result = '', settled = false, killTimer;
    const append = chunk => {
      const text = chunk.toString().replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
      tail = (tail + text).slice(-12000);
      result = (result + text).slice(-1024 * 1024);
      log?.write(text);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    let stopped = false;
    const stop = () => {
      stopped = true;
      try { process.platform === 'win32' ? child.kill('SIGTERM') : process.kill(-child.pid, 'SIGTERM'); } catch {}
      killTimer = setTimeout(() => {
        try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {}
      }, 2000);
      killTimer.unref();
    };
    const timer = setTimeout(stop, timeout);
    signal?.addEventListener('abort', stop, { once: true });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(killTimer);
      signal?.removeEventListener('abort', stop);
      log?.end();
      error ? reject(error) : resolvePromise(value);
    };
    child.on('error', error => finish(error));
    child.on('close', code => {
      if (signal?.aborted) finish(new Error('Procesamiento cancelado'));
      else if (stopped) finish(new Error('Se superó el tiempo máximo de esta etapa'));
      else if (code !== 0) finish(new Error(`${command.split('/').pop()} terminó con código ${code}.\n${tail}`));
      else finish(null, result);
    });
  });
}

export async function pipeline(job, store, tools, signal, execute = run) {
  const dir = store.dir(job.id), work = join(dir, 'work'), output = join(dir, 'output');
  await rm(work, { recursive: true, force: true });
  await rm(output, { recursive: true, force: true });
  await mkdir(join(work, 'images'), { recursive: true });
  await mkdir(output, { recursive: true });
  const logFile = join(dir, 'process.log');
  await writeFile(logFile, `Inicio ${new Date().toISOString()}\n`);
  const update = (stage, extra = {}) => {
    if (signal.aborted) throw new Error('Procesamiento cancelado');
    store.update(job.id, { stage, ...extra });
  };
  const exec = (command, args, extra = {}) => execute(command, args, { cwd: dir, signal, logFile, ...extra });
  update('inspect');
  if (job.source === 'ply') {
    const source = join(dir, 'source.ply');
    const splatCount = await inspectSplat(source);
    update('prepare', { splatCount });
    await copyFile(source, join(output, 'scene.ply'));
    await exec(process.execPath, [tools.transform, '-g', 'cpu', source, '--filter-nan', '--filter-harmonics', '1', join(output, 'scene.sog')]);
    // Imported splats have no capture poses. The viewer frames their bounds automatically.
    const settings = defaultSettings();
    settings.cameras = []; settings.annotations = []; settings.startMode = 'default';
    await writeFile(join(output, 'settings.json'), JSON.stringify(settings, null, 2));
    update('ready', { status: 'ready', sceneBytes: (await stat(join(output, 'scene.sog'))).size, views: 0, completedAt: new Date().toISOString(), error: null });
    return;
  }
  const probe = JSON.parse(await exec(tools.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', join(dir, 'source.video')], { timeout: 30000 }));
  const duration = Number(probe.format?.duration);
  const video = probe.streams?.find(s => s.codec_type === 'video');
  if (!video || !Number.isFinite(duration) || duration < 5 || duration > 180) {
    throw new Error('Usa un video válido de entre 5 segundos y 3 minutos. Para el primer tour recomendamos 30–90 segundos.');
  }
  update('frames', { duration });
  const frames = join(work, 'images');
  await exec(tools.ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', join(dir, 'source.video'), '-an', '-vf', "fps=2,scale=w='min(1600,iw)':h='min(1600,ih)':force_original_aspect_ratio=decrease", '-q:v', '2', '-frames:v', '360', join(frames, 'frame_%05d.jpg')]);
  const frameCount = (await readdir(frames)).filter(f => f.endsWith('.jpg')).length;
  if (frameCount < 10) throw new Error('La captura produjo pocas imágenes. Graba un recorrido más largo.');
  await copyFile(join(frames, 'frame_00001.jpg'), join(output, 'poster.jpg'));
  update('features', { frameCount, hasPoster: true });
  const database = join(work, 'database.db');
  await exec(tools.colmap, ['feature_extractor', '--database_path', database, '--image_path', frames, '--ImageReader.single_camera', '1', '--ImageReader.camera_model', 'SIMPLE_RADIAL', '--FeatureExtraction.use_gpu', '0', '--FeatureExtraction.num_threads', '8', '--SiftExtraction.max_num_features', '4096']);
  update('matching');
  await exec(tools.colmap, ['sequential_matcher', '--database_path', database, '--FeatureMatching.use_gpu', '0', '--FeatureMatching.num_threads', '8', '--SequentialMatching.overlap', '15']);
  update('mapping');
  const sparse = join(work, 'sparse');
  await mkdir(sparse, { recursive: true });
  await exec(tools.colmap, ['mapper', '--database_path', database, '--image_path', frames, '--output_path', sparse, '--Mapper.num_threads', '8', '--Mapper.min_model_size', '10'], { timeout: 30 * 60 * 1000 });
  let best, bestPoses = [];
  for (const model of (await readdir(sparse)).filter(f => /^\d+$/.test(f))) {
    const text = join(work, `model-${model}`);
    await mkdir(text, { recursive: true });
    await exec(tools.colmap, ['model_converter', '--input_path', join(sparse, model), '--output_path', text, '--output_type', 'TXT']);
    // Original cameras include lens distortion, so count image records before undistortion.
    const count = (await readFile(join(text, 'images.txt'), 'utf8')).split('\n').filter(l => /^\d+\s+(?:[-\d.e+]+\s+){7}\d+\s+\S+/.test(l)).length;
    if (count > bestPoses.length) { best = model; bestPoses = Array(count); }
  }
  const registeredCount = bestPoses.length;
  if (!best || registeredCount < Math.max(10, Math.ceil(frameCount * 0.6))) {
    throw new Error(`Solo se conectaron ${registeredCount} de ${frameCount} imágenes. Repite la captura caminando despacio, con luz y solapamiento; evita girar desde un solo punto.`);
  }
  const warnings = [];
  if (registeredCount < frameCount * 0.9) warnings.push(`Se reconstruyeron ${registeredCount} de ${frameCount} imágenes; revisa posibles zonas faltantes.`);
  const dataset = join(work, 'dataset');
  await exec(tools.colmap, ['image_undistorter', '--image_path', frames, '--input_path', join(sparse, best), '--output_path', dataset, '--output_type', 'COLMAP', '--max_image_size', '1280']);
  const text = join(work, 'poses');
  await mkdir(text, { recursive: true });
  await exec(tools.colmap, ['model_converter', '--input_path', join(dataset, 'sparse'), '--output_path', text, '--output_type', 'TXT']);
  const { poses, rotations } = levelCameras(readCameras(await readFile(join(text, 'cameras.txt'), 'utf8'), await readFile(join(text, 'images.txt'), 'utf8')));
  await writeFile(join(output, 'settings.json'), JSON.stringify(tourSettings(poses), null, 2));
  update('training', { registeredCount, warnings });
  const profile = profiles[job.profile];
  await exec(tools.brush, [dataset, '--total-steps', String(profile.steps), '--max-resolution', String(profile.resolution), '--max-splats', String(profile.splats), '--export-every', String(profile.steps), '--export-path', output, '--export-name', 'scene.ply']);
  if ((await stat(join(output, 'scene.ply'))).size < 500) throw new Error('Brush no produjo una escena válida');
  update('prepare');
  // CPU compression keeps the delivery stage independent of a second GPU backend on macOS.
  await exec(process.execPath, [tools.transform, '-g', 'cpu', join(output, 'scene.ply'), ...rotations.flatMap(r => ['--rotate', r]), '--filter-nan', '--filter-harmonics', '1', join(output, 'scene.sog')]);
  const sceneBytes = (await stat(join(output, 'scene.sog'))).size;
  update('ready', { status: 'ready', sceneBytes, views: Math.min(8, poses.length), completedAt: new Date().toISOString(), error: null });
}

export class Queue {
  constructor(store, tools, processJob = pipeline) {
    this.store = store; this.tools = tools; this.processJob = processJob; this.active = null; this.stopping = false;
  }
  async kick() {
    if (this.active || this.stopping) return;
    const job = this.store.list().reverse().find(j => j.status === 'queued');
    if (!job) return;
    const controller = new AbortController();
    this.active = { id: job.id, controller };
    this.store.update(job.id, { status: 'processing', startedAt: new Date().toISOString(), error: null });
    try { await this.processJob(job, this.store, this.tools, controller.signal); }
    catch (error) {
      this.store.update(job.id, { status: controller.signal.aborted ? 'cancelled' : 'failed', error: controller.signal.aborted ? 'Procesamiento cancelado. Tu archivo se conserva.' : error.message.slice(-12000) });
    } finally { this.active = null; if (!this.stopping) void this.kick(); }
  }
  cancel(id) {
    const job = this.store.get(id);
    if (!job || !['queued', 'processing'].includes(job.status)) return false;
    if (this.active?.id === id) this.active.controller.abort();
    else this.store.update(id, { status: 'cancelled', error: 'Procesamiento cancelado. Tu archivo se conserva.' });
    return true;
  }
  stop() { this.stopping = true; this.active?.controller.abort(); }
}
