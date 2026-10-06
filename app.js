import { buildBatch, batchMatches } from "./deliverables.js";
import { observeBatch, countProgress } from "./save-progress.js";
import { deployment } from "./config.js";
import { processorUrl, statusUrl } from "./processor.js";

const API = {
  job: "https://jamworks20-job.vati.rocks",
  business: "https://jamworks20-business.vati.rocks",
  node: "https://jamworks20-node.vati.rocks",
};

const state = {
  token: "",
  job: null,
  references: [],
  selectedSpreadsheetNodeId: null,
  analysisId: null,
  deliverables: [],
  polling: false,
  busy: false,
  catalog: [],
  submittedJobs: new Map(),
  approvedProcessors: new Set(),
  analysisStatusUrl: "",
};

const $ = (selector, root = document) => root.querySelector(selector);
const elements = {
  session: $("#session-status"),
  sessionLabel: $("#session-label"),
  authNotice: $("#auth-notice"),
  jobForm: $("#job-form"),
  jobId: $("#job-id"),
  loadJobButton: $("#load-job-button"),
  spreadsheetStep: $("#spreadsheet-step"),
  spreadsheetNodeId: $("#spreadsheet-node-id"),
  referenceList: $("#reference-list"),
  analysisStep: $("#analysis-step"),
  analyzeButton: $("#analyze-button"),
  analysisProgress: $("#analysis-progress"),
  progressTitle: $("#progress-title"),
  progressCopy: $("#progress-copy"),
  n8nBaseUrl: $("#n8n-base-url"),
  processorStatusEndpoint: $("#processor-status-endpoint"),
  emptyState: $("#empty-state"),
  jobView: $("#job-view"),
  jobCode: $("#job-code"),
  jobTitle: $("#job-title"),
  jobStatus: $("#job-status"),
  jobFacts: $("#job-facts"),
  resultsView: $("#results-view"),
  deliverableCount: $("#deliverable-count"),
  deliverablesList: $("#deliverables-list"),
  addDeliverableButton: $("#add-deliverable-button"),
  copyJsonButton: $("#copy-json-button"),
  downloadJsonButton: $("#download-json-button"),
  saveButton: $("#save-button"),
  verifyButton: $("#verify-button"),
  saveStatus: $("#save-status"),
  saveProgress: $("#save-progress"),
  saveProgressBar: $("#save-progress-bar"),
  saveProgressCounts: $("#save-progress-counts"),
  stopMonitoringButton: $("#stop-monitoring-button"),
  catalogStatus: $("#catalog-status"),
  retryCatalogButton: $("#retry-catalog-button"),
  toast: $("#toast"),
};

function readRuntimeConfig() {
  document.documentElement.classList.toggle("embedded", window.self !== window.top);
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  state.token = url.searchParams.get("token") || hash.get("token") || "";

  // Jobs and reference Nodes are always selected in the interface.
  elements.jobId.value = "";
  elements.spreadsheetNodeId.value = "";
  elements.n8nBaseUrl.value = url.searchParams.get("job_processor_endpoint") || deployment.jobProcessorEndpoint;
  elements.processorStatusEndpoint.value = url.searchParams.get("job_processor_status_endpoint") || deployment.jobProcessorStatusEndpoint;

  if (url.searchParams.has("token") || hash.has("token")) {
    url.searchParams.delete("token");
    hash.delete("token");
    url.hash = hash.toString();
    history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }

  elements.session.classList.toggle("ready", Boolean(state.token));
  elements.session.classList.toggle("error", !state.token);
  elements.sessionLabel.textContent = state.token ? "Sessão Jamworks ativa" : "Sessão necessária";
  elements.authNotice.classList.toggle("hidden", Boolean(state.token));
}

async function apiFetch(url, options = {}) {
  if (!state.token) throw new Error("A sessão do Jamworks não está disponível.");
  const response = await fetch(url, {
    signal: AbortSignal.timeout(60000),
    ...options,
    headers: {
      Accept: "application/json",
      token: state.token,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!response.ok) {
    const message = body?.message || body?.error?.message || `A chamada falhou com status ${response.status}.`;
    throw new Error(message);
  }
  return body;
}

function normalizeEnvelope(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function isSpreadsheet(node) {
  return [node?.name, node?.external_id].some(value => /\.(xlsx|xls|csv|ods)(\?|$)/i.test(String(value || "").trim()));
}

function formatDate(value) {
  if (!value) return "Não informado";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(date);
}

async function loadJob(jobId) {
  if (state.busy) return;
  state.busy = true;
  setBusy(elements.loadJobButton, true, "Carregando…");
  elements.resultsView.classList.add("hidden");
  state.job = null;
  state.deliverables = [];
  state.catalog = [];
  elements.jobView.classList.add("hidden");
  elements.emptyState.classList.remove("hidden");
  setWorkflowLocked(true);
  elements.analysisStep.classList.add("disabled");
  elements.spreadsheetStep.classList.add("disabled");
  try {
    const job = await apiFetch(`${API.job}/job/${encodeURIComponent(jobId)}`);
    state.job = job;
    state.deliverables = [];
    renderJob(job);
    await Promise.all([loadReferences(job.ref_folder_id), loadCatalog()]);
    elements.spreadsheetStep.classList.remove("disabled");
    elements.analysisStep.classList.remove("disabled");
    if (elements.spreadsheetNodeId.value) selectSpreadsheet(Number(elements.spreadsheetNodeId.value));
    renderDeliverables();
    toast("Job e referências carregados.");
  } catch (error) {
    showError(error);
  } finally {
    state.busy = false;
    setBusy(elements.loadJobButton, false, "Carregar");
    setWorkflowLocked(false);
  }
}

async function fetchAll(url, idKey) {
  const items = [];
  const seen = new Set();
  for (let page = 0; page < 100; page++) {
    const payload = await apiFetch(`${url}${url.includes("?") ? "&" : "?"}offset=${items.length}&limit=1000&order=${idKey}&direction=ASC`);
    if (!Array.isArray(payload?.items)) throw new Error("O catálogo retornou uma resposta inesperada.");
    for (const item of payload.items) {
      const id = Number(item[idKey]);
      if (!Number.isInteger(id) || id <= 0 || seen.has(id)) throw new Error("A paginação do catálogo está incompleta ou inconsistente.");
      seen.add(id);
      items.push(item);
    }
    const total = Number(payload.total);
    if (payload.total != null && Number.isFinite(total) && items.length >= total) return items;
    if (!payload.items.length) {
      if (payload.total != null && items.length < total) throw new Error("O catálogo retornou uma página incompleta.");
      return items;
    }
  }
  throw new Error("O catálogo excedeu o limite de paginação; gravação interrompida.");
}

async function loadCatalog() {
  elements.catalogStatus.textContent = "Carregando títulos do cliente…";
  elements.retryCatalogButton.classList.add("hidden");
  try {
    state.catalog = (await fetchAll(`${API.business}/deliverable/customer/${state.job.customer_id}?filter[active]=true`, "deliverable_id"))
      .filter(item => item.active !== false).sort((a, b) => a.deliverable_title.localeCompare(b.deliverable_title, "pt-BR"));
    elements.catalogStatus.textContent = `${state.catalog.length} títulos do cliente disponíveis. Compare o catálogo com o tipo de mídia sugerido.`;
  } catch (error) {
    state.catalog = [];
    elements.catalogStatus.textContent = `Catálogo indisponível: ${error.message} As sugestões continuam editáveis, mas não podem ser gravadas.`;
    elements.retryCatalogButton.classList.remove("hidden");
  }
}

function renderJob(job) {
  elements.emptyState.classList.add("hidden");
  elements.jobView.classList.remove("hidden");
  elements.jobCode.textContent = `JOB ${job.job_id}`;
  elements.jobTitle.textContent = job.job_title || job.name || `Job ${job.job_id}`;
  elements.jobStatus.textContent = job.readonly ? "Somente leitura" : "Disponível";
  const facts = [
    ["Cliente", job.customer_id ?? "—"],
    ["Código", job.job_customer_code || job.external_id || "—"],
    ["Prazo", formatDate(job.deadline || job.end_date)],
    ["Pasta de referências", job.ref_folder_id || "—"],
  ];
  elements.jobFacts.innerHTML = facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join("");
}

async function loadReferences(folderId) {
  state.references = [];
  elements.referenceList.innerHTML = '<p class="list-message">Buscando planilhas na pasta de referências…</p>';
  try {
    const [children, links] = await Promise.all([
      folderId ? fetchAll(`${API.node}/node/${encodeURIComponent(folderId)}/list`, "node_id") : [],
      fetchAll(`${API.job}/job/${state.job.job_id}/job-files/type/1`, "job_file_id"),
    ]);
    const byId = new Map(children.map(node => [Number(node.node_id), node]));
    for (const link of links) {
      if (Number(link.job_id) !== Number(state.job.job_id) || Number(link.job_file_type) !== 1) throw new Error("Referência fora do contexto do Job.");
      if (!byId.has(Number(link.node_id))) {
        const node = await apiFetch(`${API.node}/node/${encodeURIComponent(link.node_id)}`);
        byId.set(Number(node.node_id), node);
      }
    }
    state.references = [...byId.values()].filter(isSpreadsheet);
    renderReferences();
  } catch (error) {
    elements.referenceList.innerHTML = `<p class="list-message">Não foi possível listar as referências: ${escapeHtml(error.message)}. O Node ID manual continua disponível.</p>`;
  }
}

function renderReferences() {
  if (!state.references.length) {
    elements.referenceList.innerHTML = '<p class="list-message">Nenhuma planilha reconhecida nesta pasta. Use o Node ID manual.</p>';
    return;
  }
  elements.referenceList.innerHTML = state.references.map((node) => `
    <button type="button" class="reference-card ${Number(node.node_id) === state.selectedSpreadsheetNodeId ? "selected" : ""}" data-node-id="${Number(node.node_id)}">
      <span class="file-icon">XLS</span>
      <span><strong>${escapeHtml(node.name || `Node ${node.node_id}`)}</strong><small>Node ${Number(node.node_id)}</small></span>
      <span class="check">✓</span>
    </button>`).join("");
}

function selectSpreadsheet(nodeId) {
  const parsed = Number(nodeId);
  state.selectedSpreadsheetNodeId = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  elements.spreadsheetNodeId.value = state.selectedSpreadsheetNodeId || "";
  renderReferences();
}

async function startAnalysis() {
  if (state.busy || state.submittedJobs.has(Number(state.job?.job_id))) return;
  const jobId = Number(state.job?.job_id);
  const spreadsheetNodeId = Number(elements.spreadsheetNodeId.value || state.selectedSpreadsheetNodeId);
  if (!Number.isInteger(jobId) || !Number.isInteger(spreadsheetNodeId) || spreadsheetNodeId <= 0) {
    showError(new Error("Selecione uma planilha ou informe um Node ID válido."));
    return;
  }

  setAnalysisProgress(true, "Enviando análise", "O n8n está registrando a solicitação.");
  state.busy = true;
  setWorkflowLocked(true);
  setBusy(elements.analyzeButton, true, "Análise em andamento…");
  try {
    if (!state.token) throw new Error("Abra a Home com a sessão autenticada do Jamworks.");
    const endpoint = processorUrl(elements.n8nBaseUrl.value.trim());
    const configuredStatus = elements.processorStatusEndpoint.value.trim();
    if (configuredStatus) statusUrl(endpoint.href, configuredStatus, { analysis_id: "validation" });
    if (!deployment.allowedProcessorOrigins.includes(endpoint.origin) && !state.approvedProcessors.has(endpoint.href)) {
      if (!window.confirm(`Autorizar este processador nesta sessão?\n\n${endpoint.href}\n\nEle receberá seu token Jamworks e os IDs do Job e da planilha. Confirme apenas se este destino pertence à sua integração.`)) {
        setAnalysisProgress(false);
        setBusy(elements.analyzeButton, false, "Gerar sugestões");
        return;
      }
      state.approvedProcessors.add(endpoint.href);
    }
    const response = await fetch(endpoint.href, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json", token: state.token },
      body: JSON.stringify({ job_id: jobId, spreadsheet_node_id: spreadsheetNodeId }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.analysis_id) throw new Error(body?.error?.message || body?.message || "A análise não foi aceita pelo n8n.");
    state.analysisId = body.analysis_id;
    state.analysisStatusUrl = statusUrl(endpoint.href, configuredStatus, body);
    await pollAnalysis(body.poll_after_ms || 3000);
  } catch (error) {
    state.polling = false;
    setAnalysisProgress(false);
    setBusy(elements.analyzeButton, false, "Gerar sugestões");
    showError(error);
  } finally {
    state.busy = false;
    setWorkflowLocked(false);
  }
}

async function pollAnalysis(initialDelay) {
  state.polling = true;
  const startedAt = Date.now();
  let delay = Math.max(1500, Number(initialDelay) || 3000);
  await wait(delay);

  while (state.polling && Date.now() - startedAt < 16 * 60 * 1000) {
    const response = await fetch(state.analysisStatusUrl, { cache: "no-store", redirect: "error" });
    if (!response.ok) throw new Error(`Falha ao consultar a análise (${response.status}).`);
    const body = await response.json().catch(() => ({}));
    if (body.status === "completed") {
      state.polling = false;
      state.deliverables = Array.isArray(body.result?.deliverables) ? structuredClone(body.result.deliverables) : [];
      setAnalysisProgress(false);
      setBusy(elements.analyzeButton, false, "Gerar novamente");
      renderDeliverables();
      elements.resultsView.scrollIntoView({ behavior: "smooth", block: "start" });
      toast("Sugestões geradas. Revise antes de utilizar.");
      return;
    }
    if (body.status === "failed" || body.status === "not_found") {
      throw new Error(body?.error?.message || "A análise não pôde ser concluída.");
    }
    elements.progressTitle.textContent = body.stage || "Analisando a planilha";
    elements.progressCopy.textContent = `Análise ${state.analysisId}. Você pode continuar nesta tela enquanto processamos.`;
    delay = Math.min(Math.round(delay * 1.18), 9000);
    await wait(delay);
  }
  state.polling = false;
  throw new Error("A análise excedeu o tempo máximo de acompanhamento desta tela.");
}

function setAnalysisProgress(visible, title = "", copy = "") {
  elements.analysisProgress.classList.toggle("hidden", !visible);
  if (title) elements.progressTitle.textContent = title;
  if (copy) elements.progressCopy.textContent = copy;
}

function renderDeliverables() {
  const position = { left: window.scrollX, top: window.scrollY };
  const focused = document.activeElement;
  const focusedCard = focused?.closest?.("[data-deliverable-index]");
  const focusedRow = focused?.closest?.("[data-format-index]");
  const focusSelector = focusedCard && focused.dataset.action
    ? `[data-deliverable-index="${Number(focusedCard.dataset.deliverableIndex)}"] ${focusedRow ? `[data-format-index="${Number(focusedRow.dataset.formatIndex)}"] ` : ""}[data-action="${focused.dataset.action}"]` : null;
  elements.resultsView.classList.remove("hidden");
  elements.deliverableCount.textContent = String(state.deliverables.length);
  elements.deliverablesList.innerHTML = state.deliverables.map((item, index) => deliverableTemplate(item, index)).join("");
  setWorkflowLocked(state.busy);
  if (focusSelector) elements.deliverablesList.querySelector(focusSelector)?.focus({ preventScroll: true });
  window.scrollTo({ ...position, behavior: "instant" });
}

function deliverableTemplate(item, index) {
  const formats = Array.isArray(item.formats) ? item.formats : [];
  return `
    <article class="deliverable-card" data-deliverable-index="${index}">
      <header>
        <label class="field"><span>Título sugerido</span><input data-field="deliverable" value="${escapeAttribute(item.deliverable || "")}" /></label>
        <label class="field"><span>Tipo de mídia</span><input data-field="type" value="${escapeAttribute(item.type || "")}" /></label>
        <label class="field"><span>Entregável do cliente</span><select data-field="deliverable_id" aria-label="Entregável do cliente" class="${!state.catalog.some(c => Number(c.deliverable_id) === Number(item.deliverable_id)) ? "unmapped" : ""}">
          <option value="">Selecione um título…</option>
          ${item.deliverable_id && !state.catalog.some(c => Number(c.deliverable_id) === Number(item.deliverable_id)) ? '<option value="' + escapeAttribute(item.deliverable_id) + '" selected disabled>Mapeamento indisponível — revise</option>' : ""}
          ${state.catalog.map(c => `<option value="${Number(c.deliverable_id)}" ${Number(item.deliverable_id) === Number(c.deliverable_id) ? "selected" : ""}>${escapeHtml(c.deliverable_title)}</option>`).join("")}
        </select></label>
        <div class="card-actions">
          <button type="button" class="icon-button" data-action="duplicate" title="Duplicar">⧉</button>
          <button type="button" class="icon-button remove" data-action="remove" title="Excluir">×</button>
        </div>
      </header>
      <div class="deliverable-body">
        <label class="field"><span>Instruções gerais</span><textarea data-field="description">${escapeHtml(item.description || "")}</textarea></label>
        <div class="formats-heading"><h3>${formats.length} formatos</h3><button type="button" class="link-button" data-action="add-format">+ Adicionar formato</button></div>
        <div class="formats">${formats.map((format, formatIndex) => formatTemplate(format, formatIndex)).join("")}</div>
      </div>
    </article>`;
}

function formatTemplate(format, index) {
  return `<div class="format-row" data-format-index="${index}">
    <input data-format-field="format" aria-label="Formato" value="${escapeAttribute(format.format || "")}" placeholder="Dimensões" />
    <input data-format-field="spec" aria-label="Título do formato / especificação" value="${escapeAttribute(format.spec || "")}" placeholder="Título do formato: mídia, duração, instruções…" />
    <button type="button" class="icon-button remove" data-action="remove-format" title="Excluir formato">×</button>
  </div>`;
}

function updateDeliverableFromInput(target) {
  if (state.busy || state.submittedJobs.has(Number(state.job?.job_id))) return;
  const card = target.closest("[data-deliverable-index]");
  if (!card) return;
  const item = state.deliverables[Number(card.dataset.deliverableIndex)];
  if (!item) return;
  if (target.dataset.field) {
    item[target.dataset.field] = target.dataset.field === "deliverable_id" ? (target.value ? Number(target.value) : null) : target.value;
    if (target.dataset.field === "deliverable_id") target.classList.toggle("unmapped", !target.value);
  }
  const formatRow = target.closest("[data-format-index]");
  if (formatRow && target.dataset.formatField) {
    item.formats[Number(formatRow.dataset.formatIndex)][target.dataset.formatField] = target.value;
  }
}

function handleDeliverableAction(button) {
  if (state.busy || state.submittedJobs.has(Number(state.job?.job_id))) return;
  const card = button.closest("[data-deliverable-index]");
  if (!card) return;
  const itemIndex = Number(card.dataset.deliverableIndex);
  const action = button.dataset.action;
  if (action === "remove") state.deliverables.splice(itemIndex, 1);
  if (action === "duplicate") state.deliverables.splice(itemIndex + 1, 0, structuredClone(state.deliverables[itemIndex]));
  if (action === "add-format") state.deliverables[itemIndex].formats.push({ format: "", spec: "" });
  if (action === "remove-format") {
    const row = button.closest("[data-format-index]");
    state.deliverables[itemIndex].formats.splice(Number(row.dataset.formatIndex), 1);
  }
  renderDeliverables();
}

function addDeliverable() {
  if (state.busy || state.submittedJobs.has(Number(state.job?.job_id))) return;
  state.deliverables.push({ deliverable: "Novo entregável", description: "", deliverable_id: null, type: "", formats: [{ format: "", spec: "" }] });
  renderDeliverables();
}

function exportPayload() {
  return { deliverables: state.deliverables.map((item) => ({
    deliverable: String(item.deliverable || "").trim(),
    description: String(item.description || "").trim(),
    deliverable_id: item.deliverable_id ? Number(item.deliverable_id) : null,
    type: String(item.type || "").trim(),
    formats: (item.formats || []).map((format) => ({ format: String(format.format || "").trim(), spec: String(format.spec || "").trim() })),
  })) };
}

function setWorkflowLocked(busy) {
  const submission = state.submittedJobs.get(Number(state.job?.job_id));
  const locked = busy || Boolean(submission);
  elements.loadJobButton.disabled = busy;
  elements.jobId.disabled = busy;
  elements.analyzeButton.disabled = locked;
  elements.addDeliverableButton.disabled = locked;
  elements.retryCatalogButton.disabled = busy;
  elements.saveButton.disabled = locked || !state.catalog.length || !state.deliverables.length || Boolean(state.job?.readonly || state.job?.view_only || state.job?.locked);
  elements.verifyButton.disabled = busy;
  elements.verifyButton.classList.toggle("hidden", !submission || submission.verified);
  elements.saveStatus.textContent = submission?.message || "Criação em Job sem entregáveis. Quantidade: 1 por formato. Sem inclusão de preços ou itens de cobrança. Nenhum dado é gravado antes da confirmação.";
  renderSaveProgress(submission);
  elements.deliverablesList.querySelectorAll("input, textarea, select, button").forEach(control => { control.disabled = locked; });
}

function renderSaveProgress(submission) {
  const progress = submission?.progress;
  elements.saveProgress.classList.toggle("hidden", !progress);
  elements.stopMonitoringButton.classList.toggle("hidden", !submission?.monitoring);
  elements.stopMonitoringButton.disabled = Boolean(submission?.controller?.signal.aborted);
  if (!progress) return;
  elements.saveProgressBar.value = progress.percent;
  elements.saveProgressCounts.textContent = `${progress.deliverables}/${progress.expectedDeliverables} entregáveis · ${progress.formats}/${progress.expectedFormats} formatos · ${progress.percent}% dos itens visíveis${progress.stale ? " (última leitura; tentando atualizar)" : ""}${progress.verified ? " — dados conferidos ✓" : " — conferência final pendente"}`;
}

async function readJobDeliverables(jobId) {
  const result = await apiFetch(`${API.job}/deliverable/batch-read/${jobId}`, { cache: "no-store" });
  if (!Array.isArray(result)) throw new Error("Não foi possível confirmar a lista completa de entregáveis do Job.");
  return result;
}

async function verifySubmission() {
  if (state.busy) return;
  const submission = state.submittedJobs.get(Number(state.job?.job_id));
  if (!submission) return;
  state.busy = true;
  setWorkflowLocked(true);
  try {
    await verifySavedBatch(submission);
  } catch (error) {
    submission.message = `Gravação sem confirmação: ${error.message} Não reenvie a lista; confira o Job no Jamworks ou tente apenas a conferência novamente.`;
    showError(new Error(submission.message));
  } finally {
    state.busy = false;
    setWorkflowLocked(false);
  }
}

async function verifySavedBatch(submission) {
  const actual = await readJobDeliverables(submission.payload.job_id);
  submission.progress = countProgress(submission.payload, actual);
  renderSaveProgress(submission);
  if (!batchMatches(submission.payload, actual)) {
    const expectedFormats = submission.payload.deliverables.reduce((n, d) => n + d.format_instances.length, 0);
    const actualFormats = actual.reduce((n, d) => n + (d.format_instances?.length || 0), 0);
    throw new Error(`A releitura ainda não corresponde integralmente à lista enviada (${actual.length}/${submission.payload.deliverables.length} entregáveis; ${actualFormats}/${expectedFormats} formatos). O servidor pode estar processando o lote.`);
  }
  submission.verified = true;
  submission.message = `Gravado e conferido no Job ${submission.payload.job_id}: ${actual.length} entregáveis e ${actual.reduce((sum, item) => sum + item.format_instances.length, 0)} formatos. Para manutenção, use o módulo Jobs.`;
  toast(submission.message);
}

async function saveDeliverables() {
  const jobId = Number(state.job?.job_id);
  if (state.busy || !jobId || state.submittedJobs.has(jobId)) return;
  state.busy = true;
  setWorkflowLocked(true);
  elements.saveStatus.textContent = "Conferindo Job, catálogo e entregáveis existentes…";
  let submitted = false;
  try {
    const [job, catalog, statuses, existing] = await Promise.all([
      apiFetch(`${API.job}/job/${jobId}`, { cache: "no-store" }),
      fetchAll(`${API.business}/deliverable/customer/${state.job.customer_id}?filter[active]=true`, "deliverable_id"),
      fetchAll(`${API.business}/status/customer/${state.job.customer_id}`, "status_id"),
      readJobDeliverables(jobId),
    ]);
    if (Number(job.customer_id) !== Number(state.job.customer_id)) throw new Error("O cliente do Job mudou. Recarregue o Job antes de continuar.");
    if (existing.length) throw new Error(`O Job ${jobId} já possui ${existing.length} entregáveis. Este assistente cria a lista inicial e não substitui listas existentes. Use um Job vazio para gravar.`);
    const payload = buildBatch(job, exportPayload().deliverables, catalog, statuses);
    const count = payload.deliverables.reduce((sum, d) => sum + d.format_instances.length, 0);
    if (!window.confirm(`Criar ${payload.deliverables.length} entregáveis e ${count} formatos no Job ${jobId} — ${job.job_title || job.name || ""}?\n\nQuantidade 1 por formato, sem preços ou cobrança. Esta ação grava os dados no Jamworks.`)) return;
    // Re-read after confirmation; never submit a partial replacement of an existing list.
    if ((await readJobDeliverables(jobId)).length) throw new Error("O Job recebeu entregáveis durante a revisão. Nenhum dado foi enviado.");
    const submission = { payload, verified: false, message: "Enviando a lista ao Jamworks… Lotes grandes podem levar vários minutos. Não reenvie nem feche esta aba." };
    state.submittedJobs.set(jobId, submission);
    submitted = true;
    elements.saveStatus.textContent = submission.message;
    submission.controller = new AbortController();
    submission.monitoring = true;
    submission.progress = countProgress(payload, []);
    renderSaveProgress(submission);
    try {
      await observeBatch({
        payload,
        signal: submission.controller.signal,
        write: () => apiFetch(`${API.job}/deliverable/batch-save`, { method: "POST", signal: AbortSignal.timeout(20 * 60 * 1000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
        read: () => readJobDeliverables(jobId),
        onProgress: progress => {
          submission.progress = progress;
          submission.message = progress.stale
            ? "Não foi possível atualizar o progresso. Tentando novamente apenas a leitura; não reenvie o lote."
            : progress.writeError
              ? "O envio ficou sem confirmação, mas seguimos consultando a gravação no servidor. Não reenvie nem feche esta aba."
              : "Criando entregáveis e formatos no Jamworks… Progresso consultado a cada 5 segundos; mantenha esta aba aberta.";
          elements.saveStatus.textContent = submission.message;
          renderSaveProgress(submission);
        },
      });
      submission.verified = true;
      submission.message = `Gravado e conferido no Job ${jobId}: ${payload.deliverables.length} entregáveis e ${count} formatos. Para manutenção, use o módulo Jobs.`;
      toast(submission.message);
    } finally {
      submission.monitoring = false;
    }
  } catch (error) {
    if (submitted) {
      const submission = state.submittedJobs.get(jobId);
      submission.message = `Resultado da gravação não confirmado: ${error.message} O reenvio foi bloqueado para evitar duplicação. Confira o Job ou use “Conferir gravação”.`;
      showError(new Error(submission.message));
    } else {
      showError(error);
      elements.saveStatus.textContent = error.message;
    }
  } finally {
    const message = elements.saveStatus.textContent;
    state.busy = false;
    setWorkflowLocked(false);
    if (!submitted) elements.saveStatus.textContent = message;
  }
}

async function copyJson() {
  await navigator.clipboard.writeText(JSON.stringify(exportPayload(), null, 2));
  toast("JSON copiado para a área de transferência.");
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(exportPayload(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `job-${state.job?.job_id || "deliverables"}-sugestoes.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

let toastTimer;
function toast(message, error = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", error);
  elements.toast.classList.remove("hidden");
  toastTimer = setTimeout(() => elements.toast.classList.add("hidden"), 4200);
}

function showError(error) {
  console.error(error);
  toast(error?.message || "Ocorreu um erro inesperado.", true);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
function escapeAttribute(value) { return escapeHtml(value); }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

elements.jobForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const jobId = Number(elements.jobId.value);
  if (!Number.isInteger(jobId) || jobId <= 0) return showError(new Error("Informe um ID de Job válido."));
  loadJob(jobId);
});
elements.referenceList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-node-id]");
  if (card) selectSpreadsheet(Number(card.dataset.nodeId));
});
elements.spreadsheetNodeId.addEventListener("input", () => selectSpreadsheet(Number(elements.spreadsheetNodeId.value)));
elements.analyzeButton.addEventListener("click", startAnalysis);
elements.deliverablesList.addEventListener("input", (event) => updateDeliverableFromInput(event.target));
elements.deliverablesList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button) handleDeliverableAction(button);
});
elements.addDeliverableButton.addEventListener("click", addDeliverable);
elements.copyJsonButton.addEventListener("click", () => copyJson().catch(showError));
elements.downloadJsonButton.addEventListener("click", downloadJson);
elements.saveButton.addEventListener("click", saveDeliverables);
elements.verifyButton.addEventListener("click", verifySubmission);
elements.stopMonitoringButton.addEventListener("click", () => {
  state.submittedJobs.get(Number(state.job?.job_id))?.controller?.abort();
  elements.stopMonitoringButton.disabled = true;
});
elements.retryCatalogButton.addEventListener("click", async () => {
  if (state.busy) return;
  state.busy = true;
  setWorkflowLocked(true);
  await loadCatalog();
  state.busy = false;
  renderDeliverables();
});

readRuntimeConfig();
if (elements.jobId.value && state.token) loadJob(Number(elements.jobId.value));
