/**
 * Bounded streaming receiver for future authenticated Bridge read jobs.
 * This module deliberately performs no network or storage access by itself.
 * readChunk must be scoped to a live authenticated grant and job.
 */
import {validateBridgeFileChunk, BRIDGE_FILE_LIMITS} from '../src/bridgeFileProtocol.js';

function decodeBase64(value) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
  const binary = atob(value);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

export async function receiveBridgeFile({
  size, readChunk, write, commit, discard, signal,
  chunkBytes = 65536, onProgress = () => {}
}) {
  if (!Number.isSafeInteger(size) || size < 0 || size > BRIDGE_FILE_LIMITS.maxFileBytes ||
      !Number.isSafeInteger(chunkBytes) || chunkBytes < 1 ||
      chunkBytes > BRIDGE_FILE_LIMITS.maxChunkBytes ||
      [readChunk, write, commit, discard, onProgress].some(fn => typeof fn !== 'function'))
    throw Error('bridge_receiver_invalid_options');
  let offset = 0, committed = false;
  try {
    while (offset < size) {
      if (signal?.aborted) throw Error('bridge_transfer_cancelled');
      const length = Math.min(chunkBytes, size - offset);
      const response = await readChunk({offset, length});
      if (signal?.aborted) throw Error('bridge_transfer_cancelled');
      const chunk = validateBridgeFileChunk(response, length);
      if (chunk.bytesRead !== length || (chunk.eof && offset + length !== size))
        throw Error('bridge_transfer_truncated');
      const bytes = decodeBase64(chunk.base64);
      if (bytes.byteLength !== length) throw Error('bridge_transfer_corrupt');
      await write(bytes, offset);
      offset += bytes.byteLength;
      onProgress({receivedBytes:offset,totalBytes:size});
    }
    if (signal?.aborted) throw Error('bridge_transfer_cancelled');
    await commit();
    committed = true;
    return {bytesReceived:offset};
  } finally {
    if (!committed) await discard();
  }
}
