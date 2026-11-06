/**
 * Run an async worker over a list with a bounded number of in-flight tasks.
 * Results keep the input order.
 *
 * Used to avoid decoding every photo texture at the same time.
 */
export async function mapWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];

  const results = new Array(list.length);
  const size = Math.max(1, Math.min(Math.floor(limit) || 1, list.length));
  let cursor = 0;

  async function run() {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: size }, () => run()));
  return results;
}
