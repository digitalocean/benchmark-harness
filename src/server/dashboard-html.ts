export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Benchmark Runs</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #0b1020; color: #e8ecf4; }
    main { max-width: 1400px; margin: 0 auto; padding: 32px 24px; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    h1 { margin: 0; font-size: 28px; }
    button, input, select { font: inherit; }
    button { cursor: pointer; }
    .panel { background: #131a2b; border: 1px solid #27324a; border-radius: 12px; padding: 18px; }
    #auth { max-width: 480px; margin-top: 24px; }
    #auth form { display: flex; gap: 10px; }
    #auth input { flex: 1; min-width: 0; padding: 10px 12px; border: 1px solid #3b4967; border-radius: 8px; }
    .primary { border: 0; border-radius: 8px; padding: 10px 14px; background: #4f7cff; color: white; }
    .secondary { border: 1px solid #3b4967; border-radius: 8px; padding: 8px 12px; background: transparent; color: inherit; }
    #dashboard[hidden], #auth[hidden] { display: none; }
    .summary { display: grid; grid-template-columns: repeat(3, minmax(130px, 1fr)); gap: 12px; margin: 24px 0; }
    .metric { background: #131a2b; border: 1px solid #27324a; border-radius: 10px; padding: 15px; }
    .metric span { display: block; color: #9aa7bd; font-size: 13px; }
    .metric strong { display: block; margin-top: 5px; font-size: 24px; }
    .run-filters { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; margin-bottom: 12px; }
    .run-filter { display: grid; gap: 5px; color: #9aa7bd; font-size: 12px; }
    .run-filter input, .run-filter select { min-width: 125px; padding: 8px 10px; border: 1px solid #3b4967; border-radius: 7px; background: #0b1020; color: inherit; }
    .run-filter.checkbox { display: flex; align-items: center; gap: 7px; padding-bottom: 7px; }
    .run-filter.checkbox input { min-width: auto; }
    .auto-refresh-indicator { display: inline-flex; align-items: center; gap: 6px; color: #9be4c7; font-size: 12px; white-space: nowrap; }
    .auto-refresh-dot { width: 7px; height: 7px; border-radius: 50%; background: #4bd39b; box-shadow: 0 0 0 3px rgb(75 211 155 / 14%); }
    .run-filters .auto-refresh-indicator { margin-left: auto; }
    .run-filter-summary { align-self: center; white-space: nowrap; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 980px; }
    th, td { padding: 12px; border-bottom: 1px solid #27324a; text-align: left; vertical-align: middle; }
    th { color: #9aa7bd; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    td { font-size: 14px; }
    .details { min-width: 190px; white-space: pre-line; line-height: 1.55; overflow-wrap: anywhere; }
    .configuration { max-width: 360px; color: #b6c6e5; }
    .run-advanced { margin-top: 7px; white-space: normal; }
    .run-advanced summary { cursor: pointer; color: #83a7ff; font-size: 12px; }
    .run-advanced-values { margin-top: 5px; color: #9aa7bd; font-size: 12px; white-space: pre-line; }
    .status { display: inline-block; border-radius: 999px; padding: 4px 9px; font-size: 12px; font-weight: 700; }
    .status-line { display: flex; align-items: center; gap: 7px; }
    .upload-warning { color: #f5c86b; cursor: help; font-size: 15px; line-height: 1; }
    .cancel-run { display: block; margin-top: 8px; color: #ff9da8; }
    .quality-cell { text-align: center; }
    .quality-details { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; min-width: 90px; text-align: center; }
    .artifact-links { display: grid; gap: 8px; min-width: 225px; }
    .artifact-row { display: grid; grid-template-columns: 72px auto auto; align-items: baseline; justify-content: start; gap: 10px; }
    .artifact-label { color: #9aa7bd; font-size: 12px; }
    .questions { min-width: 110px; white-space: pre-line; line-height: 1.55; }
    .running { background: #253b70; color: #b9d0ff; }
    .succeeded { background: #173f35; color: #9be4c7; }
    .failed { background: #51252c; color: #ffb4bc; }
    .cancelled { background: #4b3c20; color: #f5d38d; }
    .link { border: 0; padding: 0; background: none; color: #83a7ff; text-decoration: underline; }
    .run-link-actions { display: flex; align-items: center; gap: 8px; }
    .run-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; overflow-wrap: anywhere; }
    .copy-run-link { font-size: 16px; line-height: 1; text-decoration: none; }
    .run-detail-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 16px 0; }
    .run-detail-banner[hidden] { display: none; }
    .muted { color: #9aa7bd; }
    .error { color: #ffb4bc; margin-top: 12px; white-space: pre-wrap; }
    dialog { width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow-y: auto; border: 1px solid #3b4967; border-radius: 14px; padding: 0; background: #131a2b; color: #e8ecf4; }
    dialog::backdrop { background: rgb(0 0 0 / 70%); }
    .dialog-body { padding: 24px; }
    .dialog-body h2 { margin-top: 0; }
    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .form-grid label { display: grid; gap: 6px; color: #b6c6e5; font-size: 13px; }
    .form-grid label[hidden], .form-grid div[hidden] { display: none; }
    .form-grid input, .form-grid select { min-width: 0; padding: 9px 10px; border: 1px solid #3b4967; border-radius: 7px; background: #0b1020; color: inherit; }
    .form-grid .checkbox { display: flex; align-items: center; align-self: end; gap: 9px; min-height: 37px; }
    .form-grid .checkbox input { min-width: auto; }
    .advanced-config { margin-top: 18px; padding: 14px; border: 1px solid #27324a; border-radius: 9px; }
    .advanced-config summary { cursor: pointer; color: #b6c6e5; font-weight: 600; }
    .advanced-config .form-grid { margin-top: 14px; }
    .field-hint { color: #9aa7bd; font-size: 11px; }
    .info-icon { position: relative; display: inline-grid; place-items: center; width: 17px; height: 17px; border: 1px solid #83a7ff; border-radius: 50%; color: #83a7ff; font-size: 11px; font-weight: 700; cursor: help; }
    .info-icon::after { content: attr(data-tooltip); position: absolute; z-index: 10; left: 50%; bottom: calc(100% + 9px); width: min(380px, 75vw); padding: 10px 12px; border: 1px solid #3b4967; border-radius: 8px; background: #0b1020; color: #e8ecf4; box-shadow: 0 8px 24px rgb(0 0 0 / 45%); font-size: 12px; font-weight: 400; line-height: 1.45; text-align: left; transform: translateX(-50%); opacity: 0; visibility: hidden; pointer-events: none; }
    .info-icon:hover::after, .info-icon:focus::after { opacity: 1; visibility: visible; }
    .wide { grid-column: 1 / -1; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
    @media (max-width: 800px) { .summary { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 620px) { .form-grid { grid-template-columns: 1fr; } .wide { grid-column: auto; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Benchmark Runs</h1>
        <div class="muted">GPQA and TAU benchmark execution</div>
      </div>
      <div>
        <button id="start-run" class="primary" hidden>Start benchmark</button>
        <button id="refresh" class="secondary" hidden>Refresh</button>
      </div>
    </header>

    <section id="auth" class="panel">
      <form id="auth-form">
        <input id="token" type="password" autocomplete="current-password" placeholder="Enter password to view the benchmarks" required>
        <button class="primary" type="submit">Open dashboard</button>
      </form>
      <div id="auth-error" class="error"></div>
    </section>

    <section id="dashboard" hidden>
      <div id="run-detail-banner" class="panel run-detail-banner" hidden>
        <span id="run-detail-title"></span>
        <button id="back-to-runs" class="secondary" type="button">All runs</button>
      </div>
      <div class="summary">
        <div class="metric"><span>Total runs</span><strong id="total-runs">0</strong></div>
        <div class="metric"><span>Running</span><strong id="running-runs">0</strong></div>
        <div class="metric"><span>Failed runs</span><strong id="failed-runs">0</strong></div>
      </div>
      <div id="run-filters-panel" class="panel run-filters">
        <label class="run-filter">Model
          <input id="run-model-filter" placeholder="Contains…">
        </label>
        <label class="run-filter">Duration &gt; (seconds)
          <input id="run-duration-filter" type="number" min="0" step="1" placeholder="X">
        </label>
        <label class="run-filter">Triggered by
          <input id="run-triggered-filter" placeholder="Email contains…">
        </label>
        <label class="run-filter">Status
          <select id="run-status-filter">
            <option value="all">All</option>
            <option value="running">Running</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label class="run-filter">Quality &lt; (%)
          <input id="run-quality-filter" type="number" min="0" max="100" step="0.1" placeholder="X">
        </label>
        <label class="run-filter checkbox">
          <input id="hide-canary-runs" type="checkbox" checked>
          Hide canary runs
        </label>
        <label class="run-filter checkbox">
          <input id="show-disabled-runs" type="checkbox">
          Show disabled runs
        </label>
        <button id="clear-run-filters" class="secondary" type="button">Clear filters</button>
        <span class="auto-refresh-indicator"><span class="auto-refresh-dot"></span>Auto-refresh on · 10s</span>
        <span id="run-filter-summary" class="muted run-filter-summary"></span>
      </div>
      <div class="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>No.</th>
              <th>Run</th>
              <th>Timing</th>
              <th>Configuration</th>
              <th>Status</th>
              <th class="quality-cell">Quality</th>
              <th>Questions</th>
              <th>Artifacts</th>
            </tr>
          </thead>
          <tbody id="runs"></tbody>
        </table>
        <div id="empty" class="muted" hidden>No benchmark runs found.</div>
        <div id="dashboard-error" class="error"></div>
      </div>
    </section>

    <dialog id="start-dialog">
      <div class="dialog-body">
        <h2>Start benchmark</h2>
        <form id="start-form">
          <div class="form-grid">
            <label>Benchmark
              <select name="benchmark">
                <option value="gpqa_diamond">GPQA Diamond</option>
                <option value="tau_bench_verified_airline">TAU Bench Verified Airline</option>
              </select>
            </label>
            <label>Inference endpoint
              <select id="inference-base-url" name="baseUrl" required>
                <option value="https://inference.do-ai.run/v1">https://inference.do-ai.run/v1</option>
                <option value="https://inference.do-ai-test.run/v1">https://inference.do-ai-test.run/v1</option>
                <option value="https://openrouter.ai/api/v1">https://openrouter.ai/api/v1</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label id="catalog-model-label">Model
              <input id="catalog-model" name="catalogModel" list="catalog-model-options" placeholder="Search models…" required disabled>
            </label>
            <datalist id="catalog-model-options"></datalist>
            <div id="catalog-model-status" class="wide muted">Loading available models…</div>
            <label id="manual-base-url-label" hidden>Inference base URL
              <input id="manual-base-url" name="manualBaseUrl" type="url" placeholder="https://inference.example.com/v1" disabled>
            </label>
            <label id="manual-model-label" hidden>Model
              <input id="manual-model" name="manualModel" placeholder="model-name" disabled>
            </label>
            <label>DigitalOcean email
              <input name="triggeredByEmail" type="email" pattern="[^@\\s]+@digitalocean\\.com" placeholder="user@digitalocean.com" required>
            </label>
            <label>Run trigger password
              <input name="triggerSecret" type="password" autocomplete="off" required>
            </label>
            <label>Inference API key
              <input name="apiKey" type="password" autocomplete="off" required>
            </label>
            <label>Epochs
              <input name="epochs" type="number" min="1" max="20" value="1" required>
            </label>
            <label>Concurrency
              <input name="concurrency" type="number" min="1" max="64" value="8" required>
            </label>
            <label class="checkbox">
              <input name="unordered" type="checkbox" checked>
              Use rolling unordered concurrency
              <span class="info-icon" role="img" tabindex="0" aria-label="Rolling concurrency information" data-tooltip="On: As soon as one question finishes, another starts, so request slots stay busy. This is faster and useful for quick results, but completion order differs from OpenRouter's ordered execution script. Final scores should usually be comparable, but identical scores are not guaranteed. Off: A slow early question can delay later work, so execution may be slower, but scheduling stays in 100% order sync with OpenRouter's execution script. This setting does not guarantee identical model responses.">i</span>
            </label>
            <label>Question limit
              <input name="limit" type="number" min="1" max="1000" value="10">
            </label>
          </div>
          <details class="advanced-config">
            <summary>Advanced configuration</summary>
            <div class="form-grid">
              <label>Maximum output tokens
                <input name="maxTokens" type="number" min="1" step="1" placeholder="Provider default">
              </label>
              <label>Reasoning effort
                <select name="reasoningEffort">
                  <option value="">Provider default</option>
                  <option value="xhigh">xhigh</option>
                  <option value="high">high</option>
                  <option value="medium">medium</option>
                  <option value="low">low</option>
                  <option value="minimal">minimal</option>
                  <option value="none">none</option>
                </select>
              </label>
              <label>Request timeout (milliseconds)
                <input name="timeoutMs" type="number" min="1" step="1" placeholder="Harness default">
              </label>
              <label>Provider sort
                <select name="sort">
                  <option value="">Provider default</option>
                  <option value="price">price</option>
                  <option value="throughput">throughput</option>
                  <option value="latency">latency</option>
                  <option value="exacto">exacto</option>
                </select>
              </label>
              <label>Cloudflare version
                <input name="cloudflareVersion" placeholder="Not set">
              </label>
              <label>Cost-quality tradeoff
                <input name="costQualityTradeoff" type="number" min="0" max="10" step="1" placeholder="Provider default">
                <span class="field-hint">Integer from 0 to 10</span>
              </label>
              <label>Pin model
                <select name="pinModel">
                  <option value="">Provider default</option>
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </label>
              <label>Maximum retries
                <input name="maxRetries" type="number" min="0" max="20" step="1" placeholder="Harness default">
              </label>
            </div>
          </details>
          <div id="start-error" class="error"></div>
          <div class="dialog-actions">
            <button id="cancel-start" class="secondary" type="button">Cancel</button>
            <button id="submit-start" class="primary" type="submit">Start run</button>
          </div>
        </form>
      </div>
    </dialog>
  </main>
  <script>
    const tokenKey = "benchApiToken";
    const auth = document.getElementById("auth");
    const dashboard = document.getElementById("dashboard");
    const authError = document.getElementById("auth-error");
    const dashboardError = document.getElementById("dashboard-error");
    const refreshButton = document.getElementById("refresh");
    const startButton = document.getElementById("start-run");
    const startDialog = document.getElementById("start-dialog");
    const startForm = document.getElementById("start-form");
    const startError = document.getElementById("start-error");
    const submitStart = document.getElementById("submit-start");
    const runDetailBanner = document.getElementById("run-detail-banner");
    const runDetailTitle = document.getElementById("run-detail-title");
    const backToRuns = document.getElementById("back-to-runs");
    const runFiltersPanel = document.getElementById("run-filters-panel");
    const inferenceBaseUrl = document.getElementById("inference-base-url");
    const catalogModelLabel = document.getElementById("catalog-model-label");
    const catalogModel = document.getElementById("catalog-model");
    const catalogModelOptions = document.getElementById("catalog-model-options");
    const catalogModelStatus = document.getElementById("catalog-model-status");
    const manualBaseUrlLabel = document.getElementById("manual-base-url-label");
    const manualModelLabel = document.getElementById("manual-model-label");
    const manualBaseUrl = document.getElementById("manual-base-url");
    const manualModel = document.getElementById("manual-model");
    const runModelFilter = document.getElementById("run-model-filter");
    const runDurationFilter = document.getElementById("run-duration-filter");
    const runTriggeredFilter = document.getElementById("run-triggered-filter");
    const runStatusFilter = document.getElementById("run-status-filter");
    const runQualityFilter = document.getElementById("run-quality-filter");
    const hideCanaryRuns = document.getElementById("hide-canary-runs");
    const showDisabledRuns = document.getElementById("show-disabled-runs");
    const runFilterSummary = document.getElementById("run-filter-summary");
    let loadedRuns = [];
    let catalogRequestVersion = 0;
    let catalogReady = false;
    let catalogModels = new Set();

    function currentToken() {
      return sessionStorage.getItem(tokenKey) || "";
    }

    function selectedRunId() {
      return new URLSearchParams(window.location.search).get("runId");
    }

    function runDashboardUrl(id) {
      const url = new URL(window.location.href);
      url.search = "";
      url.searchParams.set("runId", id);
      return url.toString();
    }

    function legacyCopyText(text) {
      const input = document.createElement("textarea");
      input.value = text;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      return copied;
    }

    async function copyRunLink(id) {
      const link = runDashboardUrl(id);
      try {
        if (navigator.clipboard?.writeText !== undefined) {
          await navigator.clipboard.writeText(link);
        } else if (!legacyCopyText(link)) {
          throw new Error("The browser rejected the copy action.");
        }
        dashboardError.textContent = "Run link copied.";
      } catch {
        if (legacyCopyText(link)) {
          dashboardError.textContent = "Run link copied.";
        } else {
          dashboardError.textContent =
            "Could not copy the link automatically: " + link;
        }
      }
    }

    async function api(path, init = {}) {
      const headers = new Headers(init.headers);
      headers.set("Authorization", "Bearer " + currentToken());
      const response = await fetch(path, { ...init, headers });
      if (response.status === 401) {
        sessionStorage.removeItem(tokenKey);
        showAuth("The API token was rejected.");
        throw new Error("Unauthorized");
      }
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response;
    }

    function setCatalogModels(models) {
      catalogModels = new Set(models);
      catalogModelOptions.replaceChildren();
      for (const model of models) {
        const option = document.createElement("option");
        option.value = model;
        catalogModelOptions.appendChild(option);
      }
    }

    async function configureInferenceControls() {
      const isOther = inferenceBaseUrl.value === "other";
      catalogModelLabel.hidden = isOther;
      manualBaseUrlLabel.hidden = !isOther;
      manualModelLabel.hidden = !isOther;
      manualBaseUrl.disabled = !isOther;
      manualModel.disabled = !isOther;
      manualBaseUrl.required = isOther;
      manualModel.required = isOther;
      catalogModel.disabled = isOther;
      catalogModel.required = !isOther;
      catalogModelStatus.hidden = isOther;
      if (isOther) {
        catalogReady = true;
        catalogModelStatus.textContent = "";
        return;
      }
      const requestVersion = ++catalogRequestVersion;
      catalogReady = false;
      catalogModels = new Set();
      catalogModel.value = "";
      catalogModelOptions.replaceChildren();
      catalogModel.disabled = true;
      catalogModelStatus.textContent = "Loading available models…";
      try {
        const response = await api(
          "/model-catalog?baseUrl=" +
            encodeURIComponent(inferenceBaseUrl.value)
        );
        const data = await response.json();
        if (requestVersion !== catalogRequestVersion) {
          return;
        }
        const models = Array.isArray(data.models) ? data.models : [];
        if (models.length === 0) {
          catalogModelStatus.textContent =
            "No eligible models are currently available.";
          return;
        }
        setCatalogModels(models);
        catalogModel.disabled = false;
        catalogReady = true;
        catalogModelStatus.textContent =
          models.length + " models available.";
      } catch (error) {
        if (requestVersion !== catalogRequestVersion) {
          return;
        }
        catalogModelStatus.textContent =
          "Could not load DigitalOcean models: " + String(error);
      }
    }

    function showAuth(message) {
      auth.hidden = false;
      dashboard.hidden = true;
      refreshButton.hidden = true;
      startButton.hidden = true;
      authError.textContent = message || "";
    }

    function addCell(row, value, className) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      if (className) {
        cell.className = className;
      }
      row.appendChild(cell);
      return cell;
    }

    function addArtifactRow(container, label, actions) {
      const row = document.createElement("div");
      row.className = "artifact-row";
      const name = document.createElement("span");
      name.className = "artifact-label";
      name.textContent = label;
      row.appendChild(name);
      for (const action of actions) {
        row.appendChild(action);
      }
      container.appendChild(row);
    }

    function formatDate(value) {
      return value ? new Date(value).toLocaleString() : "—";
    }

    function formatDuration(startedAt, finishedAt) {
      if (!startedAt) {
        return "—";
      }
      const start = new Date(startedAt).getTime();
      const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return "—";
      }
      let seconds = Math.max(0, Math.floor((end - start) / 1000));
      const days = Math.floor(seconds / 86400);
      seconds %= 86400;
      const hours = Math.floor(seconds / 3600);
      seconds %= 3600;
      const minutes = Math.floor(seconds / 60);
      seconds %= 60;
      const parts = [];
      if (days > 0) {
        parts.push(days + "d");
      }
      if (hours > 0 || days > 0) {
        parts.push(hours + "h");
      }
      if (minutes > 0 || hours > 0 || days > 0) {
        parts.push(minutes + "m");
      }
      parts.push(seconds + "s");
      return parts.join(" ");
    }

    function formatQuality(value) {
      return typeof value === "number" ? (value * 100).toFixed(2) + "%" : "—";
    }

    function runDurationSeconds(run) {
      if (!run.startedAt) {
        return 0;
      }
      const start = new Date(run.startedAt).getTime();
      const end = run.finishedAt
        ? new Date(run.finishedAt).getTime()
        : Date.now();
      return Number.isFinite(start) && Number.isFinite(end)
        ? Math.max(0, end - start) / 1000
        : 0;
    }

    function advancedConfigurationEntries(run) {
      const inference = run.args.inference;
      const execution = run.args.execution;
      let pinModel;
      if (inference.pinModel !== undefined) {
        pinModel = inference.pinModel ? "Enabled" : "Disabled";
      }
      return [
        ["Max tokens", inference.maxTokens],
        ["Reasoning", inference.reasoningEffort],
        ["Timeout", inference.timeoutMs],
        ["Endpoint ID", inference.endpointId],
        ["Cost tier", inference.costTier],
        ["Sort", inference.sort],
        ["Cloudflare", inference.cloudflareVersion],
        ["Cost-quality", inference.costQualityTradeoff],
        ["Pin model", pinModel],
        ["Max retries", execution.maxRetries],
      ].filter(([, value]) => value !== undefined);
    }

    function applyRunFilters() {
      const model = runModelFilter.value.trim().toLowerCase();
      const duration = runDurationFilter.value.trim();
      const triggeredBy = runTriggeredFilter.value.trim().toLowerCase();
      const quality = runQualityFilter.value.trim();
      const canaryEmail = "genai-temporal-worker@digitalocean.com";
      const filtered = loadedRuns.filter((run) => {
        const modelMatches =
          model === "" ||
          String(run.args.inference.model).toLowerCase().includes(model);
        const durationMatches =
          duration === "" ||
          runDurationSeconds(run) > Number(duration);
        const triggeredByMatches =
          triggeredBy === "" ||
          String(run.triggeredByEmail || "")
            .toLowerCase()
            .includes(triggeredBy);
        const statusMatches =
          runStatusFilter.value === "all" ||
          run.status === runStatusFilter.value;
        const qualityMatches =
          quality === "" ||
          (typeof run.qualityScore === "number" &&
            run.qualityScore * 100 < Number(quality));
        const canaryMatches =
          !hideCanaryRuns.checked ||
          String(run.triggeredByEmail || "").toLowerCase() !== canaryEmail;
        const disabledMatches =
          selectedRunId() !== null || showDisabledRuns.checked || !run.disabled;
        return (
          modelMatches &&
          durationMatches &&
          triggeredByMatches &&
          statusMatches &&
          qualityMatches &&
          canaryMatches &&
          disabledMatches
        );
      });
      renderRuns(filtered);
      runFilterSummary.textContent =
        "Showing " + filtered.length + " of " + loadedRuns.length + " runs";
    }

    function renderRuns(runs) {
      const body = document.getElementById("runs");
      body.replaceChildren();
      const empty = document.getElementById("empty");
      empty.hidden = runs.length !== 0;
      empty.textContent =
        loadedRuns.length === 0
          ? "No benchmark runs found."
          : "No benchmark runs match the current filters.";
      let serial = 0;
      for (const run of runs) {
        serial += 1;
        const row = document.createElement("tr");
        addCell(row, serial);
        const runCell = document.createElement("td");
        const actions = document.createElement("div");
        actions.className = "run-link-actions";
        const runId = document.createElement("span");
        runId.className = "run-id";
        runId.textContent = run.id;
        const copy = document.createElement("button");
        copy.className = "link copy-run-link";
        copy.type = "button";
        copy.textContent = "⧉";
        copy.title = "Copy run link";
        copy.setAttribute("aria-label", "Copy run link");
        copy.addEventListener("click", () => void copyRunLink(run.id));
        actions.appendChild(runId);
        actions.appendChild(copy);
        runCell.appendChild(actions);
        row.appendChild(runCell);
        addCell(
          row,
          "Started: " + formatDate(run.startedAt) + "\\n" +
            "Completed: " + formatDate(run.finishedAt) + "\\n" +
            "Duration: " + formatDuration(run.startedAt, run.finishedAt),
          "details"
        );
        const configurationCell = addCell(
          row,
          "Model: " + run.args.inference.model + "\\n" +
            "Benchmark: " + run.args.benchmark + "\\n" +
            "Base URL: " + run.args.inference.baseUrl,
          "details configuration"
        );
        const moreDetails = document.createElement("details");
        moreDetails.className = "run-advanced";
        const moreSummary = document.createElement("summary");
        moreSummary.textContent = "Show more";
        moreDetails.addEventListener("toggle", () => {
          moreSummary.textContent = moreDetails.open ? "Show less" : "Show more";
        });
        const moreValues = document.createElement("div");
        moreValues.className = "run-advanced-values";
        moreValues.textContent =
          "Epochs: " + run.args.execution.epochs + "\\n" +
          "Concurrency: " + run.args.execution.concurrency + "\\n" +
          "Unordered: " + (run.args.execution.unordered ? "Yes" : "No") +
          (run.args.execution.limit !== undefined
            ? "\\nLimit: " + run.args.execution.limit
            : "") +
          "\\nTriggered by: " + (run.triggeredByEmail || "—");
        moreDetails.appendChild(moreSummary);
        moreDetails.appendChild(moreValues);
        configurationCell.appendChild(moreDetails);
        const advancedEntries = advancedConfigurationEntries(run);
        if (advancedEntries.length > 0) {
          const advanced = document.createElement("details");
          advanced.className = "run-advanced";
          const summary = document.createElement("summary");
          summary.textContent =
            "Advanced (" + advancedEntries.length + ")";
          const values = document.createElement("div");
          values.className = "run-advanced-values";
          values.textContent = advancedEntries
            .map(([label, value]) => label + ": " + value)
            .join("\\n");
          advanced.appendChild(summary);
          advanced.appendChild(values);
          moreDetails.appendChild(advanced);
        }
        const statusCell = document.createElement("td");
        const status = document.createElement("span");
        status.className = "status " + run.status;
        status.textContent = run.status;
        const statusLine = document.createElement("div");
        statusLine.className = "status-line";
        statusLine.appendChild(status);
        if (run.uploadStatus === "failed") {
          const warning = document.createElement("span");
          const rawError = String(
            run.uploadError || "No upload error details were recorded."
          );
          const detail =
            rawError.length > 1000
              ? rawError.slice(0, 1000) + "…"
              : rawError;
          warning.className = "upload-warning";
          warning.textContent = "⚠";
          warning.title =
            "Spaces artifact upload failed. Benchmark status is unaffected and local artifacts are retained for retry.\\n\\n" +
            detail;
          warning.setAttribute("role", "img");
          warning.setAttribute("aria-label", warning.title);
          warning.tabIndex = 0;
          statusLine.appendChild(warning);
        }
        statusCell.appendChild(statusLine);
        if (run.status === "running") {
          const cancel = document.createElement("button");
          cancel.className = "link cancel-run";
          cancel.type = "button";
          cancel.textContent = "Cancel run";
          cancel.addEventListener("click", () => cancelBenchmark(run.id, cancel));
          statusCell.appendChild(cancel);
        }
        if (run.status === "failed" || run.status === "cancelled") {
          const disable = document.createElement("button");
          disable.className = "link cancel-run";
          disable.type = "button";
          disable.textContent = run.disabled ? "Enable run" : "Disable run";
          disable.addEventListener("click", () =>
            setRunDisabled(run.id, !run.disabled, disable)
          );
          statusCell.appendChild(disable);
        }
        row.appendChild(statusCell);
        const qualityCell = document.createElement("td");
        qualityCell.className = "quality-cell";
        const qualityDetails = document.createElement("div");
        qualityDetails.className = "quality-details";
        const qualityValue = document.createElement("span");
        qualityValue.textContent = formatQuality(run.qualityScore);
        qualityDetails.appendChild(qualityValue);
        if (run.status === "succeeded") {
          const summary = document.createElement("button");
          summary.className = "link";
          summary.type = "button";
          summary.textContent = "View summary";
          summary.addEventListener("click", () => openSummary(run.id));
          qualityDetails.appendChild(summary);
        }
        qualityCell.appendChild(qualityDetails);
        row.appendChild(qualityCell);
        const completed = run.completedEvaluations || 0;
        const skipped = run.skippedEvaluations || 0;
        const total = run.totalEvaluations || 0;
        const completion = Number(run.completionPercentage || 0);
        addCell(
          row,
          completion.toFixed(1) + "% complete\\n" +
            completed + "/" + total + " completed\\n" +
            skipped + "/" + total + " skipped",
          "questions"
        );
        const artifactsCell = document.createElement("td");
        const artifactLinks = document.createElement("div");
        artifactLinks.className = "artifact-links";
        const logs = document.createElement("button");
        logs.className = "link";
        logs.type = "button";
        logs.textContent = "View";
        logs.addEventListener("click", () =>
          openText(
            "/runs/" + encodeURIComponent(run.id) + "/logs?tail=10000",
            "Benchmark logs"
          )
        );
        const downloadLogs = document.createElement("button");
        downloadLogs.className = "link";
        downloadLogs.type = "button";
        downloadLogs.textContent = "Download";
        downloadLogs.addEventListener("click", () =>
          downloadArtifact(
            "/runs/" + encodeURIComponent(run.id) + "/logs?download=1",
            run.id + "-run.log"
          )
        );
        addArtifactRow(artifactLinks, "Logs", [logs, downloadLogs]);
        const requests = document.createElement("button");
        requests.className = "link";
        requests.type = "button";
        requests.textContent = "View";
        requests.addEventListener("click", () => openRequestViewer(run.id));
        const downloadRequests = document.createElement("button");
        downloadRequests.className = "link";
        downloadRequests.type = "button";
        downloadRequests.textContent = "Download";
        downloadRequests.addEventListener("click", () =>
          downloadArtifact(
            "/runs/" + encodeURIComponent(run.id) +
              "/request-records?download=1",
            run.id + "-requests.jsonl"
          )
        );
        addArtifactRow(artifactLinks, "Requests", [
          requests,
          downloadRequests,
        ]);
        const state = document.createElement("button");
        state.className = "link";
        state.type = "button";
        state.textContent = "View";
        state.addEventListener("click", () =>
          openText(
            "/runs/" + encodeURIComponent(run.id) + "/state",
            "Benchmark run state"
          )
        );
        const downloadState = document.createElement("button");
        downloadState.className = "link";
        downloadState.type = "button";
        downloadState.textContent = "Download";
        downloadState.addEventListener("click", () =>
          downloadArtifact(
            "/runs/" + encodeURIComponent(run.id) + "/state?download=1",
            run.id + "-run.json"
          )
        );
        addArtifactRow(artifactLinks, "Run state", [state, downloadState]);
        if (run.status === "succeeded") {
          const parquet = document.createElement("button");
          parquet.className = "link";
          parquet.type = "button";
          parquet.textContent = "Download";
          parquet.addEventListener("click", () =>
            downloadArtifact(
              "/runs/" + encodeURIComponent(run.id) + "/parquet",
              run.id + "-results.parquet"
            )
          );
          addArtifactRow(artifactLinks, "Parquet", [parquet]);
        }
        artifactsCell.appendChild(artifactLinks);
        row.appendChild(artifactsCell);
        body.appendChild(row);
      }
      document.getElementById("total-runs").textContent = String(
        loadedRuns.length
      );
      document.getElementById("running-runs").textContent = String(
        loadedRuns.filter((run) => run.status === "running").length
      );
      document.getElementById("failed-runs").textContent = String(
        loadedRuns.filter((run) => run.status === "failed").length
      );
    }

    async function loadRuns() {
      dashboardError.textContent = "";
      try {
        const runId = selectedRunId();
        const response = await api(
          runId === null ? "/runs" : "/runs/" + encodeURIComponent(runId)
        );
        const data = await response.json();
        loadedRuns = runId === null ? data : [data];
        runDetailBanner.hidden = runId === null;
        runFiltersPanel.hidden = runId !== null;
        runDetailTitle.textContent =
          runId === null ? "" : "Run details: " + runId;
        applyRunFilters();
        auth.hidden = true;
        dashboard.hidden = false;
        refreshButton.hidden = false;
        startButton.hidden = false;
      } catch (error) {
        if (currentToken()) {
          dashboardError.textContent = String(error);
        }
      }
    }

    async function openText(path, title) {
      const tab = window.open("", "_blank");
      if (!tab) {
        dashboardError.textContent = "Allow popups to open run artifacts.";
        return;
      }
      tab.document.title = title;
      const pre = tab.document.createElement("pre");
      pre.textContent = "Loading…";
      tab.document.body.appendChild(pre);
      try {
        const response = await api(path);
        pre.textContent = await response.text() || "No data available.";
      } catch (error) {
        pre.textContent = String(error);
      }
    }

    async function downloadArtifact(path, filename) {
      dashboardError.textContent = "";
      try {
        const response = await api(path);
        const directUrl = response.headers.get("x-artifact-download-url");
        const url =
          directUrl || URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        if (!directUrl) {
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
      } catch (error) {
        dashboardError.textContent = String(error);
      }
    }

    async function openRequestViewer(id, existingTab) {
      const tab = existingTab || window.open("", "_blank");
      if (!tab) {
        dashboardError.textContent = "Allow popups to open request records.";
        return;
      }
      if (tab.__requestRefreshInFlight) {
        return;
      }
      tab.__requestRefreshInFlight = true;
      if (!tab.__requestAutoRefreshTimer) {
        tab.__requestAutoRefreshTimer = window.setInterval(() => {
          if (tab.closed) {
            window.clearInterval(tab.__requestAutoRefreshTimer);
            return;
          }
          openRequestViewer(id, tab);
        }, 60000);
      }
      const filterState = tab.__requestFilterState || {
        status: "all",
        errorsOnly: false,
        duration: "",
        attempt: "",
      };
      tab.__requestFilterState = filterState;
      tab.document.title = "Inference requests";
      if (!existingTab) {
        tab.document.body.textContent = "Loading request records…";
      }
      try {
        const response = await api(
          "/runs/" + encodeURIComponent(id) + "/request-records"
        );
        const raw = await response.text();
        const invalidLines = [];
        const events = raw
          .split("\\n")
          .filter((line) => line.trim().length > 0)
          .flatMap((line, index) => {
            try {
              return [JSON.parse(line)];
            } catch {
              invalidLines.push(index + 1);
              return [];
            }
          });
        const requests = new Map();
        for (const event of events) {
          const requestId = String(event.request_id || "unknown");
          const current = requests.get(requestId) || { requestId };
          if (event.event === "started") {
            current.started = event;
          } else if (event.event === "completed") {
            current.completed = event;
          }
          requests.set(requestId, current);
        }
        const entries = [...requests.values()].sort((a, b) => {
          const aStart = a.started?.started_at || a.completed?.started_at || "";
          const bStart = b.started?.started_at || b.completed?.started_at || "";
          return bStart.localeCompare(aStart);
        });
        const pending = entries.filter((entry) => !entry.completed).length;
        const successful = entries.filter(
          (entry) => entry.completed?.ok
        ).length;
        const errors = entries.length - pending - successful;
        const document = tab.document;
        document.body.replaceChildren();
        const style = document.createElement("style");
        style.textContent =
          "body{margin:0;padding:24px;background:#0b1020;color:#e8ecf4;font:14px Inter,system-ui,sans-serif}" +
          "h1{margin:0 0 8px}.summary{color:#9aa7bd;margin-bottom:18px}.toolbar{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px}" +
          "button,select,input{padding:8px 12px;border:1px solid #3b4967;border-radius:7px;background:#131a2b;color:#e8ecf4}button{cursor:pointer}" +
          ".filter{display:flex;align-items:center;gap:7px;color:#9aa7bd}.filter input{width:90px}.filter input[type=checkbox]{width:auto}" +
          ".auto-refresh-indicator{display:inline-flex;align-items:center;gap:6px;color:#9be4c7;font-size:12px;white-space:nowrap}.auto-refresh-dot{width:7px;height:7px;border-radius:50%;background:#4bd39b;box-shadow:0 0 0 3px rgb(75 211 155 / 14%)}" +
          ".wrap{overflow:auto;border:1px solid #27324a;border-radius:10px}table{width:100%;border-collapse:collapse;min-width:1000px}" +
          "th,td{padding:10px;border-bottom:1px solid #27324a;text-align:left;vertical-align:top}th{color:#9aa7bd;font-size:12px}" +
          "pre{margin:0;max-width:430px;max-height:240px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}" +
          ".pending{color:#f5d38d}.success{color:#9be4c7}.failure{color:#ffb4bc}.muted{color:#9aa7bd}";
        document.head.appendChild(style);
        const heading = document.createElement("h1");
        heading.textContent = "Inference requests";
        document.body.appendChild(heading);
        const summary = document.createElement("div");
        summary.className = "summary";
        document.body.appendChild(summary);
        const toolbar = document.createElement("div");
        toolbar.className = "toolbar";
        const refresh = document.createElement("button");
        refresh.textContent = "Refresh";
        refresh.addEventListener("click", () => openRequestViewer(id, tab));
        toolbar.appendChild(refresh);
        const autoRefresh = document.createElement("span");
        autoRefresh.className = "auto-refresh-indicator";
        const autoRefreshDot = document.createElement("span");
        autoRefreshDot.className = "auto-refresh-dot";
        autoRefresh.appendChild(autoRefreshDot);
        autoRefresh.appendChild(
          document.createTextNode("Auto-refresh on · 1 min")
        );
        toolbar.appendChild(autoRefresh);
        const rawDownload = document.createElement("button");
        rawDownload.textContent = "Download raw JSONL";
        rawDownload.addEventListener("click", () => {
          const url = URL.createObjectURL(
            new Blob([raw], { type: "application/x-ndjson" })
          );
          const link = document.createElement("a");
          link.href = url;
          link.download = id + "-requests.jsonl";
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        });
        toolbar.appendChild(rawDownload);
        const filterLabel = document.createElement("label");
        filterLabel.className = "filter";
        filterLabel.textContent = "Status";
        const statusFilter = document.createElement("select");
        for (const option of [
          { value: "all", label: "All (" + entries.length + ")" },
          { value: "success", label: "Success (" + successful + ")" },
          { value: "pending", label: "Pending (" + pending + ")" },
          { value: "error", label: "Error (" + errors + ")" },
        ]) {
          const element = document.createElement("option");
          element.value = option.value;
          element.textContent = option.label;
          statusFilter.appendChild(element);
        }
        statusFilter.value = filterState.status;
        filterLabel.appendChild(statusFilter);
        toolbar.appendChild(filterLabel);
        const errorsOnlyLabel = document.createElement("label");
        errorsOnlyLabel.className = "filter";
        const errorsOnlyFilter = document.createElement("input");
        errorsOnlyFilter.type = "checkbox";
        errorsOnlyFilter.checked = filterState.errorsOnly;
        errorsOnlyLabel.appendChild(errorsOnlyFilter);
        errorsOnlyLabel.appendChild(document.createTextNode("Errors only"));
        toolbar.appendChild(errorsOnlyLabel);
        const durationFilterLabel = document.createElement("label");
        durationFilterLabel.className = "filter";
        durationFilterLabel.textContent = "Duration >";
        const durationFilter = document.createElement("input");
        durationFilter.type = "number";
        durationFilter.min = "0";
        durationFilter.step = "0.1";
        durationFilter.placeholder = "X seconds";
        durationFilter.value = filterState.duration;
        durationFilterLabel.appendChild(durationFilter);
        toolbar.appendChild(durationFilterLabel);
        const attemptFilterLabel = document.createElement("label");
        attemptFilterLabel.className = "filter";
        attemptFilterLabel.textContent = "Attempt >";
        const attemptFilter = document.createElement("input");
        attemptFilter.type = "number";
        attemptFilter.min = "0";
        attemptFilter.step = "1";
        attemptFilter.placeholder = "X";
        attemptFilter.value = filterState.attempt;
        attemptFilterLabel.appendChild(attemptFilter);
        toolbar.appendChild(attemptFilterLabel);
        document.body.appendChild(toolbar);
        const wrap = document.createElement("div");
        wrap.className = "wrap";
        const table = document.createElement("table");
        const head = document.createElement("thead");
        const headRow = document.createElement("tr");
        for (const label of [
          "No.",
          "Start time",
          "Request",
          "Provider",
          "Status",
          "Duration (seconds)",
          "Error",
        ]) {
          const cell = document.createElement("th");
          cell.textContent = label;
          headRow.appendChild(cell);
        }
        head.appendChild(headRow);
        table.appendChild(head);
        const tableBody = document.createElement("tbody");
        let serial = 0;
        for (const entry of entries) {
          serial += 1;
          const started = entry.started || entry.completed || {};
          const completed = entry.completed;
          const row = document.createElement("tr");
          let requestStatus = "pending";
          if (completed?.ok) {
            requestStatus = "success";
          } else if (completed) {
            requestStatus = "error";
          }
          row.dataset.requestStatus = requestStatus;
          const attempt = Number(started.attempt ?? completed?.attempt);
          row.dataset.attemptCount = Number.isFinite(attempt)
            ? String(attempt)
            : "0";
          const completedDurationMs = Number(completed?.duration_ms);
          const startedAtMs = new Date(started.started_at || "").getTime();
          let durationSeconds = 0;
          if (completed && Number.isFinite(completedDurationMs)) {
            durationSeconds = Math.max(0, completedDurationMs) / 1000;
          } else if (Number.isFinite(startedAtMs)) {
            durationSeconds = Math.max(0, Date.now() - startedAtMs) / 1000;
          }
          row.dataset.durationSeconds = String(durationSeconds);
          const serialCell = document.createElement("td");
          serialCell.textContent = String(serial);
          row.appendChild(serialCell);
          const startCell = document.createElement("td");
          startCell.textContent = formatDate(started.started_at);
          row.appendChild(startCell);
          const requestCell = document.createElement("td");
          const requestText = document.createElement("pre");
          requestText.textContent = JSON.stringify(
            {
              request_id: entry.requestId,
              model: started.model,
              attempt: started.attempt,
              url: started.url,
              request: started.request,
            },
            null,
            2
          );
          requestCell.appendChild(requestText);
          row.appendChild(requestCell);
          const providerCell = document.createElement("td");
          providerCell.textContent = completed?.provider_name || "—";
          row.appendChild(providerCell);
          const statusCell = document.createElement("td");
          if (!completed) {
            statusCell.textContent = "Pending";
            statusCell.className = "pending";
          } else {
            statusCell.textContent =
              completed.status === null || completed.status === undefined
                ? "No HTTP status"
                : String(completed.status);
            statusCell.className = completed.ok ? "success" : "failure";
          }
          row.appendChild(statusCell);
          const durationCell = document.createElement("td");
          durationCell.textContent =
            durationSeconds.toFixed(2) + " s" + (completed ? "" : " elapsed");
          row.appendChild(durationCell);
          const errorCell = document.createElement("td");
          errorCell.textContent = completed?.error || "—";
          if (completed?.error) {
            errorCell.className = "failure";
          }
          row.appendChild(errorCell);
          tableBody.appendChild(row);
        }
        table.appendChild(tableBody);
        wrap.appendChild(table);
        document.body.appendChild(wrap);
        const applyStatusFilter = () => {
          let visible = 0;
          const durationThreshold = durationFilter.value.trim();
          const attemptThreshold = attemptFilter.value.trim();
          for (const row of tableBody.rows) {
            const statusMatches =
              statusFilter.value === "all" ||
              row.dataset.requestStatus === statusFilter.value;
            const errorMatches =
              !errorsOnlyFilter.checked ||
              row.dataset.requestStatus === "error";
            const durationMatches =
              durationThreshold === "" ||
              Number(row.dataset.durationSeconds) > Number(durationThreshold);
            const attemptMatches =
              attemptThreshold === "" ||
              Number(row.dataset.attemptCount) > Number(attemptThreshold);
            const show =
              statusMatches &&
              errorMatches &&
              durationMatches &&
              attemptMatches;
            row.hidden = !show;
            if (show) {
              visible += 1;
            }
          }
          summary.textContent =
            visible + " of " + entries.length + " attempts shown · " +
            successful + " success · " + pending + " pending · " +
            errors + " error" + (errors === 1 ? "" : "s") +
            (invalidLines.length > 0
              ? " · " + invalidLines.length + " invalid JSONL lines"
              : "");
        };
        statusFilter.addEventListener("change", () => {
          if (statusFilter.value !== "all") {
            errorsOnlyFilter.checked = false;
          }
          filterState.status = statusFilter.value;
          filterState.errorsOnly = errorsOnlyFilter.checked;
          applyStatusFilter();
        });
        errorsOnlyFilter.addEventListener("change", () => {
          if (errorsOnlyFilter.checked) {
            statusFilter.value = "all";
          }
          filterState.status = statusFilter.value;
          filterState.errorsOnly = errorsOnlyFilter.checked;
          applyStatusFilter();
        });
        durationFilter.addEventListener("input", () => {
          filterState.duration = durationFilter.value;
          applyStatusFilter();
        });
        attemptFilter.addEventListener("input", () => {
          filterState.attempt = attemptFilter.value;
          applyStatusFilter();
        });
        applyStatusFilter();
      } catch (error) {
        tab.document.body.textContent = String(error);
      } finally {
        tab.__requestRefreshInFlight = false;
      }
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function percentage(value) {
      return (Number(value || 0) * 100).toFixed(2) + "%";
    }

    function breakdownRows(entries) {
      return entries.map((entry) =>
        "<tr><td>" + escapeHtml(entry.name) + "</td><td>" +
        percentage(entry.accuracy) + "</td><td>" +
        escapeHtml(entry.correctAnswers + "/" + entry.totalQuestions) +
        "</td><td>" + escapeHtml(entry.skippedQuestions) + "</td></tr>"
      ).join("");
    }

    function summaryDocument(summary) {
      const failures = summary.failures.length === 0
        ? '<p class="muted">No model or solver failures recorded.</p>'
        : "<table><thead><tr><th>Failure</th><th>Count</th></tr></thead><tbody>" +
          summary.failures.map((failure) =>
            "<tr><td>" + escapeHtml(failure.message) + "</td><td>" +
            escapeHtml(failure.count) + "</td></tr>"
          ).join("") + "</tbody></table>";
      return '<!doctype html><html><head><meta charset="utf-8">' +
        "<title>Benchmark run summary</title><style>" +
        "body{margin:0;background:#0b1020;color:#e8ecf4;font-family:Inter,system-ui,sans-serif}" +
        "main{max-width:1100px;margin:auto;padding:32px 24px}h1{margin-bottom:4px}" +
        ".muted{color:#9aa7bd}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0}" +
        ".card{background:#131a2b;border:1px solid #27324a;border-radius:10px;padding:15px}" +
        ".card span{display:block;color:#9aa7bd;font-size:13px}.card strong{font-size:24px}" +
        "section{background:#131a2b;border:1px solid #27324a;border-radius:12px;padding:18px;margin-top:18px;overflow:auto}" +
        "table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #27324a;text-align:left}" +
        "th{color:#9aa7bd;font-size:12px;text-transform:uppercase}@media(max-width:700px){.cards{grid-template-columns:1fr 1fr}}" +
        "</style></head><body><main><h1>" + escapeHtml(summary.model) +
        '</h1><div class="muted">' + escapeHtml(summary.task) + " · " +
        escapeHtml(new Date(summary.createdAt).toLocaleString()) + " · " +
        escapeHtml(summary.epochs) + " epoch(s)</div>" +
        '<div class="cards">' +
        '<div class="card"><span>Accuracy</span><strong>' + percentage(summary.accuracy) + "</strong></div>" +
        '<div class="card"><span>Correct</span><strong>' +
        escapeHtml(summary.correctAnswers + "/" + summary.totalQuestions) + "</strong></div>" +
        '<div class="card"><span>Skipped questions</span><strong>' + escapeHtml(summary.skippedQuestions) + "</strong></div>" +
        '<div class="card"><span>Unique questions</span><strong>' + escapeHtml(summary.uniqueQuestions) + "</strong></div>" +
        '<div class="card"><span>Evaluations</span><strong>' + escapeHtml(summary.evaluations) + "</strong></div>" +
        '<div class="card"><span>Skipped evaluations</span><strong>' + escapeHtml(summary.skippedEvaluations) + "</strong></div>" +
        '<div class="card"><span>Total tokens</span><strong>' + escapeHtml(Number(summary.totalTokens).toLocaleString()) + "</strong></div>" +
        '<div class="card"><span>Model time</span><strong>' + escapeHtml((Number(summary.generationTimeMs) / 1000).toFixed(1)) + "s</strong></div>" +
        '<div class="card"><span>Estimated cost</span><strong>$' + escapeHtml(Number(summary.totalCost).toFixed(4)) + "</strong></div>" +
        "</div>" +
        "<section><h2>Token usage</h2><table><thead><tr><th>Input</th><th>Output</th><th>Reasoning</th><th>Total</th></tr></thead><tbody><tr><td>" +
        escapeHtml(Number(summary.inputTokens).toLocaleString()) + "</td><td>" +
        escapeHtml(Number(summary.outputTokens).toLocaleString()) + "</td><td>" +
        escapeHtml(Number(summary.reasoningTokens).toLocaleString()) + "</td><td>" +
        escapeHtml(Number(summary.totalTokens).toLocaleString()) + "</td></tr></tbody></table></section>" +
        "<section><h2>Epoch breakdown</h2><table><thead><tr><th>Epoch</th><th>Accuracy</th><th>Correct</th><th>Skipped</th></tr></thead><tbody>" +
        breakdownRows(summary.epochResults) + "</tbody></table></section>" +
        "<section><h2>Subdomain breakdown</h2><table><thead><tr><th>Subdomain</th><th>Accuracy</th><th>Correct</th><th>Skipped</th></tr></thead><tbody>" +
        breakdownRows(summary.subdomains) + "</tbody></table></section>" +
        "<section><h2>Failures</h2>" + failures + "</section>" +
        "</main></body></html>";
    }

    async function openSummary(id) {
      const tab = window.open("", "_blank");
      if (!tab) {
        dashboardError.textContent = "Allow popups to open the run summary.";
        return;
      }
      tab.document.body.textContent = "Loading summary…";
      try {
        const response = await api("/runs/" + encodeURIComponent(id) + "/summary");
        const summary = await response.json();
        tab.document.open();
        tab.document.write(summaryDocument(summary));
        tab.document.close();
      } catch (error) {
        tab.document.body.textContent = String(error);
      }
    }

    async function cancelBenchmark(id, button) {
      if (!window.confirm("Cancel this benchmark run?")) {
        return;
      }
      button.disabled = true;
      dashboardError.textContent = "";
      try {
        await api("/runs/" + encodeURIComponent(id) + "/cancel", {
          method: "POST"
        });
        await loadRuns();
      } catch (error) {
        dashboardError.textContent = String(error);
        button.disabled = false;
      }
    }

    async function setRunDisabled(id, disabled, button) {
      const action = disabled ? "disable" : "enable";
      if (!window.confirm(action.charAt(0).toUpperCase() + action.slice(1) + " this run?")) {
        return;
      }
      button.disabled = true;
      dashboardError.textContent = "";
      try {
        await api("/runs/" + encodeURIComponent(id) + "/disable", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ disabled })
        });
        await loadRuns();
      } catch (error) {
        dashboardError.textContent = String(error);
        button.disabled = false;
      }
    }

    function runPayload(form) {
      const data = new FormData(form);
      const limit = String(data.get("limit") || "").trim();
      const maxTokens = String(data.get("maxTokens") || "").trim();
      const reasoningEffort = String(
        data.get("reasoningEffort") || ""
      ).trim();
      const timeoutMs = String(data.get("timeoutMs") || "").trim();
      const sort = String(data.get("sort") || "").trim();
      const cloudflareVersion = String(
        data.get("cloudflareVersion") || ""
      ).trim();
      const costQualityTradeoff = String(
        data.get("costQualityTradeoff") || ""
      ).trim();
      const pinModel = String(data.get("pinModel") || "").trim();
      const maxRetries = String(data.get("maxRetries") || "").trim();
      const isOther = data.get("baseUrl") === "other";
      return {
        benchmark: String(data.get("benchmark") || "gpqa_diamond"),
        triggeredByEmail: String(data.get("triggeredByEmail")),
        inference: {
          baseUrl: String(
            isOther ? data.get("manualBaseUrl") : data.get("baseUrl")
          ),
          apiKey: String(data.get("apiKey")),
          model: String(
            isOther ? data.get("manualModel") : data.get("catalogModel")
          ),
          ...(maxTokens === "" ? {} : { maxTokens: Number(maxTokens) }),
          ...(reasoningEffort === "" ? {} : { reasoningEffort }),
          ...(timeoutMs === "" ? {} : { timeoutMs: Number(timeoutMs) }),
          ...(sort === "" ? {} : { sort }),
          ...(cloudflareVersion === "" ? {} : { cloudflareVersion }),
          ...(costQualityTradeoff === ""
            ? {}
            : { costQualityTradeoff: Number(costQualityTradeoff) }),
          ...(pinModel === "" ? {} : { pinModel: pinModel === "true" })
        },
        execution: {
          epochs: Number(data.get("epochs")),
          concurrency: Number(data.get("concurrency")),
          unordered: data.get("unordered") === "on",
          ...(limit === "" ? {} : { limit: Number(limit) }),
          ...(maxRetries === "" ? {} : { maxRetries: Number(maxRetries) })
        }
      };
    }

    for (const filter of [
      runModelFilter,
      runDurationFilter,
      runTriggeredFilter,
      runQualityFilter,
    ]) {
      filter.addEventListener("input", applyRunFilters);
    }
    runStatusFilter.addEventListener("change", applyRunFilters);
    hideCanaryRuns.addEventListener("change", applyRunFilters);
    showDisabledRuns.addEventListener("change", applyRunFilters);
    document
      .getElementById("clear-run-filters")
      .addEventListener("click", () => {
        runModelFilter.value = "";
        runDurationFilter.value = "";
        runTriggeredFilter.value = "";
        runStatusFilter.value = "all";
        runQualityFilter.value = "";
        hideCanaryRuns.checked = true;
        showDisabledRuns.checked = false;
        applyRunFilters();
      });

    document.getElementById("auth-form").addEventListener("submit", (event) => {
      event.preventDefault();
      sessionStorage.setItem(tokenKey, document.getElementById("token").value);
      loadRuns();
    });
    refreshButton.addEventListener("click", loadRuns);
    backToRuns.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.search = "";
      window.history.pushState({}, "", url);
      void loadRuns();
    });
    inferenceBaseUrl.addEventListener("change", () => {
      void configureInferenceControls();
    });
    startButton.addEventListener("click", async () => {
      startError.textContent = "";
      startDialog.showModal();
      await configureInferenceControls();
    });
    document.getElementById("cancel-start").addEventListener("click", () => {
      startDialog.close();
    });
    startForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      startError.textContent = "";
      submitStart.disabled = true;
      try {
        const data = new FormData(startForm);
        if (
          inferenceBaseUrl.value !== "other" &&
          (!catalogReady || !catalogModels.has(catalogModel.value))
        ) {
          throw new Error(
            "Select a model from the loaded DigitalOcean model list."
          );
        }
        await api("/runs", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Bench-Run-Secret": String(data.get("triggerSecret"))
          },
          body: JSON.stringify(runPayload(startForm))
        });
        startDialog.close();
        startForm.reset();
        void configureInferenceControls();
        await loadRuns();
      } catch (error) {
        startError.textContent = String(error);
      } finally {
        submitStart.disabled = false;
      }
    });

    if (currentToken()) {
      loadRuns();
    } else {
      showAuth("");
    }
    setInterval(() => {
      if (currentToken()) {
        loadRuns();
      }
    }, 10000);
  </script>
</body>
</html>`;
