import { batchMatches } from './deliverables.js';

export function countProgress(payload, actual) {
  const deliverables = actual.length;
  const formats = actual.reduce((n, d) => n + (d.format_instances?.length || 0), 0);
  const expectedDeliverables = payload.deliverables.length;
  const expectedFormats = payload.deliverables.reduce((n, d) => n + d.format_instances.length, 0);
  return { deliverables, formats, expectedDeliverables, expectedFormats,
    percent: Math.min(100, Math.floor(100 * (deliverables + formats) / (expectedDeliverables + expectedFormats || 1))),
    verified: batchMatches(payload, actual) };
}

// Exactly one write. All retries are read-only, including after a POST timeout.
export async function observeBatch({payload, write, read, onProgress, signal,
  interval = 5000, maxDuration = 30 * 60 * 1000,
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  const started = now();
  let settled = false, writeError = '', last = countProgress(payload, []);
  Promise.resolve().then(write).then(() => { settled = true; }, error => {
    settled = true;
    writeError = error?.message || 'Sem resposta do envio';
  });
  while (now() - started < maxDuration) {
    if (signal?.aborted) throw new Error('Acompanhamento interrompido. Isso não cancela a gravação no servidor. Não reenvie o lote.');
    let actual;
    try { actual = await read(); }
    catch (error) {
      onProgress({...last, stale: true, readError: error.message, writeError});
      await sleep(interval);
      continue;
    }
    last = countProgress(payload, actual);
    onProgress({...last, stale: false, writeError});
    if (last.verified && settled) return actual;
    if (settled && !last.verified && last.deliverables >= last.expectedDeliverables && last.formats >= last.expectedFormats) {
      throw new Error('As quantidades foram atingidas, mas os dados gravados diferem da lista enviada. Confira o Job; não reenvie o lote.');
    }
    await sleep(interval);
  }
  throw new Error('O prazo de acompanhamento terminou sem confirmação integral. O servidor pode continuar processando. Use “Conferir gravação”, sem reenviar.');
}
