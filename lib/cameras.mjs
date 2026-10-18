import { defaultSettings, validateSettings } from '@playcanvas/supersplat-viewer/settings';

export function rotation([w, x, y, z]) {
  const norm = Math.hypot(w, x, y, z);
  if (!Number.isFinite(norm) || norm < 1e-10) throw new Error('Rotación de cámara inválida');
  [w, x, y, z] = [w, x, y, z].map(n => n / norm);
  return [
    [1 - 2 * (y*y + z*z), 2 * (x*y - z*w), 2 * (x*z + y*w)],
    [2 * (x*y + z*w), 1 - 2 * (x*x + z*z), 2 * (y*z - x*w)],
    [2 * (x*z - y*w), 2 * (y*z + x*w), 1 - 2 * (x*x + y*y)]
  ];
}

// COLMAP is world-to-camera (+Z forward). The viewer rotates splats by 180° around Z.
export function cameraPose(q, t, fov = 75) {
  const r = rotation(q);
  const center = [0, 1, 2].map(i => -(r[0][i]*t[0] + r[1][i]*t[1] + r[2][i]*t[2]));
  const flip = ([x, y, z]) => [-x, -y, z];
  return { position: flip(center), target: flip(center.map((n, i) => n + r[2][i])), fov };
}

export function readCameras(cameraText, imageText) {
  const cameras = new Map();
  for (const line of cameraText.split('\n').filter(l => l.trim() && !l.startsWith('#'))) {
    const [id, model, width, height, ...params] = line.trim().split(/\s+/);
    if (!['PINHOLE', 'SIMPLE_PINHOLE'].includes(model)) throw new Error('Se requieren cámaras sin distorsión');
    const fy = Number(params[model === 'PINHOLE' ? 1 : 0]);
    cameras.set(id, 2 * Math.atan(Number(height) / (2 * fy)) * 180 / Math.PI);
  }
  const result = [];
  const lines = imageText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const fields = line.split(/\s+/);
    if (fields.length < 10) throw new Error('Registro de cámara incompleto');
    const values = fields.slice(1, 8).map(Number);
    if (values.some(n => !Number.isFinite(n))) throw new Error('Posición de cámara inválida');
    const fov = cameras.get(fields[8]);
    if (!Number.isFinite(fov) || fov <= 0 || fov >= 180) throw new Error('Cámara no encontrada');
    result.push({ name: fields.slice(9).join(' '), down: rotation(values.slice(0, 4))[1], ...cameraPose(values.slice(0, 4), values.slice(4), fov) });
    i++; // The next line contains 2D observations, including an empty line when none exist.
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export function levelCameras(poses) {
  // COLMAP has an arbitrary world orientation. Estimate vertical from the captured cameras
  // and rotate both the splats and viewpoints together; the viewer itself applies Rz(180).
  const down = [0, 1, 2].map(i => poses.reduce((sum, p) => sum + p.down[i], 0) / poses.length);
  if (Math.hypot(...down) < 0.1) throw new Error('No se pudo estimar la orientación. Conserva el teléfono en la misma orientación durante la captura.');
  const z = Math.atan2(down[0], down[1]), x = -Math.atan2(down[2], Math.hypot(down[0], down[1]));
  const rotate = ([a, b, c]) => {
    const u = a * Math.cos(z) - b * Math.sin(z), v = a * Math.sin(z) + b * Math.cos(z);
    return [u, v * Math.cos(x) - c * Math.sin(x), v * Math.sin(x) + c * Math.cos(x)];
  };
  const flip = ([a, b, c]) => [-a, -b, c];
  return {
    // SplatTransform's CLI rotates in PlayCanvas space, after its PLY Rz(180) conversion.
    // Conjugating our raw-space rotation by that conversion reverses the X angle.
    rotations: [`0,0,${z * 180 / Math.PI}`, `${-x * 180 / Math.PI},0,0`],
    poses: poses.map(p => ({ ...p, down: rotate(p.down), position: flip(rotate(flip(p.position))), target: flip(rotate(flip(p.target))) }))
  };
}

export function tourSettings(poses) {
  if (poses.length < 3) throw new Error('No hay suficientes cámaras conectadas para un recorrido');
  const settings = defaultSettings();
  settings.tonemapping = 'none';
  settings.cameras = [{ initial: { position: poses[0].position, target: poses[0].target, fov: poses[0].fov } }];
  const count = Math.min(8, poses.length);
  settings.annotations = Array.from({ length: count }, (_, i) => {
    const p = poses[Math.round(i * (poses.length - 1) / (count - 1))];
    return { title: `Vista ${i + 1}`, text: 'Punto de vista de la captura.', position: p.target, camera: { initial: { position: p.position, target: p.target, fov: p.fov } } };
  });
  // Keep the first version on captured viewpoints: interpolated paths can cross walls.
  settings.startMode = 'annotation';
  validateSettings(settings);
  return settings;
}
