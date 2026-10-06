export function buildBatch(job, items, catalog, statuses) {
  if (!job || job.active === false || job.readonly || job.view_only || job.locked) throw new Error("Este Job está inativo, bloqueado ou disponível somente para leitura.");
  const services = [...new Set((job.job_services || []).map(s => Number(s.service_id)).filter(n => Number.isInteger(n) && n > 0))];
  if (services.length !== 1) throw new Error("O Job precisa ter um único serviço vinculado para esta criação.");
  const waiting = statuses.filter(s => s.status_type === "waiting" && s.active !== false);
  if (waiting.length !== 1) throw new Error("Não foi possível identificar um único status inicial de espera para o cliente.");
  if (!items.length) throw new Error("Inclua ao menos um entregável.");
  const validIds = new Set(catalog.filter(c => c.active !== false).map(c => Number(c.deliverable_id)));
  const deliverables = items.map((item, index) => {
    const title = String(item.deliverable || "").trim();
    if (!title || title.length > 255) throw new Error(`Entregável ${index + 1}: informe um título de até 255 caracteres.`);
    if (!validIds.has(Number(item.deliverable_id))) throw new Error(`“${title}”: selecione um título do catálogo do cliente.`);
    if (!item.formats?.length) throw new Error(`“${title}”: inclua ao menos um formato.`);
    return {
      base_instance: { base_instance_id: null, service_id: services[0], deliverable_id: Number(item.deliverable_id),
        base_title: title, base_spec: [item.type ? `Tipo de mídia: ${item.type.trim()}` : "", String(item.description || "").trim()].filter(Boolean).join("\n\n"),
        status_id: Number(waiting[0].status_id), rate_card_id: null },
      format_instances: item.formats.map((format, fi) => {
        const dimensions = String(format.format || "").trim();
        const formatTitle = String(format.spec || "").trim();
        if (!dimensions || dimensions.length > 255) throw new Error(`“${title}”, formato ${fi + 1}: preencha as dimensões com até 255 caracteres.`);
        if (!formatTitle || formatTitle.length > 255) throw new Error(`“${title}”, formato ${fi + 1}: preencha o título/especificação com até 255 caracteres. O texto não será cortado automaticamente.`);
        return { format_instance: { format_instance_id: null, base_instance_id: null, status_id: Number(waiting[0].status_id),
          format_title: formatTitle, format_desc: dimensions, quantity: 1 },
          job_deliver: { job_deliver_id: null, quantity: 1 }, billable_instances: [] };
      }),
    };
  });
  return { job_id: Number(job.job_id), deliverables };
}

// Ignore generated IDs and timestamps, but verify every field we own and all counts.
export function batchMatches(expected, actual) {
  if (!Array.isArray(actual) || actual.length !== expected.deliverables.length) return false;
  const signature = item => JSON.stringify({
    service: Number(item.base_instance?.service_id), type: Number(item.base_instance?.deliverable_id),
    title: item.base_instance?.base_title, spec: item.base_instance?.base_spec || "",
    status: Number(item.base_instance?.status_id),
    formats: (item.format_instances || []).map(f => JSON.stringify({
      title: f.format_instance?.format_title, dimensions: f.format_instance?.format_desc,
      status: Number(f.format_instance?.status_id), quantity: Number(f.format_instance?.quantity),
      deliveryQuantity: Number(f.job_deliver?.quantity), spec: f.job_deliver?.spec || "",
    })).sort(),
  });
  if (!actual.every(item => Number(item.base_instance?.base_instance_id) > 0 && item.format_instances?.every(f => Number(f.format_instance?.format_instance_id) > 0 && Number(f.job_deliver?.job_deliver_id) > 0))) return false;
  return JSON.stringify(expected.deliverables.map(signature).sort()) === JSON.stringify(actual.map(signature).sort());
}
