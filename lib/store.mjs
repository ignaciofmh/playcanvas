import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const validId = id => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
export const terminal = new Set(['ready', 'failed', 'cancelled']);

export class Store {
  constructor(root) {
    this.root = root;
    this.jobs = new Map();
    mkdirSync(root, { recursive: true });
    for (const id of readdirSync(root).filter(validId)) {
      const file = join(root, id, 'job.json');
      if (!existsSync(file)) continue;
      const job = JSON.parse(readFileSync(file, 'utf8'));
      if (job.id !== id) throw new Error(`Registro inconsistente: ${id}`);
      this.jobs.set(id, job);
      if (['uploading', 'processing'].includes(job.status)) {
        this.update(id, { status: 'failed', error: 'El servidor se reinició. Puedes volver a procesar si la carga había terminado.' });
      }
    }
  }

  dir(id) {
    if (!validId(id)) throw new Error('Identificador inválido');
    return join(this.root, id);
  }

  create({ title, profile, source = 'video' }) {
    const id = randomUUID();
    const job = { id, title, profile, source, status: 'uploading', stage: 'upload', createdAt: new Date().toISOString(), warnings: [] };
    mkdirSync(this.dir(id), { recursive: true });
    this.jobs.set(id, job);
    this.update(id, {});
    return this.get(id);
  }

  get(id) { return this.jobs.has(id) ? structuredClone(this.jobs.get(id)) : null; }
  list() { return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(job => structuredClone(job)); }

  update(id, patch) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Tour inexistente');
    const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
    const file = join(this.dir(id), 'job.json');
    writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2));
    renameSync(`${file}.tmp`, file);
    this.jobs.set(id, next);
    return structuredClone(next);
  }
}
