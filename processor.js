export function processorUrl(value, allowQuery = false) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Informe a URL HTTPS completa do processador.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (!allowQuery && url.search)) {
    throw new Error('O processador precisa usar HTTPS, sem credenciais ou fragmentos na URL.');
  }
  return url;
}

export function statusUrl(submitEndpoint, configured, response) {
  const submit = processorUrl(submitEndpoint);
  let value = configured || response.status_url || response.poll_url;
  if (!value && /\/submit\/?$/.test(submit.pathname)) {
    const sibling = new URL(submit);
    sibling.pathname = sibling.pathname.replace(/\/submit\/?$/, '/status');
    value = sibling.href;
  }
  if (!value) throw new Error('Análise aceita, mas sem endereço de acompanhamento. Configure job_processor_status_endpoint ou retorne status_url no processador. Não reenvie sem conferir o n8n.');
  const url = processorUrl(new URL(value, submit).href, true);
  if (url.origin !== submit.origin) throw new Error('O acompanhamento deve usar a mesma origem HTTPS do processador.');
  url.searchParams.set('analysis_id', String(response.analysis_id));
  return url.href;
}
