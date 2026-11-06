/**
 * File-backed Bridge registry snapshot for isolated tests and local server prototyping.
 *
 * NOT a production Render/Supabase datastore: host filesystems may be ephemeral;
 * this module provides no authentication, cross-process lock, or distributed CAS.
 * Do not expose its methods as network APIs.
 */
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BridgeRegistry } from './deviceRouting.mjs';

export class LocalBridgeSnapshotStore {
  constructor(filePath) {
    if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('invalid_path');
    this.filePath = filePath;
    this.#queue = Promise.resolve();
  }

  #queue;

  async load() {
    let raw;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return new BridgeRegistry();
      throw error;
    }
    // Corrupt state is fatal: never interpret malformed state as empty approvals.
    return BridgeRegistry.fromTrustedSnapshot(JSON.parse(raw));
  }

  /**
   * Serialize writes per instance and rename a complete snapshot atomically.
   * A caller must prevent other processes/instances from writing concurrently.
   */
  save(registry) {
    const operation = async () => {
      const snapshot = registry.snapshot();
      const folder = dirname(this.filePath);
      await mkdir(folder, { recursive: true });
      const temp = join(folder, '.' + basename(this.filePath) + '.' + randomUUID() + '.tmp');
      try {
        await writeFile(temp, JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 });
        await rename(temp, this.filePath);
      } catch (error) {
        await unlink(temp).catch(() => {});
        throw error;
      }
    };
    const pending = this.#queue.then(operation);
    this.#queue = pending.catch(() => {});
    return pending;
  }
}
