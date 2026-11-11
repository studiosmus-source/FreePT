/** Retry only gateway throttling. TX poll can atomically claim jobs, so a lost
 * response (network failure or upstream 5xx) has an UNKNOWN outcome and must
 * never be automatically replayed. */
export async function bridgePollRetry(send, {
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  maxAttempts = 4
} = {}) {
  if (typeof send !== 'function' || typeof pause !== 'function' ||
      !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5)
    throw Error('bridge_poll_retry_invalid_options');
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await send();
    if (response?.status !== 429 || attempt === maxAttempts - 1)
      return response;
    await pause(Math.min(8000, 1200 * (2 ** attempt)));
  }
}
