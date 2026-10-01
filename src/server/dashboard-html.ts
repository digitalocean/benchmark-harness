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
    .pagination { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 16px; }
    .pagination[hidden] { display: none; }
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
    .run-failure { margin-top: 8px; max-width: 320px; }
    .run-failure summary { cursor: pointer; color: #ff9da8; font-size: 12px; }
    .run-failure pre { margin: 7px 0 0; max-height: 220px; overflow: auto; padding: 9px; border-radius: 7px; background: #0b1020; color: #ffd4d8; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
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
    .model-history-backdrop { position: fixed; inset: 0; z-index: 40; background: rgb(0 0 0 / 45%); border: 0; padding: 0; }
    .model-history-backdrop[hidden] { display: none; }
    .model-history-drawer { position: fixed; top: 0; right: 0; z-index: 41; display: flex; flex-direction: column; width: min(640px, 100vw); height: 100vh; background: #131a2b; border-left: 1px solid #3b4967; box-shadow: -12px 0 32px rgb(0 0 0 / 35%); }
    .model-history-drawer[hidden] { display: none; }
    .model-history-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 20px 20px 12px; border-bottom: 1px solid #27324a; }
    .model-history-header h2 { margin: 0; font-size: 18px; }
    .model-history-meta { margin-top: 6px; color: #9aa7bd; font-size: 13px; overflow-wrap: anywhere; }
    .model-history-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid #27324a; }
    .model-history-controls label { display: flex; align-items: center; gap: 7px; color: #b6c6e5; font-size: 13px; }
    .model-history-controls select { padding: 6px 8px; border: 1px solid #3b4967; border-radius: 7px; background: #0b1020; color: inherit; }
    .model-history-body { flex: 1; overflow: auto; padding: 12px 20px 24px; }
    .model-history-table { width: 100%; min-width: 0; border-collapse: collapse; }
    .model-history-table th, .model-history-table td { padding: 10px 8px; border-bottom: 1px solid #27324a; text-align: left; vertical-align: top; font-size: 13px; }
    .model-history-table th { color: #9aa7bd; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .model-history-delta { display: block; margin-top: 3px; font-size: 12px; }
    .model-history-delta.up { color: #9be4c7; }
    .model-history-delta.down { color: #ffb4bc; }
    .model-history-delta.flat { color: #9aa7bd; }
    .model-link { font: inherit; text-align: left; }
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
        <label class="run-filter">Benchmark
          <select id="run-benchmark-filter">
            <option value="all">All benchmarks</option>
            <option value="gpqa_diamond">GPQA</option>
            <option value="tau_bench_verified_airline">TAU Airline</option>
            <option value="deep_swe">Deep SWE</option>
            <option value="swe_bench_verified">SWE-bench Verified</option>
            <option value="terminal_bench">Terminal-Bench 2.1</option>
            <option value="swe_atlas_qa">SWE Atlas QA</option>
            <option value="swe_atlas_tw">SWE Atlas Test Writing</option>
            <option value="swe_atlas_rf">SWE Atlas Refactoring</option>
          </select>
        </label>
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
        <div id="run-pagination" class="pagination">
          <button id="previous-run-page" class="secondary" type="button">Previous</button>
          <span id="run-page-summary" class="muted">Page 1 of 1</span>
          <button id="next-run-page" class="secondary" type="button">Next</button>
        </div>
        <div id="dashboard-error" class="error"></div>
      </div>
    </section>

    <dialog id="start-dialog">
      <div class="dialog-body">
        <h2>Start benchmark</h2>
        <form id="start-form">
          <div class="form-grid">
            <label>Benchmark
              <select id="start-benchmark" name="benchmark">
                <option value="gpqa_diamond">GPQA Diamond</option>
                <option value="tau_bench_verified_airline">TAU Bench Verified Airline</option>
                <option value="deep_swe">Deep SWE</option>
                <option value="swe_bench_verified">SWE-bench Verified</option>
                <option value="terminal_bench">Terminal-Bench 2.1</option>
                <option value="swe_atlas_qa">SWE Atlas QA</option>
                <option value="swe_atlas_tw">SWE Atlas Test Writing</option>
                <option value="swe_atlas_rf">SWE Atlas Refactoring</option>
              </select>
            </label>
            <div id="tau-user-simulator-default" class="wide muted" hidden>
              TAU always uses openai-gpt-5.4-mini as the simulated customer through DigitalOcean inference. The candidate inference token is reused for DigitalOcean production and test endpoints.
            </div>
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
            <label id="swe-atlas-judge-model-label" hidden>Judge model
              <input id="swe-atlas-judge-model" name="judgeModel" list="swe-atlas-judge-model-options" placeholder="Search models…" disabled>
              <datalist id="swe-atlas-judge-model-options"></datalist>
              <span id="swe-atlas-judge-model-status" class="field-hint">Runs through https://inference.do-ai.run/v1 using the server-configured judge key.</span>
            </label>
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
            <label id="tau-simulator-api-key-label" hidden>DigitalOcean simulator access token
              <input id="tau-simulator-api-key" name="simulatorApiKey" type="password" autocomplete="off" disabled>
              <span class="field-hint">Required when the candidate uses OpenRouter or a custom endpoint. The simulator runs through https://inference.do-ai.run/v1.</span>
            </label>
            <label>Epochs
              <input name="epochs" type="number" min="1" max="20" value="3" required>
            </label>
            <label>Concurrency
              <input name="concurrency" type="number" min="1" max="64" value="3" required>
            </label>
            <label class="checkbox">
              <input name="unordered" type="checkbox" checked>
              Use rolling unordered concurrency
              <span class="info-icon" role="img" tabindex="0" aria-label="Rolling concurrency information" data-tooltip="On: As soon as one question finishes, another starts, so request slots stay busy. This is faster and useful for quick results, but completion order differs from OpenRouter's ordered execution script. Final scores should usually be comparable, but identical scores are not guaranteed. Off: A slow early question can delay later work, so execution may be slower, but scheduling stays in 100% order sync with OpenRouter's execution script. This setting does not guarantee identical model responses.">i</span>
            </label>
            <label>Question limit
              <input name="limit" type="number" min="1" max="1000" placeholder="All questions">
            </label>
          </div>
          <details class="advanced-config">
            <summary>Advanced configuration</summary>
            <div class="form-grid">
              <label>Maximum output tokens
                <input name="maxTokens" type="number" min="1" step="1" placeholder="Provider default">
              </label>
              <label>Temperature
                <input name="temperature" type="number" min="0" max="2" step="0.1" value="1">
              </label>
              <label>Reasoning effort
                <select name="reasoningEffort">
                  <option value="">Provider default</option>
                  <option value="xhigh">xhigh</option>
                  <option value="high" selected>high</option>
                  <option value="medium">medium</option>
                  <option value="low">low</option>
                  <option value="minimal">minimal</option>
                  <option value="none">none</option>
                </select>
              </label>
              <label>Connection/header timeout (milliseconds)
                <input name="timeoutMs" type="number" min="1" step="1" placeholder="Harness default">
              </label>
              <label>Full response timeout (milliseconds)
                <input name="completionTimeoutMs" type="number" min="1" step="1" value="3600000">
                <span class="field-hint">Defaults to one hour per attempt. Timed-out attempts use the configured retry limit.</span>
              </label>
              <label>Endpoint ID
                <input name="endpointId" placeholder="Provider default">
              </label>
              <label>Cost tier
                <select name="costTier">
                  <option value="">Provider default</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="xhigh">xhigh</option>
                  <option value="max">max</option>
                </select>
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
              <label id="openrouter-provider-label" hidden>OpenRouter provider
                <select id="openrouter-provider" name="providerOnly" disabled>
                  <option value="">Any provider</option>
                  <option value="digitalocean">DigitalOcean only</option>
                </select>
              </label>
              <label id="openrouter-fallbacks-label" class="checkbox" hidden>
                <input id="openrouter-fallbacks" name="allowFallbacks" type="checkbox" checked disabled>
                Allow OpenRouter provider fallbacks
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
                <span class="field-hint">Only affects OpenRouter Auto Router conversations; leave at Provider default for direct model runs.</span>
              </label>
              <label>Maximum retries
                <input name="maxRetries" type="number" min="0" max="20" step="1" value="6">
              </label>
              <label>Start question index
                <input name="start" type="number" min="0" max="999" step="1" placeholder="Dataset start">
              </label>
              <label>End question index
                <input name="end" type="number" min="1" max="1000" step="1" placeholder="Dataset end">
              </label>
              <label>Log level
                <input name="logLevel" type="number" step="1" placeholder="Harness default">
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
    <button id="model-history-backdrop" class="model-history-backdrop" type="button" hidden aria-label="Close model history"></button>
    <aside id="model-history-drawer" class="model-history-drawer" hidden aria-labelledby="model-history-title">
      <div class="model-history-header">
        <div>
          <h2 id="model-history-title">Model history</h2>
          <div id="model-history-meta" class="model-history-meta"></div>
        </div>
        <button id="close-model-history" class="secondary" type="button">Close</button>
      </div>
      <div class="model-history-controls">
        <label>Benchmark
          <select id="model-history-benchmark">
            <option value="gpqa_diamond">GPQA</option>
            <option value="tau_bench_verified_airline">TAU Airline</option>
            <option value="deep_swe">Deep SWE</option>
            <option value="swe_bench_verified">SWE-bench Verified</option>
            <option value="terminal_bench">Terminal-Bench 2.1</option>
            <option value="swe_atlas_qa">SWE Atlas QA</option>
            <option value="swe_atlas_tw">SWE Atlas Test Writing</option>
            <option value="swe_atlas_rf">SWE Atlas Refactoring</option>
          </select>
        </label>
        <label class="checkbox">
          <input id="model-history-include-non-canary" type="checkbox">
          Include non-canary runs
        </label>
        <label>Status
          <select id="model-history-status">
            <option value="all">All</option>
            <option value="running">Running</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>
      <div class="model-history-body">
        <div id="model-history-summary" class="muted"></div>
        <table class="model-history-table">
          <thead>
            <tr>
              <th>Started</th>
              <th>Duration</th>
              <th>Status</th>
              <th>Quality</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="model-history-runs"></tbody>
        </table>
        <div id="model-history-empty" class="muted" hidden>No runs found for this model.</div>
        <div id="model-history-error" class="error"></div>
      </div>
    </aside>
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
    const startBenchmark = document.getElementById("start-benchmark");
    const tauUserSimulatorDefault = document.getElementById("tau-user-simulator-default");
    const tauSimulatorApiKeyLabel = document.getElementById(
      "tau-simulator-api-key-label"
    );
    const tauSimulatorApiKey = document.getElementById(
      "tau-simulator-api-key"
    );
    const sweAtlasJudgeModelLabel = document.getElementById(
      "swe-atlas-judge-model-label"
    );
    const sweAtlasJudgeModel = document.getElementById(
      "swe-atlas-judge-model"
    );
    const sweAtlasJudgeModelOptions = document.getElementById(
      "swe-atlas-judge-model-options"
    );
    const sweAtlasJudgeModelStatus = document.getElementById(
      "swe-atlas-judge-model-status"
    );
    const startError = document.getElementById("start-error");
    const submitStart = document.getElementById("submit-start");
    const runDetailBanner = document.getElementById("run-detail-banner");
    const runDetailTitle = document.getElementById("run-detail-title");
    const backToRuns = document.getElementById("back-to-runs");
    const runFiltersPanel = document.getElementById("run-filters-panel");
    const modelHistoryBackdrop = document.getElementById("model-history-backdrop");
    const modelHistoryDrawer = document.getElementById("model-history-drawer");
    const modelHistoryMeta = document.getElementById("model-history-meta");
    const modelHistoryIncludeNonCanary = document.getElementById(
      "model-history-include-non-canary"
    );
    const modelHistoryBenchmark = document.getElementById(
      "model-history-benchmark"
    );
    const modelHistoryStatus = document.getElementById("model-history-status");
    const modelHistorySummary = document.getElementById("model-history-summary");
    const modelHistoryRuns = document.getElementById("model-history-runs");
    const modelHistoryEmpty = document.getElementById("model-history-empty");
    const modelHistoryError = document.getElementById("model-history-error");
    let modelHistoryContext = null;
    let modelHistoryRequestId = 0;
    const inferenceBaseUrl = document.getElementById("inference-base-url");
    const catalogModelLabel = document.getElementById("catalog-model-label");
    const catalogModel = document.getElementById("catalog-model");
    const catalogModelOptions = document.getElementById("catalog-model-options");
    const catalogModelStatus = document.getElementById("catalog-model-status");
    const manualBaseUrlLabel = document.getElementById("manual-base-url-label");
    const manualModelLabel = document.getElementById("manual-model-label");
    const manualBaseUrl = document.getElementById("manual-base-url");
    const manualModel = document.getElementById("manual-model");
    const openrouterProviderLabel = document.getElementById("openrouter-provider-label");
    const openrouterProvider = document.getElementById("openrouter-provider");
    const openrouterFallbacksLabel = document.getElementById("openrouter-fallbacks-label");
    const openrouterFallbacks = document.getElementById("openrouter-fallbacks");
    const runBenchmarkFilter = document.getElementById("run-benchmark-filter");
    const runModelFilter = document.getElementById("run-model-filter");
    const runDurationFilter = document.getElementById("run-duration-filter");
    const runTriggeredFilter = document.getElementById("run-triggered-filter");
    const runStatusFilter = document.getElementById("run-status-filter");
    const runQualityFilter = document.getElementById("run-quality-filter");
    const hideCanaryRuns = document.getElementById("hide-canary-runs");
    const showDisabledRuns = document.getElementById("show-disabled-runs");
    const runFilterSummary = document.getElementById("run-filter-summary");
    const runPagination = document.getElementById("run-pagination");
    const previousRunPage = document.getElementById("previous-run-page");
    const nextRunPage = document.getElementById("next-run-page");
    const runPageSummary = document.getElementById("run-page-summary");
    let loadedRuns = [];
    let runPage = 1;
    let runPageSize = 50;
    let runTotal = 0;
    let runTotalPages = 1;
    let runSummary = { total: 0, running: 0, failed: 0 };
    let filterTimer;
    let runRequestVersion = 0;
    let catalogRequestVersion = 0;
    let judgeCatalogRequestVersion = 0;
    let catalogReady = false;
    let catalogModels = new Set();
    let judgeCatalogReady = false;
    let judgeCatalogModels = new Set();

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

    function legacyCopyText(text, targetDocument = document) {
      const input = targetDocument.createElement("textarea");
      input.value = text;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      targetDocument.body.appendChild(input);
      input.select();
      const copied = targetDocument.execCommand("copy");
      input.remove();
      return copied;
    }

    async function copyTextToClipboard(text, targetDocument = document) {
      try {
        const clipboard = targetDocument.defaultView?.navigator.clipboard;
        if (clipboard?.writeText !== undefined) {
          await clipboard.writeText(text);
          return true;
        }
      } catch {
        // Fall back for non-secure HTTP dashboard origins.
      }
      try {
        return legacyCopyText(text, targetDocument);
      } catch {
        return false;
      }
    }

    async function copyRunLink(id) {
      const link = runDashboardUrl(id);
      if (await copyTextToClipboard(link)) {
        dashboardError.textContent = "Run link copied.";
      } else {
        dashboardError.textContent =
          "Could not copy the link automatically: " + link;
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

    function setJudgeCatalogModels(models) {
      judgeCatalogModels = new Set(models);
      sweAtlasJudgeModelOptions.replaceChildren();
      for (const model of models) {
        const option = document.createElement("option");
        option.value = model;
        sweAtlasJudgeModelOptions.appendChild(option);
      }
    }

    function isSweAtlasBenchmark(benchmark) {
      return (
        benchmark === "swe_atlas_qa" ||
        benchmark === "swe_atlas_tw" ||
        benchmark === "swe_atlas_rf"
      );
    }

    async function configureJudgeModelControls() {
      const isSweAtlas = isSweAtlasBenchmark(startBenchmark.value);
      const requestVersion = ++judgeCatalogRequestVersion;
      if (!isSweAtlas) {
        judgeCatalogReady = false;
        judgeCatalogModels = new Set();
        sweAtlasJudgeModelOptions.replaceChildren();
        return;
      }
      judgeCatalogReady = false;
      sweAtlasJudgeModel.disabled = true;
      sweAtlasJudgeModelStatus.textContent =
        "Loading models for https://inference.do-ai.run/v1…";
      try {
        const response = await api(
          "/model-catalog?baseUrl=" +
            encodeURIComponent("https://inference.do-ai.run/v1")
        );
        const data = await response.json();
        if (requestVersion !== judgeCatalogRequestVersion) {
          return;
        }
        const models = Array.isArray(data.models) ? data.models : [];
        if (models.length === 0) {
          sweAtlasJudgeModelStatus.textContent =
            "No judge models are currently available.";
          return;
        }
        setJudgeCatalogModels(models);
        if (!judgeCatalogModels.has(sweAtlasJudgeModel.value)) {
          sweAtlasJudgeModel.value = "";
        }
        sweAtlasJudgeModel.disabled = false;
        judgeCatalogReady = true;
        sweAtlasJudgeModelStatus.textContent =
          models.length +
          " models available through https://inference.do-ai.run/v1 using the server-configured judge key.";
      } catch (error) {
        if (requestVersion !== judgeCatalogRequestVersion) {
          return;
        }
        sweAtlasJudgeModelStatus.textContent =
          "Could not load judge models: " + String(error);
      }
    }

    function isDigitalOceanCandidateBaseUrl(value) {
      return (
        value === "https://inference.do-ai.run/v1" ||
        value === "https://inference.do-ai-test.run/v1"
      );
    }

    function configureTauSimulatorControls() {
      const isTau = startBenchmark.value === "tau_bench_verified_airline";
      const requiresSimulatorApiKey =
        isTau && !isDigitalOceanCandidateBaseUrl(inferenceBaseUrl.value);
      tauSimulatorApiKeyLabel.hidden = !requiresSimulatorApiKey;
      tauSimulatorApiKey.disabled = !requiresSimulatorApiKey;
      tauSimulatorApiKey.required = requiresSimulatorApiKey;
      if (!requiresSimulatorApiKey) {
        tauSimulatorApiKey.value = "";
      }
    }

    async function configureInferenceControls() {
      const isOther = inferenceBaseUrl.value === "other";
      configureTauSimulatorControls();
      const isOpenRouter =
        inferenceBaseUrl.value === "https://openrouter.ai/api/v1";
      openrouterProviderLabel.hidden = !isOpenRouter;
      openrouterFallbacksLabel.hidden = !isOpenRouter;
      openrouterProvider.disabled = !isOpenRouter;
      openrouterFallbacks.disabled = !isOpenRouter;
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
          catalogModelStatus.textContent = "No models are currently available.";
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
          "Could not load models: " + String(error);
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

    function formatLatencyMs(value) {
      const milliseconds = Number(value);
      return value !== null &&
        value !== undefined &&
        Number.isFinite(milliseconds)
        ? (milliseconds / 1000).toFixed(2) + " s"
        : "Not available";
    }

    function formatQuality(value) {
      return typeof value === "number" ? (value * 100).toFixed(2) + "%" : "—";
    }

    function formatQualityDelta(current, previous) {
      if (typeof current !== "number" || typeof previous !== "number") {
        return null;
      }
      const delta = (current - previous) * 100;
      const rounded = delta.toFixed(2);
      if (Math.abs(delta) < 0.005) {
        return { text: "0.00%", className: "flat" };
      }
      return {
        text: (delta > 0 ? "+" : "") + rounded + "%",
        className: delta > 0 ? "up" : "down"
      };
    }

    function closeModelHistory() {
      modelHistoryBackdrop.hidden = true;
      modelHistoryDrawer.hidden = true;
      modelHistoryContext = null;
      modelHistoryError.textContent = "";
    }

    function openModelHistory(model, benchmark) {
      modelHistoryContext = { model };
      modelHistoryIncludeNonCanary.checked = false;
      modelHistoryStatus.value = "all";
      modelHistoryBenchmark.value =
        benchmark === "tau_bench_verified_airline" ||
        benchmark === "deep_swe" ||
        benchmark === "swe_bench_verified" ||
        benchmark === "terminal_bench" ||
        isSweAtlasBenchmark(benchmark)
          ? benchmark
          : "gpqa_diamond";
      modelHistoryMeta.textContent = model;
      modelHistoryBackdrop.hidden = false;
      modelHistoryDrawer.hidden = false;
      void loadModelHistory();
    }

    function modelHistoryPath() {
      if (modelHistoryContext === null) {
        return null;
      }
      const parameters = new URLSearchParams({
        view: "page",
        page: "1",
        pageSize: "50",
        model: modelHistoryContext.model,
        modelExact: "1",
        benchmark: modelHistoryBenchmark.value,
        fullSuiteOnly: "1",
        showDisabled: "0"
      });
      if (!modelHistoryIncludeNonCanary.checked) {
        parameters.set("canaryOnly", "1");
      }
      if (modelHistoryStatus.value !== "all") {
        parameters.set("status", modelHistoryStatus.value);
      }
      return "/runs?" + parameters.toString();
    }

    function renderModelHistory(runs, total) {
      modelHistoryRuns.replaceChildren();
      modelHistoryEmpty.hidden = runs.length !== 0;
      modelHistorySummary.textContent =
        runs.length === 0
          ? ""
          : "Showing " + runs.length + " of " + total + " runs (newest first)";
      for (let index = 0; index < runs.length; index += 1) {
        const run = runs[index];
        let previousScore = null;
        for (let older = index + 1; older < runs.length; older += 1) {
          if (typeof runs[older].qualityScore === "number") {
            previousScore = runs[older].qualityScore;
            break;
          }
        }
        const row = document.createElement("tr");
        addCell(row, formatDate(run.startedAt));
        addCell(row, formatDuration(run.startedAt, run.finishedAt));
        const statusCell = document.createElement("td");
        const status = document.createElement("span");
        status.className = "status " + run.status;
        status.textContent = run.status;
        statusCell.appendChild(status);
        row.appendChild(statusCell);
        const qualityCell = document.createElement("td");
        qualityCell.textContent = formatQuality(run.qualityScore);
        const delta = formatQualityDelta(run.qualityScore, previousScore);
        if (delta !== null) {
          const deltaEl = document.createElement("span");
          deltaEl.className = "model-history-delta " + delta.className;
          deltaEl.textContent = delta.text;
          qualityCell.appendChild(deltaEl);
        }
        row.appendChild(qualityCell);
        const openCell = document.createElement("td");
        const open = document.createElement("a");
        open.className = "link";
        open.href = runDashboardUrl(run.id);
        open.textContent = "Open";
        open.addEventListener("click", (event) => {
          event.preventDefault();
          closeModelHistory();
          const url = new URL(runDashboardUrl(run.id));
          window.history.pushState({}, "", url);
          void loadRuns();
        });
        openCell.appendChild(open);
        row.appendChild(openCell);
        modelHistoryRuns.appendChild(row);
      }
    }

    async function loadModelHistory() {
      const path = modelHistoryPath();
      if (path === null) {
        return;
      }
      const requestId = ++modelHistoryRequestId;
      modelHistoryError.textContent = "";
      modelHistorySummary.textContent = "Loading…";
      modelHistoryEmpty.hidden = true;
      try {
        const response = await api(path);
        const payload = await response.json();
        if (requestId !== modelHistoryRequestId) {
          return;
        }
        const runs = Array.isArray(payload.runs) ? payload.runs : [];
        renderModelHistory(runs, Number(payload.total || 0));
      } catch (error) {
        if (requestId !== modelHistoryRequestId) {
          return;
        }
        modelHistoryRuns.replaceChildren();
        modelHistorySummary.textContent = "";
        modelHistoryEmpty.hidden = true;
        modelHistoryError.textContent = String(error.message || error);
      }
    }

    function advancedConfigurationEntries(run) {
      const inference = run.args.inference;
      const execution = run.args.execution;
      let pinModel;
      if (inference.pinModel !== undefined) {
        pinModel = inference.pinModel ? "Enabled" : "Disabled";
      }
      const providerOnly = Array.isArray(inference.providerOnly)
        ? inference.providerOnly.join(", ")
        : undefined;
      const allowFallbacks =
        inference.allowFallbacks === undefined
          ? undefined
          : inference.allowFallbacks
            ? "Enabled"
            : "Disabled";
      return [
        ["Judge model", run.args.judgeModel],
        ["Max tokens", inference.maxTokens],
        ["Temperature", inference.temperature],
        ["Reasoning", inference.reasoningEffort],
        ["Connection timeout", inference.timeoutMs],
        ["Full response timeout", inference.completionTimeoutMs],
        ["Endpoint ID", inference.endpointId],
        ["Cost tier", inference.costTier],
        ["Sort", inference.sort],
        ["Provider only", providerOnly],
        ["Provider fallbacks", allowFallbacks],
        ["Cloudflare", inference.cloudflareVersion],
        ["Cost-quality", inference.costQualityTradeoff],
        ["Pin model", pinModel],
        ["Max retries", execution.maxRetries],
      ].filter(([, value]) => value !== undefined);
    }

    function applyRunFilters() {
      window.clearTimeout(filterTimer);
      runPage = 1;
      void loadRuns();
    }

    function paginatedRunsPath() {
      const parameters = new URLSearchParams({
        view: "page",
        page: String(runPage),
        pageSize: String(runPageSize),
        hideCanary: hideCanaryRuns.checked ? "1" : "0",
        showDisabled: showDisabledRuns.checked ? "1" : "0",
      });
      for (const [name, value] of [
        ["benchmark", runBenchmarkFilter.value],
        ["model", runModelFilter.value.trim()],
        ["durationGt", runDurationFilter.value.trim()],
        ["triggeredBy", runTriggeredFilter.value.trim()],
        ["status", runStatusFilter.value],
        ["qualityLt", runQualityFilter.value.trim()],
      ]) {
        if (value !== "" && value !== "all") {
          parameters.set(name, value);
        }
      }
      return "/runs?" + parameters.toString();
    }

    function updateRunPageControls() {
      const start = runTotal === 0 ? 0 : (runPage - 1) * runPageSize + 1;
      const end = Math.min(runPage * runPageSize, runTotal);
      runFilterSummary.textContent =
        "Showing " + start + "–" + end + " of " + runTotal + " runs";
      runPageSummary.textContent =
        "Page " + runPage + " of " + runTotalPages;
      previousRunPage.disabled = runPage <= 1;
      nextRunPage.disabled = runPage >= runTotalPages;
      runPagination.hidden = selectedRunId() !== null;
    }

    function renderRuns(runs) {
      const body = document.getElementById("runs");
      body.replaceChildren();
      const empty = document.getElementById("empty");
      empty.hidden = runs.length !== 0;
      empty.textContent =
        runTotal === 0
          ? "No benchmark runs found."
          : "No benchmark runs match the current filters.";
      let serial = selectedRunId() === null ? (runPage - 1) * runPageSize : 0;
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
        const configurationCell = document.createElement("td");
        configurationCell.className = "details configuration";
        const modelLine = document.createElement("div");
        modelLine.appendChild(document.createTextNode("Model: "));
        const modelLink = document.createElement("button");
        modelLink.className = "link model-link";
        modelLink.type = "button";
        modelLink.textContent = run.args.inference.model;
        modelLink.title = "View recent runs for this model";
        modelLink.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openModelHistory(run.args.inference.model, run.args.benchmark);
        });
        modelLine.appendChild(modelLink);
        configurationCell.appendChild(modelLine);
        const configRest = document.createElement("div");
        configRest.textContent =
          "Benchmark: " + run.args.benchmark + "\\n" +
          "Base URL: " + run.args.inference.baseUrl;
        configurationCell.appendChild(configRest);
        row.appendChild(configurationCell);
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
        if (run.status === "failed" && run.failureReason) {
          const failureDetails = document.createElement("details");
          failureDetails.className = "run-failure";
          const failureSummary = document.createElement("summary");
          failureSummary.textContent = "Failure reason";
          const failureReason = document.createElement("pre");
          failureReason.textContent = run.failureReason;
          failureDetails.appendChild(failureSummary);
          failureDetails.appendChild(failureReason);
          statusCell.appendChild(failureDetails);
        }
        if (run.status === "running") {
          const cancel = document.createElement("button");
          cancel.className = "link cancel-run";
          cancel.type = "button";
          cancel.textContent = "Cancel run";
          cancel.addEventListener("click", () => cancelBenchmark(run.id, cancel));
          statusCell.appendChild(cancel);
        }
        const retry = document.createElement("button");
        retry.className = "link cancel-run";
        retry.type = "button";
        retry.textContent = "Retry run";
        retry.title =
          "Open Start benchmark with this run's configuration and empty credentials";
        retry.addEventListener("click", () => void openRunRetry(run));
        statusCell.appendChild(retry);
        if (run.status !== "running") {
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
          if (run.args.benchmark === "gpqa_diamond") {
            const report = document.createElement("button");
            report.className = "link";
            report.type = "button";
            report.textContent = "View";
            report.addEventListener("click", () => openGpqaReport(run.id));
            const downloadReport = document.createElement("button");
            downloadReport.className = "link";
            downloadReport.type = "button";
            downloadReport.textContent = "Download";
            downloadReport.addEventListener("click", () =>
              downloadArtifact(
                "/runs/" + encodeURIComponent(run.id) +
                  "/gpqa-report?download=1",
                run.id + "-gpqa-report.json"
              )
            );
            addArtifactRow(artifactLinks, "GPQA report", [
              report,
              downloadReport,
            ]);
          }
          if (run.args.benchmark === "tau_bench_verified_airline") {
            const report = document.createElement("button");
            report.className = "link";
            report.type = "button";
            report.textContent = "View";
            report.addEventListener("click", () =>
              openTauAirlineReport(run.id)
            );
            const downloadReport = document.createElement("button");
            downloadReport.className = "link";
            downloadReport.type = "button";
            downloadReport.textContent = "Download";
            downloadReport.addEventListener("click", () =>
              downloadArtifact(
                "/runs/" + encodeURIComponent(run.id) +
                  "/tau-airline-report?download=1",
                run.id + "-tau-airline-report.json"
              )
            );
            addArtifactRow(artifactLinks, "TAU report", [
              report,
              downloadReport,
            ]);
          }
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
        runSummary.total
      );
      document.getElementById("running-runs").textContent = String(
        runSummary.running
      );
      document.getElementById("failed-runs").textContent = String(
        runSummary.failed
      );
      updateRunPageControls();
    }

    async function loadRuns() {
      dashboardError.textContent = "";
      const requestVersion = ++runRequestVersion;
      try {
        const runId = selectedRunId();
        const response = await api(
          runId === null
            ? paginatedRunsPath()
            : "/runs/" + encodeURIComponent(runId)
        );
        const data = await response.json();
        if (requestVersion !== runRequestVersion) {
          return;
        }
        if (runId === null) {
          loadedRuns = Array.isArray(data.runs) ? data.runs : [];
          runPage = Number(data.page) || 1;
          runPageSize = Number(data.pageSize) || 50;
          runTotal = Number(data.total) || 0;
          runTotalPages = Number(data.totalPages) || 1;
          runSummary = {
            total: Number(data.summary?.total) || 0,
            running: Number(data.summary?.running) || 0,
            failed: Number(data.summary?.failed) || 0,
          };
        } else {
          loadedRuns = [data];
          runPage = 1;
          runTotal = 1;
          runTotalPages = 1;
          runSummary = {
            total: 1,
            running: data.status === "running" ? 1 : 0,
            failed: data.status === "failed" ? 1 : 0,
          };
        }
        runDetailBanner.hidden = runId === null;
        runFiltersPanel.hidden = runId !== null;
        runDetailTitle.textContent =
          runId === null ? "" : "Run details: " + runId;
        renderRuns(loadedRuns);
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

    function appendGpqaRequestAnalytics(document, analytics) {
      if (!analytics) {
        return;
      }
      const diagnostics = document.createElement("details");
      diagnostics.className = "gpqa-diagnostics";
      diagnostics.open = true;
      const diagnosticsSummary = document.createElement("summary");
      diagnosticsSummary.textContent = "GPQA score diagnostics";
      diagnostics.appendChild(diagnosticsSummary);
      const note = document.createElement("div");
      note.className = "gpqa-note";
      note.textContent =
        "Computed from the existing GPQA Parquet report. Accuracy excludes skipped evaluations; counts are shown to avoid over-interpreting small buckets.";
      diagnostics.appendChild(note);
      const percent = (value) =>
        value === null || value === undefined
          ? "—"
          : (Number(value) * 100).toFixed(2) + "%";
      const addTable = (titleText, description, headers, rows) => {
        const section = document.createElement("section");
        section.className = "gpqa-analysis-section";
        const heading = document.createElement("h3");
        heading.textContent = titleText;
        section.appendChild(heading);
        if (description) {
          const descriptionElement = document.createElement("div");
          descriptionElement.className = "gpqa-note";
          descriptionElement.textContent = description;
          section.appendChild(descriptionElement);
        }
        const wrap = document.createElement("div");
        wrap.className = "gpqa-table-wrap";
        const table = document.createElement("table");
        table.className = "gpqa-table";
        const head = document.createElement("thead");
        const headRow = document.createElement("tr");
        for (const header of headers) {
          const cell = document.createElement("th");
          cell.textContent = header;
          headRow.appendChild(cell);
        }
        head.appendChild(headRow);
        table.appendChild(head);
        const body = document.createElement("tbody");
        for (const values of rows) {
          const row = document.createElement("tr");
          for (const value of values) {
            const cell = document.createElement("td");
            cell.textContent =
              value === null || value === undefined ? "—" : String(value);
            row.appendChild(cell);
          }
          body.appendChild(row);
        }
        table.appendChild(body);
        wrap.appendChild(table);
        section.appendChild(wrap);
        diagnostics.appendChild(section);
      };
      const consistency = analytics.epochConsistency || {};
      const consistencyCards = document.createElement("div");
      consistencyCards.className = "gpqa-consistency-grid";
      for (const [label, value] of [
        ["Questions", consistency.questions],
        ["Consistently correct", consistency.consistentCorrect],
        ["Consistently incorrect", consistency.consistentIncorrect],
        ["Mixed / incomplete", consistency.mixedOrIncomplete],
        ["All skipped", consistency.allSkipped],
        ["Single observation", consistency.singleObservation],
      ]) {
        const card = document.createElement("div");
        card.className = "metric-card";
        const metricValue = document.createElement("div");
        metricValue.className = "metric-value";
        metricValue.textContent = String(value ?? 0);
        const metricLabel = document.createElement("div");
        metricLabel.className = "metric-label";
        metricLabel.textContent = label;
        card.appendChild(metricValue);
        card.appendChild(metricLabel);
        consistencyCards.appendChild(card);
      }
      const consistencySection = document.createElement("section");
      consistencySection.className = "gpqa-analysis-section";
      const consistencyHeading = document.createElement("h3");
      consistencyHeading.textContent = "Epoch consistency";
      consistencySection.appendChild(consistencyHeading);
      consistencySection.appendChild(consistencyCards);
      diagnostics.appendChild(consistencySection);
      const bucketRows = (buckets) =>
        (buckets || []).map((bucket) => [
          bucket.label,
          bucket.evaluations,
          bucket.correct,
          percent(bucket.accuracy),
        ]);
      addTable(
        "Latency vs correctness",
        "Fixed latency buckets; empty buckets are hidden.",
        ["Latency bucket", "Evaluations", "Correct", "Accuracy"],
        bucketRows(analytics.latencyVsCorrectness)
      );
      addTable(
        "Response-quality diagnostics",
        "Repetition is a deterministic text heuristic, not a model judgment.",
        ["Diagnostic", "Count", "Rate"],
        (analytics.responseQuality || []).map((entry) => [
          entry.name,
          entry.count,
          percent(entry.rate),
        ])
      );
      addTable(
        "Response length vs correctness",
        "Length is measured using existing model-answer characters.",
        ["Characters", "Evaluations", "Correct", "Accuracy"],
        bucketRows(analytics.responseLengthVsCorrectness)
      );
      addTable(
        "Reasoning length vs correctness",
        "Length is measured using provider-exposed reasoning characters.",
        ["Characters", "Evaluations", "Correct", "Accuracy"],
        bucketRows(analytics.reasoningLengthVsCorrectness)
      );
      addTable(
        "Hardest questions",
        "Lowest accuracy first, then no-answer count and average latency.",
        [
          "Sample",
          "Question",
          "Subdomain",
          "Correct",
          "Skipped",
          "No answer",
          "Accuracy",
          "Avg latency",
        ],
        (analytics.hardestQuestions || []).map((entry) => [
          entry.sampleId,
          entry.question.length > 140
            ? entry.question.slice(0, 137) + "..."
            : entry.question,
          entry.subdomain,
          entry.correct + "/" + entry.evaluations,
          entry.skipped,
          entry.noAnswer,
          percent(entry.accuracy),
          formatLatencyMs(entry.averageLatencyMs),
        ])
      );
      addTable(
        "Epoch trends",
        "Accuracy, response health, latency, and output size by epoch.",
        [
          "Epoch",
          "Evaluations",
          "Correct",
          "Skipped",
          "No answer",
          "Accuracy",
          "Avg latency",
          "Avg response chars",
          "Avg reasoning chars",
        ],
        (analytics.epochTrends || []).map((entry) => [
          Number(entry.epoch) + 1,
          entry.evaluations,
          entry.correct,
          entry.skipped,
          entry.noAnswer,
          percent(entry.accuracy),
          formatLatencyMs(entry.averageLatencyMs),
          entry.averageResponseCharacters === null
            ? "—"
            : Number(entry.averageResponseCharacters).toFixed(0),
          entry.averageReasoningCharacters === null
            ? "—"
            : Number(entry.averageReasoningCharacters).toFixed(0),
        ])
      );
      document.body.appendChild(diagnostics);
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
      if (tab.__requestAutoRefreshTimer) {
        window.clearTimeout(tab.__requestAutoRefreshTimer);
        tab.__requestAutoRefreshTimer = undefined;
      }
      if (!existingTab) {
        tab.__requestRaw = "";
        tab.__requestOffset = 0;
        tab.__expandedRequestIds = new Set();
        tab.__requestMap = new Map();
        tab.__requestRemainder = "";
        tab.__requestInvalidLines = [];
        tab.__requestLineCount = 0;
      }
      const filterState = tab.__requestFilterState || {
        status: "all",
        errorsOnly: false,
        duration: "",
        attempt: "",
        page: 1,
      };
      tab.__requestFilterState = filterState;
      tab.document.title = "Inference requests";
      if (!existingTab) {
        tab.document.body.textContent = "Loading request records…";
      }
      try {
        const offset = Number(tab.__requestOffset || 0);
        const [response, runResponse] = await Promise.all([
          api(
            "/runs/" + encodeURIComponent(id) + "/request-records" +
              (offset > 0 ? "?after=" + encodeURIComponent(offset) : "")
          ),
          api("/runs/" + encodeURIComponent(id)),
        ]);
        const runMetadata = await runResponse.json();
        const chunk = await response.text();
        const reset = response.headers.get("x-request-log-reset") === "1";
        const nextOffset = response.headers.get(
          "x-request-log-next-offset"
        );
        const raw =
          offset > 0 && !reset ? String(tab.__requestRaw || "") + chunk : chunk;
        tab.__requestRaw = raw;
        tab.__requestOffset =
          nextOffset === null ? 0 : Number(nextOffset);
        if (reset || offset === 0) {
          tab.__requestMap = new Map();
          tab.__requestRemainder = "";
          tab.__requestInvalidLines = [];
          tab.__requestLineCount = 0;
        }
        const parseText = String(tab.__requestRemainder || "") + chunk;
        const lines = parseText.split("\\n");
        tab.__requestRemainder = parseText.endsWith("\\n")
          ? ""
          : lines.pop() || "";
        const invalidLines = tab.__requestInvalidLines || [];
        tab.__requestInvalidLines = invalidLines;
        const events = lines.flatMap((line) => {
          if (line.trim().length === 0) {
            return [];
          }
          tab.__requestLineCount = Number(tab.__requestLineCount || 0) + 1;
          try {
            return [JSON.parse(line)];
          } catch {
            invalidLines.push(tab.__requestLineCount);
            return [];
          }
        });
        const requests = tab.__requestMap || new Map();
        tab.__requestMap = requests;
        for (const event of events) {
          const requestId = String(event.request_id || "unknown");
          const current = requests.get(requestId) || { requestId };
          if (event.event === "started") {
            current.started = event;
          } else if (event.event === "progress") {
            current.latestProgress = event;
            current.content =
              String(current.content || "") +
              String(event.content_delta || "");
            current.reasoning =
              String(current.reasoning || "") +
              String(event.reasoning_delta || "");
            if (event.reasoning_details !== undefined) {
              current.reasoningDetails = event.reasoning_details;
            }
            if (Array.isArray(event.tool_call_deltas)) {
              current.toolCallDeltas = (
                current.toolCallDeltas || []
              ).concat(event.tool_call_deltas);
            }
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
        tab.__requestPendingCount = pending;
        const snapshotPerf =
          runMetadata.status !== "running" &&
          runMetadata.performanceReport?.status === "complete"
            ? runMetadata.performanceReport.report?.requestPerf || null
            : null;
        let gpqaAnalytics = tab.__gpqaAnalytics || null;
        if (
          gpqaAnalytics === null &&
          runMetadata.status !== "running" &&
          runMetadata.performanceReport?.report?.gpqa?.analytics
        ) {
          gpqaAnalytics = runMetadata.performanceReport.report.gpqa.analytics;
          tab.__gpqaAnalytics = gpqaAnalytics;
        }
        if (
          runMetadata.args?.benchmark === "gpqa_diamond" &&
          runMetadata.status !== "running" &&
          gpqaAnalytics === null
        ) {
          try {
            const reportResponse = await api(
              "/runs/" + encodeURIComponent(id) + "/gpqa-report"
            );
            const report = await reportResponse.json();
            gpqaAnalytics = report.analytics || null;
            tab.__gpqaAnalytics = gpqaAnalytics;
          } catch {
            gpqaAnalytics = null;
          }
        }
        const successful = entries.filter(
          (entry) => entry.completed?.ok
        ).length;
        const errors = entries.length - pending - successful;
        const completedEntries = entries.filter((entry) => entry.completed);
        const completedDurationsMs = completedEntries
          .map((entry) => Number(entry.completed?.duration_ms))
          .filter((value) => Number.isFinite(value) && value >= 0)
          .sort((a, b) => a - b);
        const percentile = (values, quantile) => {
          if (values.length === 0) {
            return null;
          }
          const position = (values.length - 1) * quantile;
          const lowerIndex = Math.floor(position);
          const upperIndex = Math.ceil(position);
          const lower = values[lowerIndex];
          const upper = values[upperIndex];
          return lower + (upper - lower) * (position - lowerIndex);
        };
        const percentage = (numerator, denominator) =>
          denominator > 0
            ? ((numerator / denominator) * 100).toFixed(2) + "%"
            : "—";
        const formatRateCount = (rateValue, count, total) =>
          (rateValue === null || rateValue === undefined
            ? "—"
            : (rateValue * 100).toFixed(2) + "%") +
          " · " +
          count +
          "/" +
          total;
        const meanDurationMs =
          completedDurationsMs.length > 0
            ? completedDurationsMs.reduce((sum, value) => sum + value, 0) /
              completedDurationsMs.length
            : null;
        const maxDurationMs =
          completedDurationsMs[completedDurationsMs.length - 1] ?? null;
        const errorEntries = completedEntries.filter(
          (entry) => !entry.completed?.ok
        );
        const postProcessingFailures = errorEntries.filter((entry) => {
          const completed = entry.completed;
          if (completed?.failure_stage === "response_processing") {
            return true;
          }
          const status = Number(completed?.status);
          return (
            !completed?.failure_stage &&
            Number.isFinite(status) &&
            status >= 200 &&
            status < 300
          );
        });
        const errorStatusCounts = new Map();
        if (snapshotPerf && Array.isArray(snapshotPerf.errorStatusCounts)) {
          for (const item of snapshotPerf.errorStatusCounts) {
            errorStatusCounts.set(String(item.status), Number(item.count) || 0);
          }
        } else {
          for (const entry of errorEntries) {
            const rawStatus = entry.completed?.status;
            const status =
              rawStatus === null || rawStatus === undefined
                ? "No status"
                : String(rawStatus);
            errorStatusCounts.set(status, (errorStatusCounts.get(status) || 0) + 1);
          }
        }
        const retryAttempts = snapshotPerf
          ? Number(snapshotPerf.retryAttemptCount || 0)
          : entries.filter((entry) => {
              const attempt = Number(
                entry.started?.attempt ?? entry.completed?.attempt
              );
              return Number.isFinite(attempt) && attempt > 1;
            }).length;
        const nowMs = Date.now();
        const concurrencyPoints = [];
        let earliestStartedMs = Number.POSITIVE_INFINITY;
        let latestObservedMs = Number.NEGATIVE_INFINITY;
        let activeDurationMs = 0;
        for (const entry of entries) {
          const startedMs = new Date(
            entry.started?.started_at || entry.completed?.started_at || ""
          ).getTime();
          const finishedMs = entry.completed
            ? new Date(entry.completed.finished_at || "").getTime()
            : nowMs;
          if (
            !Number.isFinite(startedMs) ||
            !Number.isFinite(finishedMs) ||
            finishedMs < startedMs
          ) {
            continue;
          }
          earliestStartedMs = Math.min(earliestStartedMs, startedMs);
          latestObservedMs = Math.max(latestObservedMs, finishedMs);
          activeDurationMs += finishedMs - startedMs;
          concurrencyPoints.push([startedMs, 1], [finishedMs, -1]);
        }
        concurrencyPoints.sort(
          (a, b) => a[0] - b[0] || a[1] - b[1]
        );
        let activeRequests = 0;
        let peakConcurrency = 0;
        for (const point of concurrencyPoints) {
          activeRequests += point[1];
          peakConcurrency = Math.max(peakConcurrency, activeRequests);
        }
        const observedDurationMs =
          Number.isFinite(earliestStartedMs) &&
          Number.isFinite(latestObservedMs) &&
          latestObservedMs > earliestStartedMs
            ? latestObservedMs - earliestStartedMs
            : null;
        const averageConcurrency =
          observedDurationMs === null
            ? null
            : activeDurationMs / observedDurationMs;
        const throughputPerMinute =
          observedDurationMs === null
            ? null
            : completedEntries.length / (observedDurationMs / 60000);
        let outputTokens = 0;
        let outputTokenDurationMs = 0;
        for (const entry of completedEntries) {
          if (!entry.completed?.ok) {
            continue;
          }
          const usage = entry.completed.usage;
          const tokens = Number(
            usage?.outputTokens ?? usage?.output_tokens
          );
          const durationMs = Number(entry.completed.duration_ms);
          if (
            Number.isFinite(tokens) &&
            tokens >= 0 &&
            Number.isFinite(durationMs) &&
            durationMs > 0
          ) {
            outputTokens += tokens;
            outputTokenDurationMs += durationMs;
          }
        }
        const outputTokensPerSecond =
          outputTokenDurationMs > 0
            ? outputTokens / (outputTokenDurationMs / 1000)
            : null;
        const latencyFromSnapshot = snapshotPerf
          ? [
              ["P50 latency", formatLatencyMs(snapshotPerf.latencyMs?.p50)],
              ["P75 latency", formatLatencyMs(snapshotPerf.latencyMs?.p75)],
              ["P90 latency", formatLatencyMs(snapshotPerf.latencyMs?.p90)],
              ["P95 latency", formatLatencyMs(snapshotPerf.latencyMs?.p95)],
              ["Mean latency", formatLatencyMs(snapshotPerf.latencyMs?.mean)],
              ["Maximum latency", formatLatencyMs(snapshotPerf.latencyMs?.max)],
              [
                "Peak in-flight",
                snapshotPerf.peakInFlight === null ||
                snapshotPerf.peakInFlight === undefined
                  ? "—"
                  : String(snapshotPerf.peakInFlight),
              ],
              [
                "Average in-flight",
                snapshotPerf.averageInFlight === null ||
                snapshotPerf.averageInFlight === undefined
                  ? "—"
                  : Number(snapshotPerf.averageInFlight).toFixed(2),
              ],
              [
                "Throughput",
                snapshotPerf.throughputPerMinute === null ||
                snapshotPerf.throughputPerMinute === undefined
                  ? "—"
                  : Number(snapshotPerf.throughputPerMinute).toFixed(2) +
                    " req/min",
              ],
              [
                "Effective output speed",
                snapshotPerf.effectiveOutputTokensPerSecond === null ||
                snapshotPerf.effectiveOutputTokensPerSecond === undefined
                  ? "—"
                  : Number(snapshotPerf.effectiveOutputTokensPerSecond).toFixed(
                      2
                    ) + " tokens/s",
              ],
            ]
          : null;
        const reliabilityFromSnapshot = snapshotPerf
          ? [
              [
                "Successful responses",
                formatRateCount(
                  snapshotPerf.successRate,
                  snapshotPerf.successfulCount,
                  snapshotPerf.completedCount
                ),
              ],
              [
                "Error responses",
                formatRateCount(
                  snapshotPerf.errorRate,
                  snapshotPerf.errorCount,
                  snapshotPerf.completedCount
                ),
              ],
              [
                "Post-processing failures",
                formatRateCount(
                  snapshotPerf.postProcessingFailureRate,
                  snapshotPerf.postProcessingFailureCount,
                  snapshotPerf.completedCount
                ),
              ],
              [
                "Retry attempts",
                formatRateCount(
                  snapshotPerf.retryAttemptRate,
                  snapshotPerf.retryAttemptCount,
                  snapshotPerf.requestCount
                ),
              ],
              [
                "Pending requests",
                String(snapshotPerf.pendingCount ?? pending),
              ],
            ]
          : null;
        const document = tab.document;
        const requestDetailScrollPositions = new Map(
          [...document.querySelectorAll("pre[data-request-detail-key]")].map(
            (element) => [
              element.dataset.requestDetailKey,
              { top: element.scrollTop, left: element.scrollLeft },
            ]
          )
        );
        const pageScrollPosition = { x: tab.scrollX, y: tab.scrollY };
        document.body.replaceChildren();
        const style = document.createElement("style");
        style.textContent =
          "body{margin:0;padding:24px;background:#0b1020;color:#e8ecf4;font:14px Inter,system-ui,sans-serif}" +
          "h1{margin:0 0 8px}.summary{color:#9aa7bd;margin-bottom:18px}.toolbar{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px}" +
          ".request-pagination{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:16px}.request-pagination .muted{white-space:nowrap}" +
          ".performance-groups{display:grid;grid-template-columns:minmax(0,2fr) minmax(330px,1fr);gap:14px;margin:18px 0 14px}.performance-group{padding:15px;border:1px solid #27324a;border-radius:12px;background:#101729}.performance-group h2{font-size:15px;margin:0 0 4px}.group-description{color:#9aa7bd;font-size:12px;margin-bottom:12px}.latency-group{border-top:3px solid #6ea8fe}.reliability-group{border-top:3px solid #ff7b8a}.performance-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:9px}.metric-card{padding:12px;border:1px solid #27324a;border-radius:9px;background:#131a2b}.metric-value{font-size:20px;font-weight:700;margin-bottom:4px}.latency-group .metric-value{color:#a9ceff}.reliability-group .metric-value{color:#ffbdc5}.metric-label{color:#9aa7bd;font-size:12px}.performance-breakdowns{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:10px;margin-bottom:14px}.breakdown{padding:12px;border:1px solid #4b2d3a;border-radius:9px;background:#181522}.breakdown h2{font-size:14px;margin:0 0 8px}.breakdown ul{margin:0;padding-left:18px}.breakdown li{margin:5px 0}@media(max-width:950px){.performance-groups{grid-template-columns:1fr}}" +
          ".gpqa-diagnostics{margin:18px 0;padding:16px;border:1px solid #3d4f75;border-radius:12px;background:#101729}.gpqa-diagnostics>summary{cursor:pointer;color:#a9ceff;font-size:17px;font-weight:700}.gpqa-note{color:#9aa7bd;font-size:12px;margin:7px 0 12px}.gpqa-analysis-section{margin-top:16px}.gpqa-analysis-section h3{margin:0 0 6px;font-size:14px}.gpqa-consistency-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:9px}.gpqa-table-wrap{overflow:auto;border:1px solid #27324a;border-radius:8px}.gpqa-table{min-width:700px}.gpqa-table th,.gpqa-table td{padding:8px}" +
          "button,select,input{padding:8px 12px;border:1px solid #3b4967;border-radius:7px;background:#131a2b;color:#e8ecf4}button{cursor:pointer}" +
          ".filter{display:flex;align-items:center;gap:7px;color:#9aa7bd}.filter input{width:90px}.filter input[type=checkbox]{width:auto}" +
          ".auto-refresh-indicator{display:inline-flex;align-items:center;gap:6px;color:#9be4c7;font-size:12px;white-space:nowrap}.auto-refresh-dot{width:7px;height:7px;border-radius:50%;background:#4bd39b;box-shadow:0 0 0 3px rgb(75 211 155 / 14%)}" +
          ".wrap{overflow:auto;border:1px solid #27324a;border-radius:10px}table{width:100%;border-collapse:collapse;min-width:1000px}" +
          "th,td{padding:10px;border-bottom:1px solid #27324a;text-align:left;vertical-align:top}th{color:#9aa7bd;font-size:12px}" +
          "pre{margin:0;max-width:620px;max-height:300px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}.request-meta{margin-bottom:8px;max-height:150px}" +
          ".request-details{min-width:440px}.request-details>summary{cursor:pointer;color:#9be4c7;font-weight:600}.request-detail-grid{display:grid;gap:10px;margin-top:10px}.request-detail{padding:10px;border:1px solid #27324a;border-radius:8px;background:#0b1020}.request-detail-label{display:block;margin-bottom:6px;color:#9aa7bd;font-size:11px;text-transform:uppercase;letter-spacing:.04em}.thinking pre{color:#f5d38d}.live-note{color:#9be4c7;font-size:12px;margin-top:6px}" +
          ".pending{color:#f5d38d}.success{color:#9be4c7}.failure{color:#ffb4bc}.muted{color:#9aa7bd}";
        document.head.appendChild(style);
        const heading = document.createElement("h1");
        heading.textContent = "Inference requests";
        document.body.appendChild(heading);
        const latencyMetrics = latencyFromSnapshot || [
          ["P50 latency", formatLatencyMs(percentile(completedDurationsMs, 0.5))],
          ["P75 latency", formatLatencyMs(percentile(completedDurationsMs, 0.75))],
          ["P90 latency", formatLatencyMs(percentile(completedDurationsMs, 0.9))],
          ["P95 latency", formatLatencyMs(percentile(completedDurationsMs, 0.95))],
          ["Mean latency", formatLatencyMs(meanDurationMs)],
          ["Maximum latency", formatLatencyMs(maxDurationMs)],
          [
            "Peak in-flight",
            concurrencyPoints.length > 0 ? String(peakConcurrency) : "—",
          ],
          [
            "Average in-flight",
            averageConcurrency === null
              ? "—"
              : averageConcurrency.toFixed(2),
          ],
          [
            "Throughput",
            throughputPerMinute === null
              ? "—"
              : throughputPerMinute.toFixed(2) + " req/min",
          ],
          [
            "Effective output speed",
            outputTokensPerSecond === null
              ? "—"
              : outputTokensPerSecond.toFixed(2) + " tokens/s",
          ],
        ];
        const reliabilityMetrics = reliabilityFromSnapshot || [
          [
            "Successful responses",
            percentage(successful, completedEntries.length) +
              " · " +
              successful +
              "/" +
              completedEntries.length,
          ],
          [
            "Error responses",
            percentage(errorEntries.length, completedEntries.length) +
              " · " +
              errorEntries.length +
              "/" +
              completedEntries.length,
          ],
          [
            "Post-processing failures",
            percentage(
              postProcessingFailures.length,
              completedEntries.length
            ) +
              " · " +
              postProcessingFailures.length +
              "/" +
              completedEntries.length,
          ],
          [
            "Retry attempts",
            percentage(retryAttempts, entries.length) +
              " · " +
              retryAttempts +
              "/" +
              entries.length,
          ],
          ["Pending requests", String(pending)],
        ];
        const appendMetricCards = (group, metrics) => {
          const grid = document.createElement("div");
          grid.className = "performance-grid";
          for (const [label, value] of metrics) {
            const card = document.createElement("div");
            card.className = "metric-card";
            const metricValue = document.createElement("div");
            metricValue.className = "metric-value";
            metricValue.textContent = value;
            const metricLabel = document.createElement("div");
            metricLabel.className = "metric-label";
            metricLabel.textContent = label;
            card.appendChild(metricValue);
            card.appendChild(metricLabel);
            grid.appendChild(card);
          }
          group.appendChild(grid);
        };
        const performanceGroups = document.createElement("section");
        performanceGroups.className = "performance-groups";
        const latencyGroup = document.createElement("section");
        latencyGroup.className = "performance-group latency-group";
        const latencyHeading = document.createElement("h2");
        latencyHeading.textContent = "Latency and throughput";
        latencyGroup.appendChild(latencyHeading);
        const latencyDescription = document.createElement("div");
        latencyDescription.className = "group-description";
        latencyDescription.textContent =
          "Completed request timing, concurrency, and token delivery.";
        latencyGroup.appendChild(latencyDescription);
        appendMetricCards(latencyGroup, latencyMetrics);
        performanceGroups.appendChild(latencyGroup);
        const reliabilityGroup = document.createElement("section");
        reliabilityGroup.className = "performance-group reliability-group";
        const reliabilityHeading = document.createElement("h2");
        reliabilityHeading.textContent = "Reliability and errors";
        reliabilityGroup.appendChild(reliabilityHeading);
        const reliabilityDescription = document.createElement("div");
        reliabilityDescription.className = "group-description";
        reliabilityDescription.textContent =
          "Success, failure, retry, and incomplete-request rates.";
        reliabilityGroup.appendChild(reliabilityDescription);
        appendMetricCards(reliabilityGroup, reliabilityMetrics);
        performanceGroups.appendChild(reliabilityGroup);
        document.body.appendChild(performanceGroups);
        appendGpqaRequestAnalytics(document, gpqaAnalytics);
        const breakdowns = document.createElement("section");
        breakdowns.className = "performance-breakdowns";
        const errorBreakdown = document.createElement("div");
        errorBreakdown.className = "breakdown";
        const errorBreakdownHeading = document.createElement("h2");
        errorBreakdownHeading.textContent = "Error status/code breakdown";
        errorBreakdown.appendChild(errorBreakdownHeading);
        if (errorStatusCounts.size === 0) {
          const noErrors = document.createElement("span");
          noErrors.className = "muted";
          noErrors.textContent = "No completed errors.";
          errorBreakdown.appendChild(noErrors);
        } else {
          const errorList = document.createElement("ul");
          const completedForRates = snapshotPerf
            ? Number(snapshotPerf.completedCount || 0)
            : completedEntries.length;
          const errorsForRates = snapshotPerf
            ? Number(snapshotPerf.errorCount || 0)
            : errorEntries.length;
          const statuses = [...errorStatusCounts.entries()].sort((a, b) => {
            if (a[0] === "No status") {
              return 1;
            }
            if (b[0] === "No status") {
              return -1;
            }
            return Number(a[0]) - Number(b[0]);
          });
          for (const [status, count] of statuses) {
            const item = document.createElement("li");
            item.textContent =
              status +
              ": " +
              count +
              " · " +
              percentage(count, completedForRates) +
              " of completed · " +
              percentage(count, errorsForRates) +
              " of errors";
            errorList.appendChild(item);
          }
          errorBreakdown.appendChild(errorList);
        }
        breakdowns.appendChild(errorBreakdown);
        document.body.appendChild(breakdowns);
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
          document.createTextNode(
            pending > 0
              ? "Auto-refresh on · 2 sec while requests are pending"
              : "Auto-refresh on · 1 min"
          )
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
        const requestStatus = (entry) => {
          if (!entry.completed) {
            return "pending";
          }
          return entry.completed.ok ? "success" : "error";
        };
        const requestAttempt = (entry) => {
          const value = Number(
            entry.started?.attempt ?? entry.completed?.attempt
          );
          return Number.isFinite(value) ? value : 0;
        };
        const requestDurationSeconds = (entry) => {
          const completedDurationMs = Number(entry.completed?.duration_ms);
          if (entry.completed && Number.isFinite(completedDurationMs)) {
            return Math.max(0, completedDurationMs) / 1000;
          }
          const startedAtMs = new Date(
            entry.started?.started_at || entry.completed?.started_at || ""
          ).getTime();
          return Number.isFinite(startedAtMs)
            ? Math.max(0, Date.now() - startedAtMs) / 1000
            : 0;
        };
        const requestPageSize = 100;
        const wrap = document.createElement("div");
        wrap.className = "wrap";
        const table = document.createElement("table");
        const head = document.createElement("thead");
        const headRow = document.createElement("tr");
        for (const label of [
          "No.",
          "Start time",
          "Request / response",
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
        table.appendChild(tableBody);
        wrap.appendChild(table);
        document.body.appendChild(wrap);
        const pagination = document.createElement("div");
        pagination.className = "request-pagination";
        const previousPage = document.createElement("button");
        previousPage.textContent = "Previous";
        pagination.appendChild(previousPage);
        const pageSummary = document.createElement("span");
        pageSummary.className = "muted";
        pagination.appendChild(pageSummary);
        const nextPage = document.createElement("button");
        nextPage.textContent = "Next";
        pagination.appendChild(nextPage);
        document.body.appendChild(pagination);
        const buildRequestRow = (entry, serialNumber) => {
          const started = entry.started || entry.completed || {};
          const completed = entry.completed;
          const row = document.createElement("tr");
          let statusValue = "pending";
          if (completed?.ok) {
            statusValue = "success";
          } else if (completed) {
            statusValue = "error";
          }
          row.dataset.requestStatus = statusValue;
          const attempt = Number(started.attempt ?? completed?.attempt);
          row.dataset.attemptCount = Number.isFinite(attempt)
            ? String(attempt)
            : "0";
          const durationSeconds = requestDurationSeconds(entry);
          row.dataset.durationSeconds = String(durationSeconds);
          const serialCell = document.createElement("td");
          serialCell.textContent = String(serialNumber);
          row.appendChild(serialCell);
          const startCell = document.createElement("td");
          startCell.textContent = formatDate(started.started_at);
          row.appendChild(startCell);
          const requestCell = document.createElement("td");
          const requestMetadata = document.createElement("pre");
          requestMetadata.className = "request-meta";
          requestMetadata.textContent = JSON.stringify(
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
          requestCell.appendChild(requestMetadata);
          const requestDetails = document.createElement("details");
          requestDetails.className = "request-details";
          const expandedRequestIds =
            tab.__expandedRequestIds || new Set();
          tab.__expandedRequestIds = expandedRequestIds;
          requestDetails.open = expandedRequestIds.has(entry.requestId);
          const requestDetailsSummary = document.createElement("summary");
          const updateDetailsSummary = () => {
            requestDetailsSummary.textContent = requestDetails.open
              ? "Hide request/response"
              : "Show request/response";
          };
          updateDetailsSummary();
          requestDetails.appendChild(requestDetailsSummary);
          requestDetails.addEventListener("toggle", () => {
            if (requestDetails.open) {
              expandedRequestIds.add(entry.requestId);
            } else {
              expandedRequestIds.delete(entry.requestId);
            }
            updateDetailsSummary();
            populateRequestDetails();
          });
          const populateRequestDetails = () => {
            if (
              !requestDetails.open ||
              requestDetails.querySelector(".request-detail-grid")
            ) {
              return;
            }
            const detailGrid = document.createElement("div");
            detailGrid.className = "request-detail-grid";
            const addRequestDetail = (label, value, className) => {
              const detail = document.createElement("section");
              detail.className =
                "request-detail" + (className ? " " + className : "");
              const detailLabel = document.createElement("span");
              detailLabel.className = "request-detail-label";
              detailLabel.textContent = label;
              const detailContent = document.createElement("pre");
              detailContent.dataset.requestDetailKey =
                entry.requestId + ":" + label;
              detailContent.textContent =
                typeof value === "string"
                  ? value
                  : JSON.stringify(value, null, 2);
              detail.appendChild(detailLabel);
              detail.appendChild(detailContent);
              detailGrid.appendChild(detail);
            };
            addRequestDetail(
              "Request payload",
              started.request_body ||
                started.request ||
                "Request payload was not captured.",
              ""
            );
            addRequestDetail(
              "Thinking / reasoning exposed by model",
              entry.reasoning ||
                completed?.reasoning ||
                (entry.reasoningDetails ?? completed?.reasoning_details
                  ? JSON.stringify(
                      entry.reasoningDetails ??
                        completed?.reasoning_details,
                      null,
                      2
                    )
                  : "No exposed reasoning received."),
              "thinking"
            );
            const structuredReasoning =
              entry.reasoningDetails ?? completed?.reasoning_details;
            if (
              (entry.reasoning || completed?.reasoning) &&
              structuredReasoning !== undefined
            ) {
              addRequestDetail(
                "Structured reasoning details",
                structuredReasoning,
                "thinking"
              );
            }
            const capturedToolCalls = entry.toolCallDeltas?.length
              ? entry.toolCallDeltas
              : completed?.tool_calls;
            const responseValue =
              entry.content ||
              completed?.response_content ||
              (capturedToolCalls?.length
                ? { tool_calls: capturedToolCalls }
                : completed?.response) ||
              (completed
                ? "No response content was captured."
                : "Waiting for response content…");
            addRequestDetail("Response", responseValue, "");
            if (
              capturedToolCalls?.length &&
              (entry.content || completed?.response_content)
            ) {
              addRequestDetail(
                entry.toolCallDeltas?.length
                  ? "Tool-call deltas"
                  : "Tool calls",
                capturedToolCalls,
                ""
              );
            }
            const latestProgress = entry.latestProgress;
            addRequestDetail(
              "Streaming status",
              latestProgress
                ? {
                    observed_at: latestProgress.observed_at,
                    received_bytes: latestProgress.received_bytes,
                    elapsed_seconds:
                      Number(latestProgress.elapsed_ms || 0) / 1000,
                    time_to_first_output_seconds:
                      latestProgress.time_to_first_output_ms === undefined
                        ? null
                        : Number(
                            latestProgress.time_to_first_output_ms
                          ) / 1000,
                  }
                : completed
                  ? "Live streaming details were not captured."
                  : "Waiting for the first streamed chunk…",
              ""
            );
            if (!completed) {
              const liveNote = document.createElement("div");
              liveNote.className = "live-note";
              liveNote.textContent =
                "This content updates automatically while the request is pending.";
              detailGrid.appendChild(liveNote);
            }
            requestDetails.appendChild(detailGrid);
          };
          populateRequestDetails();
          requestCell.appendChild(requestDetails);
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
            durationSeconds.toFixed(2) +
            " s" +
            (completed ? "" : " elapsed");
          row.appendChild(durationCell);
          const errorCell = document.createElement("td");
          errorCell.textContent =
            [
              completed?.error,
              completed?.failure_stage
                ? "Stage: " + completed.failure_stage
                : "",
            ]
              .filter(Boolean)
              .join("\\n") || "—";
          if (completed?.error) {
            errorCell.className = "failure";
          }
          row.appendChild(errorCell);
          return row;
        };
        const applyRequestFilters = () => {
          const filtered = entries.filter((entry) => {
            const entryStatus = requestStatus(entry);
            const durationThreshold = filterState.duration.trim();
            const attemptThreshold = filterState.attempt.trim();
            return (
              (filterState.status === "all" ||
                entryStatus === filterState.status) &&
              (!filterState.errorsOnly || entryStatus === "error") &&
              (durationThreshold === "" ||
                requestDurationSeconds(entry) >
                  Number(durationThreshold)) &&
              (attemptThreshold === "" ||
                requestAttempt(entry) > Number(attemptThreshold))
            );
          });
          const totalPages = Math.max(
            1,
            Math.ceil(filtered.length / requestPageSize)
          );
          const page = Math.min(
            Math.max(1, Number(filterState.page) || 1),
            totalPages
          );
          filterState.page = page;
          const pageOffset = (page - 1) * requestPageSize;
          const visibleEntries = filtered.slice(
            pageOffset,
            pageOffset + requestPageSize
          );
          tableBody.replaceChildren();
          let serialNumber = pageOffset;
          for (const entry of visibleEntries) {
            serialNumber += 1;
            tableBody.appendChild(buildRequestRow(entry, serialNumber));
          }
          const firstVisible =
            filtered.length === 0 ? 0 : pageOffset + 1;
          const lastVisible = Math.min(
            pageOffset + visibleEntries.length,
            filtered.length
          );
          summary.textContent =
            "Showing " +
            firstVisible +
            "–" +
            lastVisible +
            " of " +
            filtered.length +
            " filtered attempts · " +
            entries.length +
            " total · " +
            successful +
            " success · " +
            pending +
            " pending · " +
            errors +
            " error" +
            (errors === 1 ? "" : "s") +
            (invalidLines.length > 0
              ? " · " + invalidLines.length + " invalid JSONL lines"
              : "");
          pageSummary.textContent =
            "Page " +
            page +
            " of " +
            totalPages +
            " · up to 100 requests per page";
          previousPage.disabled = page <= 1;
          nextPage.disabled = page >= totalPages;
        };
        previousPage.addEventListener("click", () => {
          filterState.page = Math.max(1, Number(filterState.page || 1) - 1);
          applyRequestFilters();
        });
        nextPage.addEventListener("click", () => {
          filterState.page = Number(filterState.page || 1) + 1;
          applyRequestFilters();
        });
        const reloadForFilters = () => {
          window.clearTimeout(tab.__requestFilterTimer);
          filterState.page = 1;
          applyRequestFilters();
        };
        const scheduleFilterReload = () => {
          window.clearTimeout(tab.__requestFilterTimer);
          tab.__requestFilterTimer = window.setTimeout(
            reloadForFilters,
            300
          );
        };
        statusFilter.addEventListener("change", () => {
          if (statusFilter.value !== "all") {
            errorsOnlyFilter.checked = false;
          }
          filterState.status = statusFilter.value;
          filterState.errorsOnly = errorsOnlyFilter.checked;
          reloadForFilters();
        });
        errorsOnlyFilter.addEventListener("change", () => {
          if (errorsOnlyFilter.checked) {
            statusFilter.value = "all";
          }
          filterState.status = statusFilter.value;
          filterState.errorsOnly = errorsOnlyFilter.checked;
          reloadForFilters();
        });
        durationFilter.addEventListener("input", () => {
          filterState.duration = durationFilter.value;
          scheduleFilterReload();
        });
        attemptFilter.addEventListener("input", () => {
          filterState.attempt = attemptFilter.value;
          scheduleFilterReload();
        });
        applyRequestFilters();
        for (const element of document.querySelectorAll(
          "pre[data-request-detail-key]"
        )) {
          const position = requestDetailScrollPositions.get(
            element.dataset.requestDetailKey
          );
          if (position) {
            element.scrollTop = position.top;
            element.scrollLeft = position.left;
          }
        }
        tab.scrollTo(pageScrollPosition.x, pageScrollPosition.y);
      } catch (error) {
        tab.document.body.textContent = String(error);
      } finally {
        tab.__requestRefreshInFlight = false;
        if (!tab.closed) {
          const refreshDelay =
            Number(tab.__requestPendingCount || 0) > 0 ? 2000 : 60000;
          tab.__requestAutoRefreshTimer = window.setTimeout(
            () => openRequestViewer(id, tab),
            refreshDelay
          );
        }
      }
    }

    function openReportRetryPanel(
      document,
      runId,
      item,
      resultFields,
      requiresSimulatorApiKey = false
    ) {
      document.getElementById("diagnostic-retry-panel")?.remove();
      if (!document.getElementById("diagnostic-retry-style")) {
        const style = document.createElement("style");
        style.id = "diagnostic-retry-style";
        style.textContent =
          ".retry-panel{position:fixed;z-index:20;top:0;right:0;width:min(560px,92vw);height:100vh;box-sizing:border-box;padding:22px;background:#101729;border-left:1px solid #3b4967;box-shadow:-12px 0 35px rgb(0 0 0 / 35%);overflow:auto}" +
          ".retry-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.retry-panel-head h2{margin:0}.retry-close{font-size:20px;padding:4px 10px}" +
          ".retry-note{margin:12px 0;color:#9aa7bd}.retry-form{display:grid;gap:12px;margin:18px 0}.retry-form label{display:grid;gap:6px;color:#9aa7bd}.retry-form input{width:100%;box-sizing:border-box}" +
          ".retry-result{display:grid;gap:10px}.retry-state{padding:10px;border:1px solid #27324a;border-radius:8px;background:#0b1020}.retry-result-field{padding:12px;border:1px solid #27324a;border-radius:9px;background:#0b1020}.retry-result-field span{display:block;margin-bottom:6px;color:#9aa7bd;font-size:11px;text-transform:uppercase}.retry-result-field pre{max-height:360px}.retry-error{color:#ffb4bc;white-space:pre-wrap}";
        document.head.appendChild(style);
      }
      const panel = document.createElement("aside");
      panel.id = "diagnostic-retry-panel";
      panel.className = "retry-panel";
      const panelHead = document.createElement("div");
      panelHead.className = "retry-panel-head";
      const heading = document.createElement("h2");
      heading.textContent = "Diagnostic retry";
      const close = document.createElement("button");
      close.type = "button";
      close.className = "retry-close";
      close.textContent = "×";
      close.setAttribute("aria-label", "Close diagnostic retry panel");
      close.addEventListener("click", () => panel.remove());
      panelHead.appendChild(heading);
      panelHead.appendChild(close);
      panel.appendChild(panelHead);
      const note = document.createElement("div");
      note.className = "retry-note";
      note.textContent =
        item.sampleId + " · Original epoch " +
        (Number(item.epoch) + 1) +
        ". This rerun is diagnostic only and will not change the original score or artifacts.";
      panel.appendChild(note);
      const form = document.createElement("form");
      form.className = "retry-form";
      const apiKeyLabel = document.createElement("label");
      apiKeyLabel.appendChild(document.createTextNode("Inference API key"));
      const apiKey = document.createElement("input");
      apiKey.type = "password";
      apiKey.autocomplete = "off";
      apiKey.required = true;
      apiKeyLabel.appendChild(apiKey);
      form.appendChild(apiKeyLabel);
      const simulatorApiKey = document.createElement("input");
      if (requiresSimulatorApiKey) {
        const simulatorApiKeyLabel = document.createElement("label");
        simulatorApiKeyLabel.appendChild(
          document.createTextNode("DigitalOcean simulator access token")
        );
        simulatorApiKey.type = "password";
        simulatorApiKey.autocomplete = "off";
        simulatorApiKey.required = true;
        simulatorApiKeyLabel.appendChild(simulatorApiKey);
        form.appendChild(simulatorApiKeyLabel);
      }
      const triggerLabel = document.createElement("label");
      triggerLabel.appendChild(
        document.createTextNode("Run-trigger password")
      );
      const triggerSecret = document.createElement("input");
      triggerSecret.type = "password";
      triggerSecret.autocomplete = "off";
      triggerSecret.required = true;
      triggerLabel.appendChild(triggerSecret);
      form.appendChild(triggerLabel);
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.textContent = "Start retry";
      form.appendChild(submit);
      panel.appendChild(form);
      const result = document.createElement("div");
      result.className = "retry-result";
      panel.appendChild(result);
      document.body.appendChild(panel);
      apiKey.focus();

      const renderResult = (job) => {
        result.replaceChildren();
        const state = document.createElement("div");
        state.className = "retry-state";
        state.textContent =
          "Retry completed at " + formatDate(job.finishedAt);
        result.appendChild(state);
        for (const [label, value] of resultFields(job.result)) {
          const field = document.createElement("section");
          field.className = "retry-result-field";
          const fieldLabel = document.createElement("span");
          fieldLabel.textContent = label;
          const content = document.createElement("pre");
          content.textContent =
            value === null || value === undefined || value === ""
              ? "Not available"
              : typeof value === "string"
                ? value
                : JSON.stringify(value, null, 2);
          field.appendChild(fieldLabel);
          field.appendChild(content);
          result.appendChild(field);
        }
      };
      const poll = async (retryId) => {
        if (!panel.isConnected) {
          return;
        }
        try {
          const response = await api(
            "/runs/" + encodeURIComponent(runId) +
              "/diagnostic-retries/" + encodeURIComponent(retryId)
          );
          const job = await response.json();
          if (job.status === "running") {
            result.textContent =
              "Retry running since " + formatDate(job.startedAt) + "…";
            window.setTimeout(() => poll(retryId), 2000);
          } else if (job.status === "succeeded") {
            renderResult(job);
            submit.disabled = false;
          } else {
            result.className = "retry-result retry-error";
            result.textContent = job.error || "Diagnostic retry failed.";
            submit.disabled = false;
          }
        } catch (error) {
          result.className = "retry-result retry-error";
          result.textContent = String(error);
          submit.disabled = false;
        }
      };
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        submit.disabled = true;
        result.className = "retry-result";
        result.textContent = "Starting diagnostic retry…";
        try {
          const response = await api(
            "/runs/" + encodeURIComponent(runId) + "/diagnostic-retries",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Bench-Run-Secret": triggerSecret.value,
              },
              body: JSON.stringify({
                sampleId: item.sampleId,
                originalEpoch: Number(item.epoch),
                apiKey: apiKey.value,
                ...(requiresSimulatorApiKey
                  ? { simulatorApiKey: simulatorApiKey.value }
                  : {}),
              }),
            }
          );
          const job = await response.json();
          apiKey.value = "";
          simulatorApiKey.value = "";
          triggerSecret.value = "";
          await poll(job.id);
        } catch (error) {
          result.className = "retry-result retry-error";
          result.textContent = String(error);
          submit.disabled = false;
        }
      });
    }

    async function openGpqaReport(id, existingTab) {
      const tab = existingTab || window.open("", "_blank");
      if (!tab) {
        dashboardError.textContent = "Allow popups to open the GPQA report.";
        return;
      }
      if (tab.__campaignTimer) {
        window.clearTimeout(tab.__campaignTimer);
        tab.__campaignTimer = undefined;
      }
      tab.document.title = "GPQA question report";
      if (!existingTab) {
        tab.document.body.textContent = "Loading GPQA report…";
      }
      try {
        const response = await api(
          "/runs/" + encodeURIComponent(id) + "/gpqa-report"
        );
        const report = await response.json();
        const items = Array.isArray(report.items) ? report.items : [];
        const document = tab.document;
        document.body.replaceChildren();
        const style = document.createElement("style");
        style.textContent =
          "body{margin:0;background:#0b1020;color:#e8ecf4;font:14px Inter,system-ui,sans-serif}" +
          "main{max-width:1400px;margin:auto;padding:30px 24px}h1{margin:0 0 6px}.muted{color:#9aa7bd}" +
          ".counts{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0}.count{padding:9px 12px;border:1px solid #27324a;border-radius:8px;background:#131a2b}" +
          ".toolbar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:10px;padding:14px;margin:0 0 18px;background:#0b1020;border-bottom:1px solid #27324a}" +
          "button,select,input{padding:8px 11px;border:1px solid #3b4967;border-radius:7px;background:#131a2b;color:#e8ecf4}button{cursor:pointer}" +
          ".filter{display:flex;align-items:center;gap:7px;color:#9aa7bd}.filter input{min-width:220px}" +
          ".status-filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0;padding:5px 9px;border:1px solid #3b4967;border-radius:7px}.status-filters legend{padding:0 4px;color:#9aa7bd}.status-filter{display:flex;align-items:center;gap:5px;color:#e8ecf4}.status-filter input{min-width:auto;padding:0}" +
          ".list{display:grid;gap:14px}.item{border:1px solid #27324a;border-radius:12px;background:#131a2b;padding:18px}" +
          ".item-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:14px}.item-head strong{font-size:16px}.badge{padding:4px 9px;border-radius:999px;font-size:12px;font-weight:700}" +
          ".item-actions{display:flex;flex-wrap:wrap;gap:8px;margin:-3px 0 14px}.copy-action{display:inline-flex;align-items:center;gap:6px;padding:6px 9px;font-size:12px}.copy-action:disabled{cursor:not-allowed;opacity:.45}" +
          ".correct{background:#173f35;color:#9be4c7}.wrong{background:#54242b;color:#ffb4bc}.no_answer{background:#49314f;color:#e6b9f2}.skipped{background:#4a3d20;color:#f5d38d}" +
          ".grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}.field{min-width:0}.field.wide{grid-column:1/-1}" +
          ".label{display:block;margin-bottom:6px;color:#9aa7bd;font-size:12px;text-transform:uppercase;letter-spacing:.04em}" +
          "pre{margin:0;padding:11px;border-radius:8px;background:#0b1020;white-space:pre-wrap;overflow-wrap:anywhere;max-height:340px;overflow:auto}" +
          ".answer{color:#9be4c7}.empty{color:#9aa7bd;font-style:italic}@media(max-width:850px){.grid{grid-template-columns:1fr}.field.wide{grid-column:auto}}";
        document.head.appendChild(style);
        const main = document.createElement("main");
        const heading = document.createElement("h1");
        heading.textContent = "GPQA question report";
        main.appendChild(heading);
        const subtitle = document.createElement("div");
        subtitle.className = "muted";
        subtitle.textContent =
          report.model + " · " + items.length + " evaluations · Run " + id;
        main.appendChild(subtitle);
        const counts = document.createElement("div");
        counts.className = "counts";
        for (const entry of [
          ["Correct", Number(report.correct || 0)],
          ["Wrong", Number(report.wrong || 0)],
          ["No answer", Number(report.noAnswer || 0)],
          ["Skipped", Number(report.skipped || 0)],
          [
            "Total model generation time",
            formatLatencyMs(report.totalGenerationTimeMs),
          ],
        ]) {
          const count = document.createElement("span");
          count.className = "count";
          count.textContent = entry[0] + ": " + entry[1];
          counts.appendChild(count);
        }
        main.appendChild(counts);
        const filterSummary = document.createElement("div");
        filterSummary.className = "muted";
        const toolbar = document.createElement("div");
        toolbar.className = "toolbar";
        const download = document.createElement("button");
        download.textContent = "Download filtered JSON";
        toolbar.appendChild(download);
        const retryFailed = document.createElement("button");
        retryFailed.textContent = "Retry failed questions";
        retryFailed.addEventListener("click", () =>
          openGpqaRetryCampaigns(id, tab)
        );
        toolbar.appendChild(retryFailed);
        const makeSelect = (labelText, options) => {
          const label = document.createElement("label");
          label.className = "filter";
          label.appendChild(document.createTextNode(labelText));
          const select = document.createElement("select");
          for (const option of options) {
            const element = document.createElement("option");
            element.value = option.value;
            element.textContent = option.label;
            select.appendChild(element);
          }
          label.appendChild(select);
          toolbar.appendChild(label);
          return select;
        };
        const statusFilters = document.createElement("fieldset");
        statusFilters.className = "status-filters";
        const statusLegend = document.createElement("legend");
        statusLegend.textContent = "Results";
        statusFilters.appendChild(statusLegend);
        const statusFilterInputs = [];
        for (const option of [
          { value: "correct", label: "Correct (" + report.correct + ")" },
          { value: "wrong", label: "Wrong (" + report.wrong + ")" },
          {
            value: "no_answer",
            label: "No answer (" + report.noAnswer + ")",
          },
          { value: "skipped", label: "Skipped (" + report.skipped + ")" },
        ]) {
          const label = document.createElement("label");
          label.className = "status-filter";
          const input = document.createElement("input");
          input.type = "checkbox";
          input.value = option.value;
          input.checked = true;
          statusFilterInputs.push(input);
          label.appendChild(input);
          label.appendChild(document.createTextNode(option.label));
          statusFilters.appendChild(label);
        }
        toolbar.appendChild(statusFilters);
        const epochs = [...new Set(items.map((item) => Number(item.epoch)))]
          .filter(Number.isFinite)
          .sort((a, b) => a - b);
        const epochFilter = makeSelect(
          "Epoch",
          [{ value: "all", label: "All epochs" }].concat(
            epochs.map((epoch) => ({
              value: String(epoch),
              label: "Epoch " + (epoch + 1),
            }))
          )
        );
        const subdomains = [
          ...new Set(items.map((item) => String(item.subdomain || "Unknown"))),
        ].sort((a, b) => a.localeCompare(b));
        const subdomainFilter = makeSelect(
          "Subdomain",
          [{ value: "all", label: "All subdomains" }].concat(
            subdomains.map((subdomain) => ({
              value: subdomain,
              label: subdomain,
            }))
          )
        );
        const reasoningFilter = makeSelect("Reasoning", [
          { value: "all", label: "All" },
          { value: "with", label: "With reasoning" },
          { value: "without", label: "Without reasoning" },
        ]);
        const latencyFilterLabel = document.createElement("label");
        latencyFilterLabel.className = "filter";
        latencyFilterLabel.appendChild(
          document.createTextNode("Latency >")
        );
        const latencyFilter = document.createElement("input");
        latencyFilter.type = "number";
        latencyFilter.min = "0";
        latencyFilter.step = "0.1";
        latencyFilter.placeholder = "X seconds";
        latencyFilterLabel.appendChild(latencyFilter);
        toolbar.appendChild(latencyFilterLabel);
        const searchLabel = document.createElement("label");
        searchLabel.className = "filter";
        searchLabel.appendChild(document.createTextNode("Search"));
        const searchFilter = document.createElement("input");
        searchFilter.type = "search";
        searchFilter.placeholder = "Question, answer, reasoning…";
        searchLabel.appendChild(searchFilter);
        toolbar.appendChild(searchLabel);
        toolbar.appendChild(filterSummary);
        main.appendChild(toolbar);
        const list = document.createElement("div");
        list.className = "list";
        const addField = (container, labelText, value, wide, valueClass) => {
          const field = document.createElement("div");
          field.className = "field" + (wide ? " wide" : "");
          const label = document.createElement("span");
          label.className = "label";
          label.textContent = labelText;
          const content = document.createElement("pre");
          content.textContent =
            value === null || value === undefined || value === ""
              ? "Not available"
              : String(value);
          if (value === null || value === undefined || value === "") {
            content.className = "empty";
          } else if (valueClass) {
            content.className = valueClass;
          }
          field.appendChild(label);
          field.appendChild(content);
          container.appendChild(field);
        };
        const questionText = (item) => {
          const choices = Object.entries(item.choices || {})
            .map(([letter, choice]) => letter + ") " + choice)
            .join("\\n");
          return item.question + (choices ? "\\n\\n" + choices : "");
        };
        const shellQuote = (value) =>
          "'" +
          String(value).replaceAll(
            "'",
            String.fromCharCode(39, 34, 39, 34, 39)
          ) +
          "'";
        const curlForItem = (item) => {
          const inference = report.inference || {};
          const baseUrl = String(inference.baseUrl || "").replace(/\\/+$/u, "");
          if (!baseUrl) {
            return "";
          }
          const model = String(inference.model || report.model || "");
          const body = {
            model,
            messages: [
              {
                role: "user",
                content: item.prompt || questionText(item),
              },
            ],
            stream: true,
            stream_options: { include_usage: true },
            cache_control: { type: "ephemeral" },
            ...(inference.temperature !== undefined && {
              temperature: inference.temperature,
            }),
            ...(inference.maxTokens !== undefined && {
              max_tokens: inference.maxTokens,
            }),
            ...(inference.reasoningEffort !== undefined && {
              reasoning_effort: inference.reasoningEffort,
            }),
            ...(inference.sort !== undefined &&
              inference.endpointId === undefined && {
                provider: { sort: inference.sort },
              }),
          };
          const baseModel = model.split(":")[0];
          const pluginId =
            baseModel === "openrouter/auto"
              ? "auto-router"
              : baseModel === "openrouter/auto-beta"
                ? "auto-beta-router"
                : null;
          if (
            pluginId &&
            (inference.costTier !== undefined ||
              inference.costQualityTradeoff !== undefined ||
              inference.pinModel === true)
          ) {
            body.plugins = [
              {
                id: pluginId,
                ...(inference.costTier !== undefined && {
                  cost_tier: inference.costTier,
                }),
                ...(inference.costQualityTradeoff !== undefined && {
                  cost_quality_tradeoff: inference.costQualityTradeoff,
                }),
                ...(inference.pinModel === true && { pin_model: true }),
              },
            ];
          }
          const headers = [
            "Authorization: Bearer <INFERENCE_API_KEY>",
            "Content-Type: application/json",
          ];
          if (baseUrl === "https://openrouter.ai/api/v1") {
            headers.push("X-OpenRouter-Metadata: enabled");
          }
          if (inference.endpointId !== undefined) {
            headers.push("X-OR-Endpoint-Id: " + inference.endpointId);
          }
          if (inference.cloudflareVersion !== undefined) {
            headers.push(
              "Cloudflare-Workers-Version-Overrides: " +
                inference.cloudflareVersion
            );
          }
          return [
            "curl --request POST",
            "--url " + shellQuote(baseUrl + "/chat/completions"),
            ...headers.map((header) => "--header " + shellQuote(header)),
            "--data-raw " + shellQuote(JSON.stringify(body)),
          ].join(" ");
        };
        const makeCopyAction = (label, value, title) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "copy-action";
          button.textContent = "⧉ " + label;
          button.title = title;
          button.setAttribute("aria-label", title);
          button.disabled =
            value === null || value === undefined || String(value) === "";
          button.addEventListener("click", async () => {
            const original = button.textContent;
            const copied = await copyTextToClipboard(String(value), document);
            button.textContent = copied ? "✓ Copied" : "Copy failed";
            window.setTimeout(() => {
              button.textContent = original;
            }, 1500);
          });
          return button;
        };
        for (const [index, item] of items.entries()) {
          const card = document.createElement("article");
          card.className = "item";
          card.dataset.status = String(item.status);
          card.dataset.epoch = String(item.epoch);
          card.dataset.subdomain = String(item.subdomain || "Unknown");
          card.dataset.hasReasoning = item.reasoning ? "true" : "false";
          const latencyMs = Number(item.latencyMs);
          card.dataset.latencySeconds =
            item.latencyMs !== null &&
            item.latencyMs !== undefined &&
            Number.isFinite(latencyMs)
              ? String(Math.max(0, latencyMs) / 1000)
              : "";
          card.dataset.search = JSON.stringify(item).toLowerCase();
          const itemHead = document.createElement("div");
          itemHead.className = "item-head";
          const title = document.createElement("strong");
          title.textContent =
            (index + 1) + ". " + item.sampleId + " · Epoch " +
            (Number(item.epoch) + 1);
          const badge = document.createElement("span");
          badge.className = "badge " + item.status;
          const statusLabels = {
            correct: "Correct",
            wrong: "Wrong",
            no_answer: "No answer",
            skipped: "Skipped",
          };
          badge.textContent = statusLabels[item.status] || "Skipped";
          const domain = document.createElement("span");
          domain.className = "muted";
          domain.textContent = item.subdomain || "Unknown";
          const latency = document.createElement("span");
          latency.className = "muted";
          latency.textContent = "Latency: " + formatLatencyMs(item.latencyMs);
          itemHead.appendChild(title);
          itemHead.appendChild(badge);
          itemHead.appendChild(domain);
          itemHead.appendChild(latency);
          card.appendChild(itemHead);
          const itemActions = document.createElement("div");
          itemActions.className = "item-actions";
          itemActions.appendChild(
            makeCopyAction(
              "Question",
              questionText(item),
              "Copy question and choices"
            )
          );
          itemActions.appendChild(
            makeCopyAction(
              "Answer",
              item.modelAnswer,
              "Copy the generated model answer"
            )
          );
          itemActions.appendChild(
            makeCopyAction(
              "cURL",
              curlForItem(item),
              "Copy a reproducible inference cURL with an API-key placeholder"
            )
          );
          const retry = document.createElement("button");
          retry.type = "button";
          retry.className = "copy-action";
          retry.textContent = "↻ Retry";
          retry.title = "Rerun this question without changing the original score";
          retry.addEventListener("click", () =>
            openReportRetryPanel(document, id, item, (retried) => [
              ["Result", retried.status],
              ["Latency", formatLatencyMs(retried.latencyMs)],
              ["Model answer", retried.modelAnswer],
              ["Model reasoning", retried.reasoning],
              ["Extracted answer", retried.extractedAnswer],
              ["Scorer explanation", retried.scorerExplanation],
            ])
          );
          itemActions.appendChild(retry);
          card.appendChild(itemActions);
          const grid = document.createElement("div");
          grid.className = "grid";
          addField(
            grid,
            "Question and choices",
            questionText(item),
            true
          );
          addField(grid, "Model answer", item.modelAnswer, true);
          addField(
            grid,
            "Correct answer",
            item.correctAnswer +
              (item.correctAnswerText
                ? ") " + item.correctAnswerText
                : ""),
            false,
            "answer"
          );
          addField(
            grid,
            "Extracted model answer",
            item.extractedAnswer,
            false
          );
          addField(grid, "Model reasoning", item.reasoning, true);
          addField(
            grid,
            "Scorer explanation",
            item.scorerExplanation,
            true
          );
          card.appendChild(grid);
          list.appendChild(card);
        }
        main.appendChild(list);
        document.body.appendChild(main);
        const GPQA_REPORT_DOWNLOAD_LIMIT = 100;
        const currentFilters = () => ({
          statuses: new Set(
            statusFilterInputs
              .filter((input) => input.checked)
              .map((input) => input.value)
          ),
          epoch: epochFilter.value,
          subdomain: subdomainFilter.value,
          reasoning: reasoningFilter.value,
          latency: latencyFilter.value.trim(),
          search: searchFilter.value.trim().toLowerCase(),
        });
        const itemMatchesFilters = (item, filters) => {
          const latencyMs = Number(item.latencyMs);
          const statusMatches = filters.statuses.has(String(item.status));
          const epochMatches =
            filters.epoch === "all" ||
            String(item.epoch) === filters.epoch;
          const subdomainMatches =
            filters.subdomain === "all" ||
            String(item.subdomain || "Unknown") === filters.subdomain;
          const hasReasoning = Boolean(item.reasoning);
          const reasoningMatches =
            filters.reasoning === "all" ||
            (filters.reasoning === "with"
              ? hasReasoning
              : !hasReasoning);
          const latencyMatches =
            filters.latency === "" ||
            (item.latencyMs !== null &&
              item.latencyMs !== undefined &&
              Number.isFinite(latencyMs) &&
              latencyMs / 1000 > Number(filters.latency));
          const searchMatches =
            filters.search === "" ||
            JSON.stringify(item).toLowerCase().includes(filters.search);
          return (
            statusMatches &&
            epochMatches &&
            subdomainMatches &&
            reasoningMatches &&
            latencyMatches &&
            searchMatches
          );
        };
        const filteredItems = () => {
          const filters = currentFilters();
          return items.filter((item) => itemMatchesFilters(item, filters));
        };
        const applyFilters = () => {
          const matching = new Set(filteredItems());
          for (const [index, card] of [...list.children].entries()) {
            card.hidden = !matching.has(items[index]);
          }
          const downloadable = Math.min(
            matching.size,
            GPQA_REPORT_DOWNLOAD_LIMIT
          );
          filterSummary.textContent =
            "Showing " +
            matching.size +
            " of " +
            items.length +
            " · download includes " +
            downloadable +
            (matching.size > GPQA_REPORT_DOWNLOAD_LIMIT
              ? " (first 100)"
              : "");
          download.disabled = matching.size === 0;
        };
        download.addEventListener("click", () => {
          const filters = currentFilters();
          const matching = items.filter((item) =>
            itemMatchesFilters(item, filters)
          );
          const exportedItems = matching.slice(
            0,
            GPQA_REPORT_DOWNLOAD_LIMIT
          );
          const countStatus = (status) =>
            exportedItems.filter((item) => item.status === status).length;
          const wrong = countStatus("wrong");
          const noAnswer = countStatus("no_answer");
          const filteredReport = {
            ...report,
            analytics: undefined,
            evaluations: exportedItems.length,
            correct: countStatus("correct"),
            incorrect: wrong + noAnswer,
            wrong,
            noAnswer,
            skipped: countStatus("skipped"),
            totalGenerationTimeMs: exportedItems.reduce((sum, item) => {
              const latencyMs = Number(item.latencyMs);
              return sum + (Number.isFinite(latencyMs) ? latencyMs : 0);
            }, 0),
            items: exportedItems,
            appliedFilters: {
              statuses: [...filters.statuses],
              epoch: filters.epoch,
              subdomain: filters.subdomain,
              reasoning: filters.reasoning,
              latencyGreaterThanSeconds: filters.latency,
              search: filters.search,
              matchedEvaluations: matching.length,
              exportLimit: GPQA_REPORT_DOWNLOAD_LIMIT,
              truncated: matching.length > GPQA_REPORT_DOWNLOAD_LIMIT,
            },
          };
          const url = URL.createObjectURL(
            new Blob([JSON.stringify(filteredReport, null, 2)], {
              type: "application/json",
            })
          );
          const link = document.createElement("a");
          link.href = url;
          link.download = id + "-gpqa-report-filtered.json";
          link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 60000);
        });
        for (const input of statusFilterInputs) {
          input.addEventListener("change", applyFilters);
        }
        for (const control of [
          epochFilter,
          subdomainFilter,
          reasoningFilter,
        ]) {
          control.addEventListener("change", applyFilters);
        }
        latencyFilter.addEventListener("input", applyFilters);
        searchFilter.addEventListener("input", applyFilters);
        applyFilters();
      } catch (error) {
        tab.document.body.textContent = String(error);
      }
    }

    async function openGpqaRetryCampaigns(id, existingTab) {
      const tab = existingTab || window.open("", "_blank");
      if (!tab) {
        dashboardError.textContent =
          "Allow popups to open GPQA retry comparisons.";
        return;
      }
      if (tab.__campaignTimer) {
        window.clearTimeout(tab.__campaignTimer);
      }
      tab.document.title = "Retry and compare with other providers";
      if (!existingTab) {
        tab.document.body.textContent = "Loading retry comparisons…";
      }
      try {
        const response = await api(
          "/runs/" + encodeURIComponent(id) + "/gpqa-retry-comparisons"
        );
        const data = await response.json();
        const document = tab.document;
        document.body.replaceChildren();
        const style = document.createElement("style");
        style.textContent =
          "body{margin:0;background:#0b1020;color:#e8ecf4;font:14px Inter,system-ui,sans-serif}main{max-width:1400px;margin:auto;padding:28px 24px}h1,h2,h3{margin-top:0}.muted{color:#9aa7bd}.panel{margin:18px 0;padding:18px;border:1px solid #27324a;border-radius:12px;background:#131a2b}.bands,.history,.arm-grid{display:grid;gap:12px}.bands{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin:12px 0}.band{display:flex;align-items:center;gap:9px;padding:12px;border:1px solid #3b4967;border-radius:9px}.arm-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.arm{padding:15px;border:1px solid #27324a;border-radius:10px;background:#101729}.arm-editor[hidden]{display:none}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fields[hidden],.fields label[hidden],.field-hint[hidden]{display:none}.fields label{display:grid;gap:5px;color:#9aa7bd}.fields .checkbox-row{display:flex;align-items:center;gap:9px;min-height:38px;color:#e8ecf4}.checkbox-row input{margin:0;flex:0 0 auto}.wide{grid-column:1/-1}.advanced{margin-top:14px;border-top:1px solid #27324a;padding-top:12px}.advanced>summary{cursor:pointer;color:#9be4c7;font-weight:700}.advanced-fields{margin-top:12px}.field-hint{color:#9aa7bd;font-size:12px}input,select,button{padding:9px 11px;border:1px solid #3b4967;border-radius:7px;background:#0b1020;color:#e8ecf4}button{cursor:pointer}.actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:14px}.campaign{padding:14px;border:1px solid #27324a;border-radius:10px;background:#101729}.campaign-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.arm-status{margin-top:12px;padding:12px;border:1px solid #27324a;border-radius:9px}.arm-status-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.arm-status .actions{margin-top:8px}.progress{height:8px;margin:10px 0;border-radius:999px;background:#27324a;overflow:hidden}.progress span{display:block;height:100%;background:#4bd39b}.error{color:#ffb4bc;white-space:pre-wrap}.success{color:#9be4c7}@media(max-width:900px){.arm-grid,.fields{grid-template-columns:1fr}.wide{grid-column:auto}}";
        document.head.appendChild(style);
        const main = document.createElement("main");
        const backToReport = document.createElement("button");
        backToReport.textContent = "← Back to GPQA report";
        backToReport.addEventListener("click", () =>
          openGpqaReport(id, tab)
        );
        main.appendChild(backToReport);
        const heading = document.createElement("h1");
        heading.textContent = "Retry and compare with other providers";
        main.appendChild(heading);
        const subtitle = document.createElement("div");
        subtitle.className = "muted";
        subtitle.textContent =
          "Select questions by source failure count, then compare fresh runs without changing the original score.";
        main.appendChild(subtitle);
        const panel = document.createElement("section");
        panel.className = "panel";
        const panelHeading = document.createElement("h2");
        panelHeading.textContent = "Start a retry comparison";
        panel.appendChild(panelHeading);
        const bands = document.createElement("div");
        bands.className = "bands";
        const bandInputs = [];
        for (const band of data.bands || []) {
          const label = document.createElement("label");
          label.className = "band";
          const input = document.createElement("input");
          input.type = "checkbox";
          input.value = String(band.failures);
          bandInputs.push(input);
          label.appendChild(input);
          label.appendChild(
            document.createTextNode(
              band.failures + "/" + band.epochs + " failures · " +
                band.questionCount + " questions"
            )
          );
          bands.appendChild(label);
        }
        panel.appendChild(bands);
        const makeInput = (container, text, type, value) => {
          const label = document.createElement("label");
          label.appendChild(document.createTextNode(text));
          const input = document.createElement("input");
          input.type = type;
          if (value !== undefined && value !== null) {
            input.value = String(value);
          }
          label.appendChild(input);
          container.appendChild(label);
          return input;
        };
        const makeSelect = (container, text, options, value) => {
          const label = document.createElement("label");
          label.appendChild(document.createTextNode(text));
          const select = document.createElement("select");
          for (const option of options) {
            const element = document.createElement("option");
            element.value = option.value;
            element.textContent = option.label;
            select.appendChild(element);
          }
          select.value =
            value === undefined || value === null ? "" : String(value);
          label.appendChild(select);
          container.appendChild(label);
          return select;
        };
        const makeCheckbox = (container, text, checked) => {
          const label = document.createElement("label");
          label.className = "checkbox-row wide";
          const input = document.createElement("input");
          input.type = "checkbox";
          input.checked = checked === true;
          label.appendChild(input);
          label.appendChild(document.createTextNode(text));
          container.appendChild(label);
          return input;
        };
        const endpointValues = [
          "https://inference.do-ai.run/v1",
          "https://inference.do-ai-test.run/v1",
          "https://openrouter.ai/api/v1",
        ];
        const optionalBooleanOptions = [
          { value: "", label: "Provider default" },
          { value: "true", label: "Enabled" },
          { value: "false", label: "Disabled" },
        ];
        const createArmEditor = (container, titleText, prefix, defaults) => {
          const heading = document.createElement("h3");
          heading.textContent = titleText;
          container.appendChild(heading);
          const basic = document.createElement("div");
          basic.className = "fields";
          const baseUrl = makeInput(
            basic,
            "Inference base URL",
            "url",
            defaults.inference?.baseUrl
          );
          baseUrl.setAttribute("list", prefix + "-endpoints");
          const endpointList = document.createElement("datalist");
          endpointList.id = prefix + "-endpoints";
          for (const value of endpointValues) {
            const option = document.createElement("option");
            option.value = value;
            endpointList.appendChild(option);
          }
          basic.appendChild(endpointList);
          const model = makeInput(
            basic,
            "Model",
            "text",
            defaults.inference?.model
          );
          model.setAttribute("list", prefix + "-models");
          const modelList = document.createElement("datalist");
          modelList.id = prefix + "-models";
          basic.appendChild(modelList);
          const apiKey = makeInput(basic, "Inference API key", "password");
          const repetitions = makeInput(
            basic,
            "Calls per question",
            "number",
            defaults.repetitions
          );
          repetitions.min = "1";
          repetitions.max = "20";
          const concurrency = makeInput(
            basic,
            "Concurrency",
            "number",
            defaults.execution?.concurrency ?? 3
          );
          concurrency.min = "1";
          concurrency.max = "64";
          const unordered = makeCheckbox(
            basic,
            "Use rolling unordered concurrency",
            defaults.execution?.unordered
          );
          container.appendChild(basic);
          const advanced = document.createElement("details");
          advanced.className = "advanced";
          const advancedSummary = document.createElement("summary");
          advancedSummary.textContent = "Advanced configuration";
          advanced.appendChild(advancedSummary);
          const advancedFields = document.createElement("div");
          advancedFields.className = "fields advanced-fields";
          const temperature = makeInput(
            advancedFields,
            "Temperature",
            "number",
            defaults.inference?.temperature
          );
          temperature.step = "0.1";
          const maxTokens = makeInput(
            advancedFields,
            "Max tokens",
            "number",
            defaults.inference?.maxTokens
          );
          const reasoningEffort = makeSelect(
            advancedFields,
            "Reasoning effort",
            [
              { value: "", label: "Provider default" },
              ...["xhigh", "high", "medium", "low", "minimal", "none"].map(
                (value) => ({ value, label: value })
              ),
            ],
            defaults.inference?.reasoningEffort
          );
          const timeoutMs = makeInput(
            advancedFields,
            "Connection timeout (ms)",
            "number",
            defaults.inference?.timeoutMs
          );
          const completionTimeoutMs = makeInput(
            advancedFields,
            "Full response timeout (ms)",
            "number",
            defaults.inference?.completionTimeoutMs ?? 3_600_000
          );
          const sort = makeSelect(
            advancedFields,
            "Provider sort",
            [
              { value: "", label: "Provider default" },
              ...["price", "throughput", "latency", "exacto"].map(
                (value) => ({ value, label: value })
              ),
            ],
            defaults.inference?.sort
          );
          const endpointId = makeInput(
            advancedFields,
            "Endpoint ID",
            "text",
            defaults.inference?.endpointId
          );
          const costTier = makeSelect(
            advancedFields,
            "Cost tier",
            [
              { value: "", label: "Provider default" },
              ...["low", "medium", "high", "xhigh", "max"].map(
                (value) => ({ value, label: value })
              ),
            ],
            defaults.inference?.costTier
          );
          const cloudflareVersion = makeInput(
            advancedFields,
            "Cloudflare version",
            "text",
            defaults.inference?.cloudflareVersion
          );
          const costQualityTradeoff = makeInput(
            advancedFields,
            "Cost-quality tradeoff",
            "number",
            defaults.inference?.costQualityTradeoff
          );
          costQualityTradeoff.min = "0";
          costQualityTradeoff.max = "10";
          const providerOnly = makeInput(
            advancedFields,
            "Provider only (comma separated)",
            "text",
            (defaults.inference?.providerOnly || []).join(",")
          );
          const allowFallbacks = makeSelect(
            advancedFields,
            "Allow provider fallbacks",
            optionalBooleanOptions,
            defaults.inference?.allowFallbacks
          );
          const pinModel = makeSelect(
            advancedFields,
            "Pin model",
            optionalBooleanOptions,
            defaults.inference?.pinModel
          );
          const pinModelHint = document.createElement("div");
          pinModelHint.className = "field-hint wide";
          pinModelHint.textContent =
            "Only applies to OpenRouter auto-router models. Leave as Provider default for direct model runs.";
          advancedFields.appendChild(pinModelHint);
          const configurePinModelVisibility = () => {
            const isAutoRouter =
              model.value === "openrouter/auto" ||
              model.value === "openrouter/auto-beta";
            pinModel.parentElement.hidden = !isAutoRouter;
            pinModelHint.hidden = !isAutoRouter;
            if (!isAutoRouter) {
              pinModel.value = "";
            }
          };
          model.addEventListener("input", configurePinModelVisibility);
          configurePinModelVisibility();
          const maxRetries = makeInput(
            advancedFields,
            "Maximum retries",
            "number",
            defaults.execution?.maxRetries ?? 6
          );
          maxRetries.min = "0";
          maxRetries.max = "20";
          advanced.appendChild(advancedFields);
          container.appendChild(advanced);
          const loadModels = async () => {
            modelList.replaceChildren();
            try {
              const catalogResponse = await api(
                "/model-catalog?baseUrl=" +
                  encodeURIComponent(baseUrl.value)
              );
              const catalog = await catalogResponse.json();
              for (const catalogModel of catalog.models || []) {
                const option = document.createElement("option");
                option.value =
                  typeof catalogModel === "string"
                    ? catalogModel
                    : catalogModel.id;
                modelList.appendChild(option);
              }
            } catch {
              // Arbitrary endpoints intentionally permit manual model input.
            }
          };
          baseUrl.addEventListener("change", loadModels);
          return {
            baseUrl,
            model,
            apiKey,
            repetitions,
            concurrency,
            unordered,
            temperature,
            maxTokens,
            reasoningEffort,
            timeoutMs,
            completionTimeoutMs,
            sort,
            endpointId,
            costTier,
            cloudflareVersion,
            costQualityTradeoff,
            providerOnly,
            allowFallbacks,
            pinModel,
            maxRetries,
          };
        };
        const armGrid = document.createElement("div");
        armGrid.className = "arm-grid";
        const originalArm = document.createElement("section");
        originalArm.className = "arm";
        const originalEditor = createArmEditor(
          originalArm,
          "Original configuration arm",
          "original-retry",
          {
            inference: data.sourceInference,
            execution: data.sourceExecution,
            repetitions: data.sourceEpochs,
          }
        );
        armGrid.appendChild(originalArm);
        const comparisonArm = document.createElement("section");
        comparisonArm.className = "arm";
        const comparisonToggleLabel = document.createElement("label");
        const comparisonToggle = document.createElement("input");
        comparisonToggle.type = "checkbox";
        comparisonToggleLabel.appendChild(comparisonToggle);
        comparisonToggleLabel.appendChild(
          document.createTextNode(" Run alternate provider or model arm")
        );
        comparisonArm.appendChild(comparisonToggleLabel);
        const comparisonFields = document.createElement("div");
        comparisonFields.className = "arm-editor";
        comparisonFields.hidden = true;
        const comparisonEditor = createArmEditor(
          comparisonFields,
          "Alternate configuration",
          "comparison-retry",
          {
            inference: data.sourceInference,
            execution: data.sourceExecution,
            repetitions: data.sourceEpochs,
          }
        );
        comparisonToggle.addEventListener("change", () => {
          comparisonFields.hidden = !comparisonToggle.checked;
        });
        comparisonArm.appendChild(comparisonFields);
        armGrid.appendChild(comparisonArm);
        panel.appendChild(armGrid);
        const identityFields = document.createElement("div");
        identityFields.className = "fields";
        const email = makeInput(
          identityFields,
          "Triggered by (@digitalocean.com)",
          "email"
        );
        const secret = makeInput(
          identityFields,
          "Run-trigger password",
          "password"
        );
        panel.appendChild(identityFields);
        const error = document.createElement("div");
        error.className = "error";
        const actions = document.createElement("div");
        actions.className = "actions";
        const submit = document.createElement("button");
        submit.textContent = "Start retry comparison";
        actions.appendChild(submit);
        panel.appendChild(actions);
        panel.appendChild(error);
        main.appendChild(panel);
        const optionalNumber = (input) =>
          input.value.trim() === "" ? undefined : Number(input.value);
        const optionalBoolean = (select) =>
          select.value === "" ? undefined : select.value === "true";
        const armPayload = (editor) => {
          const providerOnly = editor.providerOnly.value.trim()
            ? editor.providerOnly.value
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean)
            : undefined;
          return {
            apiKey: editor.apiKey.value,
            repetitions: Number(editor.repetitions.value),
            concurrency: Number(editor.concurrency.value),
            unordered: editor.unordered.checked,
            maxRetries: Number(editor.maxRetries.value),
            inference: {
              baseUrl: editor.baseUrl.value,
              model: editor.model.value,
              temperature: optionalNumber(editor.temperature),
              maxTokens: optionalNumber(editor.maxTokens),
              reasoningEffort:
                editor.reasoningEffort.value || undefined,
              timeoutMs: optionalNumber(editor.timeoutMs),
              completionTimeoutMs: optionalNumber(
                editor.completionTimeoutMs
              ),
              sort: editor.sort.value || undefined,
              endpointId: editor.endpointId.value.trim() || undefined,
              costTier: editor.costTier.value || undefined,
              cloudflareVersion:
                editor.cloudflareVersion.value.trim() || undefined,
              costQualityTradeoff: optionalNumber(
                editor.costQualityTradeoff
              ),
              providerOnly,
              allowFallbacks: optionalBoolean(editor.allowFallbacks),
              pinModel: optionalBoolean(editor.pinModel),
            },
          };
        };
        submit.addEventListener("click", async () => {
          error.textContent = "";
          const selectedFailureCounts = bandInputs
            .filter((input) => input.checked)
            .map((input) => Number(input.value));
          if (selectedFailureCounts.length === 0) {
            error.textContent = "Select at least one failure band.";
            return;
          }
          submit.disabled = true;
          const payload = {
            selectedFailureCounts,
            triggeredByEmail: email.value,
            original: armPayload(originalEditor),
            ...(comparisonToggle.checked && {
              comparison: armPayload(comparisonEditor),
            }),
          };
          try {
            await api(
              "/runs/" + encodeURIComponent(id) +
                "/gpqa-retry-comparisons",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Bench-Run-Secret": secret.value,
                },
                body: JSON.stringify(payload),
              }
            );
            tab.__campaignSubmitted = true;
            await openGpqaRetryCampaigns(id, tab);
          } catch (caught) {
            error.textContent = String(caught);
            submit.disabled = false;
          }
        });
        const historyPanel = document.createElement("section");
        historyPanel.className = "panel";
        const historyHeading = document.createElement("h2");
        historyHeading.textContent = "Retry comparison history";
        historyPanel.appendChild(historyHeading);
        const refresh = document.createElement("button");
        refresh.textContent = "Refresh";
        refresh.addEventListener("click", () =>
          openGpqaRetryCampaigns(id, tab)
        );
        historyPanel.appendChild(refresh);
        const history = document.createElement("div");
        history.className = "history";
        for (const campaign of data.comparisons || []) {
          const card = document.createElement("article");
          card.className = "campaign";
          const head = document.createElement("div");
          head.className = "campaign-head";
          const title = document.createElement("strong");
          title.textContent =
            campaign.id + " · " + String(campaign.status).toUpperCase();
          head.appendChild(title);
          card.appendChild(head);
          const details = document.createElement("div");
          details.className = "muted";
          details.textContent =
            campaign.sampleIds.length + " questions · failure bands " +
            campaign.selectedFailureCounts
              .map((count) => count + "/" + campaign.sourceEpochs)
              .join(", ") +
            " · " + campaign.triggeredByEmail;
          card.appendChild(details);
          for (const [label, arm] of [
            ["Original", campaign.originalRun],
            ["Comparison", campaign.comparisonRun],
          ]) {
            if (!arm) {
              continue;
            }
            const armStatus = document.createElement("div");
            armStatus.className = "arm-status";
            const armHead = document.createElement("div");
            armHead.className = "arm-status-head";
            const armSummary = document.createElement("strong");
            armSummary.textContent =
              label +
              ": " +
              arm.status +
              " · " +
              Number(arm.completionPercentage || 0).toFixed(1) +
              "% · " +
              Number(arm.completedEvaluations || 0) +
              "/" +
              Number(arm.totalEvaluations || 0) +
              " completed";
            armHead.appendChild(armSummary);
            const armRunId = document.createElement("span");
            armRunId.className = "muted";
            armRunId.textContent = "Run " + arm.id;
            armHead.appendChild(armRunId);
            armStatus.appendChild(armHead);
            const progress = document.createElement("div");
            progress.className = "progress";
            const fill = document.createElement("span");
            fill.style.width =
              Math.max(0, Math.min(100, arm.completionPercentage || 0)) + "%";
            progress.appendChild(fill);
            armStatus.appendChild(progress);
            if (
              arm.status === "running" &&
              Number(arm.completedEvaluations || 0) === 0
            ) {
              const waiting = document.createElement("div");
              waiting.className = "muted";
              waiting.textContent =
                "No question has completed yet. Open inference requests to see pending calls and errors.";
              armStatus.appendChild(waiting);
            }
            if (arm.failureReason) {
              const armFailure = document.createElement("div");
              armFailure.className = "error";
              armFailure.textContent = arm.failureReason;
              armStatus.appendChild(armFailure);
            }
            const armActions = document.createElement("div");
            armActions.className = "actions";
            const viewLogs = document.createElement("button");
            viewLogs.textContent = "View logs";
            viewLogs.addEventListener("click", () =>
              openText(
                "/runs/" + encodeURIComponent(arm.id) + "/logs?tail=10000",
                label + " retry logs"
              )
            );
            armActions.appendChild(viewLogs);
            const viewRequests = document.createElement("button");
            viewRequests.textContent = "View inference requests";
            viewRequests.addEventListener("click", () =>
              openRequestViewer(arm.id)
            );
            armActions.appendChild(viewRequests);
            armStatus.appendChild(armActions);
            card.appendChild(armStatus);
          }
          if (campaign.failureReason) {
            const failure = document.createElement("div");
            failure.className = "error";
            failure.textContent = campaign.failureReason;
            card.appendChild(failure);
          }
          const campaignActions = document.createElement("div");
          campaignActions.className = "actions";
          const view = document.createElement("button");
          view.textContent = "View comparison report";
          view.title =
            campaign.status === "succeeded"
              ? "View the complete comparison."
              : "View available responses; unfinished responses are shown as empty.";
          view.addEventListener("click", () =>
            openGpqaRetryComparisonReport(id, campaign.id, tab)
          );
          campaignActions.appendChild(view);
          if (campaign.status !== "succeeded") {
            const reportStatus = document.createElement("span");
            reportStatus.className = "muted";
            reportStatus.textContent =
              "Available responses can be viewed now; unfinished responses appear empty.";
            campaignActions.appendChild(reportStatus);
          }
          if (campaign.status === "running") {
            const cancel = document.createElement("button");
            cancel.textContent = "Cancel";
            cancel.addEventListener("click", async () => {
              const password = tab.prompt("Run-trigger password");
              if (!password) {
                return;
              }
              await api(
                "/runs/" + encodeURIComponent(id) +
                  "/gpqa-retry-comparisons/" +
                  encodeURIComponent(campaign.id) + "/cancel",
                {
                  method: "POST",
                  headers: { "X-Bench-Run-Secret": password },
                }
              );
              await openGpqaRetryCampaigns(id, tab);
            });
            campaignActions.appendChild(cancel);
          }
          card.appendChild(campaignActions);
          history.appendChild(card);
        }
        historyPanel.appendChild(history);
        main.appendChild(historyPanel);
        document.body.appendChild(main);
        if (
          tab.__campaignSubmitted &&
          (data.comparisons || []).some(
            (campaign) => campaign.status === "running"
          )
        ) {
          tab.__campaignTimer = window.setTimeout(
            () => openGpqaRetryCampaigns(id, tab),
            5000
          );
        }
      } catch (error) {
        tab.document.body.textContent = String(error);
      }
    }

    async function openGpqaRetryComparisonReport(
      sourceRunId,
      campaignId,
      existingTab
    ) {
      const tab = existingTab || window.open("", "_blank");
      if (!tab) {
        dashboardError.textContent =
          "Allow popups to open the GPQA comparison report.";
        return;
      }
      if (tab.__campaignTimer) {
        window.clearTimeout(tab.__campaignTimer);
        tab.__campaignTimer = undefined;
      }
      if (!existingTab) {
        tab.document.body.textContent = "Loading comparison report…";
      }
      try {
        const response = await api(
          "/runs/" + encodeURIComponent(sourceRunId) +
            "/gpqa-retry-comparisons/" + encodeURIComponent(campaignId) +
            "/report"
        );
        const report = await response.json();
        const document = tab.document;
        document.title = "GPQA retry comparison";
        document.body.replaceChildren();
        const style = document.createElement("style");
        style.textContent =
          "body{margin:0;background:#0b1020;color:#e8ecf4;font:14px Inter,system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:28px 24px}.muted{color:#9aa7bd}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:18px 0}.metric,.question,.attempt{padding:13px;border:1px solid #27324a;border-radius:10px;background:#131a2b}.metric strong{display:block;font-size:20px}.toolbar{display:flex;flex-wrap:wrap;gap:9px;margin:18px 0}input,select,button{padding:9px 11px;border:1px solid #3b4967;border-radius:7px;background:#101729;color:#e8ecf4}.questions{display:grid;gap:16px}.question-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.attempts{display:grid;gap:9px}.attempt summary{cursor:pointer;font-weight:700}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;background:#0b1020;padding:10px;border-radius:7px}.correct{color:#9be4c7}.failure{color:#ffb4bc}@media(max-width:1000px){.question-grid{grid-template-columns:1fr}}";
        document.head.appendChild(style);
        const main = document.createElement("main");
        const backToCampaigns = document.createElement("button");
        backToCampaigns.textContent = "← Back to retry comparisons";
        backToCampaigns.addEventListener("click", () =>
          openGpqaRetryCampaigns(sourceRunId, tab)
        );
        main.appendChild(backToCampaigns);
        const heading = document.createElement("h1");
        heading.textContent = "GPQA retry comparison";
        main.appendChild(heading);
        const subtitle = document.createElement("div");
        subtitle.className = "muted";
        subtitle.textContent =
          campaignId + " · Source run " + sourceRunId + " · " +
          String(report.status || "unknown").toUpperCase();
        main.appendChild(subtitle);
        const configurations = document.createElement("details");
        const configurationsSummary = document.createElement("summary");
        configurationsSummary.textContent = "Arm configurations";
        configurations.appendChild(configurationsSummary);
        const configurationsPre = document.createElement("pre");
        configurationsPre.textContent = JSON.stringify(
          {
            original: report.originalInference,
            comparison: report.comparisonInference,
          },
          null,
          2
        );
        configurations.appendChild(configurationsPre);
        main.appendChild(configurations);
        const metrics = document.createElement("div");
        metrics.className = "metrics";
        const addMetrics = (label, summary) => {
          if (!summary) {
            return;
          }
          for (const [name, value] of [
            [label + " accuracy", summary.accuracy === null ? "—" : (summary.accuracy * 100).toFixed(2) + "%"],
            [label + " recovery", summary.recoveryRate === null ? "—" : (summary.recoveryRate * 100).toFixed(2) + "%"],
            [label + " avg latency", formatLatencyMs(summary.averageLatencyMs)],
            [label + " consistently correct", summary.consistentCorrectQuestions + "/" + summary.selectedQuestions],
            [
              label + " answer distribution",
              Object.entries(summary.answerDistribution || {})
                .map(([answer, count]) => answer + ": " + count)
                .join(" · ") || "—",
            ],
          ]) {
            const card = document.createElement("div");
            card.className = "metric";
            const strong = document.createElement("strong");
            strong.textContent = value;
            card.appendChild(strong);
            card.appendChild(document.createTextNode(name));
            metrics.appendChild(card);
          }
        };
        addMetrics("Source", report.sourceSummary);
        addMetrics("Original rerun", report.originalSummary);
        addMetrics("Comparison", report.comparisonSummary);
        main.appendChild(metrics);
        const toolbar = document.createElement("div");
        toolbar.className = "toolbar";
        const refresh = document.createElement("button");
        refresh.textContent = "Refresh responses";
        refresh.addEventListener("click", () =>
          openGpqaRetryComparisonReport(sourceRunId, campaignId, tab)
        );
        toolbar.appendChild(refresh);
        const search = document.createElement("input");
        search.type = "search";
        search.placeholder = "Search question, answer, reasoning…";
        toolbar.appendChild(search);
        const band = document.createElement("select");
        const allBands = document.createElement("option");
        allBands.value = "all";
        allBands.textContent = "All failure bands";
        band.appendChild(allBands);
        for (const count of report.selectedFailureCounts || []) {
          const option = document.createElement("option");
          option.value = String(count);
          option.textContent = count + "/" + report.sourceEpochs + " failures";
          band.appendChild(option);
        }
        toolbar.appendChild(band);
        const subdomain = document.createElement("select");
        const allSubdomains = document.createElement("option");
        allSubdomains.value = "all";
        allSubdomains.textContent = "All subdomains";
        subdomain.appendChild(allSubdomains);
        for (const value of [
          ...new Set(
            (report.questions || []).map((item) => item.subdomain || "Unknown")
          ),
        ].sort((a, b) => a.localeCompare(b))) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value;
          subdomain.appendChild(option);
        }
        toolbar.appendChild(subdomain);
        const outcome = document.createElement("select");
        for (const [value, text] of [
          ["all", "All outcomes"],
          ["recovered", "Recovered by any arm"],
          ["not-recovered", "Not recovered"],
        ]) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = text;
          outcome.appendChild(option);
        }
        toolbar.appendChild(outcome);
        const armOutcome = document.createElement("select");
        for (const [value, text] of [
          ["all", "All arm outcomes"],
          ["original", "Original arm recovered"],
          ["comparison", "Comparison arm recovered"],
          ["both", "Both arms recovered"],
          ["different", "Arms differ"],
        ]) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = text;
          armOutcome.appendChild(option);
        }
        toolbar.appendChild(armOutcome);
        const download = document.createElement("button");
        download.textContent = "Download JSON";
        download.addEventListener("click", () =>
          downloadArtifact(
            "/runs/" + encodeURIComponent(sourceRunId) +
              "/gpqa-retry-comparisons/" + encodeURIComponent(campaignId) +
              "/report?download=1",
            campaignId + "-gpqa-retry-report.json"
          )
        );
        toolbar.appendChild(download);
        main.appendChild(toolbar);
        const questions = document.createElement("div");
        questions.className = "questions";
        const attemptColumn = (title, attempts) => {
          const column = document.createElement("section");
          const heading = document.createElement("h3");
          heading.textContent = title;
          column.appendChild(heading);
          const list = document.createElement("div");
          list.className = "attempts";
          if (attempts.length === 0) {
            const empty = document.createElement("div");
            empty.className = "attempt muted";
            empty.textContent = "No completed response yet.";
            list.appendChild(empty);
          }
          for (const item of attempts) {
            const details = document.createElement("details");
            details.className = "attempt";
            const summary = document.createElement("summary");
            summary.className =
              item.status === "correct" ? "correct" : "failure";
            summary.textContent =
              "Epoch " + (Number(item.epoch) + 1) + " · " +
              item.status + " · extracted " +
              (item.extractedAnswer || "none") + " · " +
              formatLatencyMs(item.latencyMs);
            details.appendChild(summary);
            for (const [label, value] of [
              ["Full model response", item.modelAnswer],
              ["Exposed reasoning", item.reasoning],
              ["Scorer explanation", item.scorerExplanation],
            ]) {
              const name = document.createElement("strong");
              name.textContent = label;
              details.appendChild(name);
              const pre = document.createElement("pre");
              pre.textContent = value || "Not available";
              details.appendChild(pre);
            }
            list.appendChild(details);
          }
          column.appendChild(list);
          return column;
        };
        for (const item of report.questions || []) {
          const card = document.createElement("article");
          card.className = "question";
          card.dataset.band = String(item.failureCount);
          card.dataset.subdomain = item.subdomain || "Unknown";
          card.dataset.search = JSON.stringify(item).toLowerCase();
          const originalRecovered = item.originalAttempts.some(
            (attempt) => attempt.status === "correct"
          );
          const comparisonRecovered = item.comparisonAttempts.some(
            (attempt) => attempt.status === "correct"
          );
          card.dataset.originalRecovered = String(originalRecovered);
          card.dataset.comparisonRecovered = String(comparisonRecovered);
          card.dataset.recovered =
            originalRecovered || comparisonRecovered
              ? "true"
              : "false";
          const title = document.createElement("h2");
          title.textContent =
            item.sampleId + " · " + item.failureCount + "/" +
            item.sourceEpochs + " source failures";
          card.appendChild(title);
          const question = document.createElement("pre");
          question.textContent =
            item.question + "\\n\\n" +
            Object.entries(item.choices || {})
              .map(([letter, value]) => letter + ") " + value)
              .join("\\n") +
            "\\n\\nCorrect answer: " + item.correctAnswer +
            (item.correctAnswerText ? ") " + item.correctAnswerText : "");
          card.appendChild(question);
          const grid = document.createElement("div");
          grid.className = "question-grid";
          grid.appendChild(
            attemptColumn("Original run responses", item.sourceAttempts)
          );
          grid.appendChild(
            attemptColumn(
              "Current retry · original provider",
              item.originalAttempts
            )
          );
          grid.appendChild(
            attemptColumn(
              "Current retry · comparison provider",
              item.comparisonAttempts
            )
          );
          card.appendChild(grid);
          questions.appendChild(card);
        }
        main.appendChild(questions);
        document.body.appendChild(main);
        const filter = () => {
          const query = search.value.trim().toLowerCase();
          for (const card of questions.children) {
            const bandMatches =
              band.value === "all" || card.dataset.band === band.value;
            const subdomainMatches =
              subdomain.value === "all" ||
              card.dataset.subdomain === subdomain.value;
            const outcomeMatches =
              outcome.value === "all" ||
              (outcome.value === "recovered"
                ? card.dataset.recovered === "true"
                : card.dataset.recovered === "false");
            const originalRecovered =
              card.dataset.originalRecovered === "true";
            const comparisonRecovered =
              card.dataset.comparisonRecovered === "true";
            const armMatches =
              armOutcome.value === "all" ||
              (armOutcome.value === "original" && originalRecovered) ||
              (armOutcome.value === "comparison" && comparisonRecovered) ||
              (armOutcome.value === "both" &&
                originalRecovered &&
                comparisonRecovered) ||
              (armOutcome.value === "different" &&
                originalRecovered !== comparisonRecovered);
            card.hidden =
              !bandMatches ||
              !subdomainMatches ||
              !outcomeMatches ||
              !armMatches ||
              (query !== "" && !card.dataset.search.includes(query));
          }
        };
        search.addEventListener("input", filter);
        band.addEventListener("change", filter);
        subdomain.addEventListener("change", filter);
        outcome.addEventListener("change", filter);
        armOutcome.addEventListener("change", filter);
      } catch (error) {
        const document = tab.document;
        document.title = "Comparison report unavailable";
        document.body.replaceChildren();
        const style = document.createElement("style");
        style.textContent =
          "body{margin:0;background:#0b1020;color:#e8ecf4;font:14px Inter,system-ui,sans-serif}main{max-width:760px;margin:auto;padding:48px 24px}.panel{padding:22px;border:1px solid #27324a;border-radius:12px;background:#131a2b}.muted{color:#9aa7bd}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}button{padding:9px 12px;border:1px solid #3b4967;border-radius:7px;background:#101729;color:#e8ecf4;cursor:pointer}";
        document.head.appendChild(style);
        let details;
        try {
          details = JSON.parse(String(error).replace(/^Error:\\s*/, ""));
        } catch {
          details = undefined;
        }
        const status = details?.comparison?.status;
        const main = document.createElement("main");
        const panel = document.createElement("section");
        panel.className = "panel";
        const heading = document.createElement("h1");
        heading.textContent = "Comparison report unavailable";
        panel.appendChild(heading);
        const message = document.createElement("p");
        if (status === "cancelled") {
          message.textContent =
            "This retry comparison was cancelled before all required results were available.";
        } else if (status === "running") {
          message.textContent =
            "Both arms must finish before the comparison report can be generated.";
        } else {
          message.textContent =
            details?.error ||
            "The report could not be loaded. Return to the comparison details to inspect each arm.";
        }
        panel.appendChild(message);
        const guidance = document.createElement("p");
        guidance.className = "muted";
        guidance.textContent =
          "The comparison details page includes each child run's status, failure reason, logs, and inference requests.";
        panel.appendChild(guidance);
        const actions = document.createElement("div");
        actions.className = "actions";
        const back = document.createElement("button");
        back.textContent = "← Back to retry comparisons";
        back.addEventListener("click", () =>
          openGpqaRetryCampaigns(sourceRunId, tab)
        );
        actions.appendChild(back);
        if (status === "running") {
          const retry = document.createElement("button");
          retry.textContent = "Try loading report again";
          retry.addEventListener("click", () =>
            openGpqaRetryComparisonReport(sourceRunId, campaignId, tab)
          );
          actions.appendChild(retry);
        }
        panel.appendChild(actions);
        main.appendChild(panel);
        document.body.appendChild(main);
      }
    }

    async function openTauAirlineReport(id) {
      const tab = window.open("", "_blank");
      if (!tab) {
        dashboardError.textContent =
          "Allow popups to open the TAU Airline report.";
        return;
      }
      tab.document.title = "TAU Airline report";
      tab.document.body.textContent = "Loading TAU Airline report…";
      try {
        const response = await api(
          "/runs/" + encodeURIComponent(id) + "/tau-airline-report"
        );
        const report = await response.json();
        const items = Array.isArray(report.items) ? report.items : [];
        const document = tab.document;
        document.body.replaceChildren();
        const style = document.createElement("style");
        style.textContent =
          "body{margin:0;background:#0b1020;color:#e8ecf4;font:14px Inter,system-ui,sans-serif}" +
          "main{max-width:1400px;margin:auto;padding:30px 24px}h1{margin:0 0 6px}.muted{color:#9aa7bd}" +
          ".counts{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0}.count{padding:9px 12px;border:1px solid #27324a;border-radius:8px;background:#131a2b}" +
          ".toolbar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:10px;padding:14px;margin:0 0 18px;background:#0b1020;border-bottom:1px solid #27324a}" +
          "button,select,input{padding:8px 11px;border:1px solid #3b4967;border-radius:7px;background:#131a2b;color:#e8ecf4}button{cursor:pointer}" +
          ".filter{display:flex;align-items:center;gap:7px;color:#9aa7bd}.filter input{min-width:220px}" +
          ".list{display:grid;gap:14px}.item{border:1px solid #27324a;border-radius:12px;background:#131a2b;padding:18px}" +
          ".item-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:14px}.item-head strong{font-size:16px}.badge{padding:4px 9px;border-radius:999px;font-size:12px;font-weight:700}" +
          ".item-actions{display:flex;gap:8px;margin:-3px 0 14px}.retry-action{display:inline-flex;align-items:center;gap:6px;padding:6px 9px;font-size:12px}" +
          ".passed{background:#173f35;color:#9be4c7}.failed{background:#54242b;color:#ffb4bc}.skipped{background:#4a3d20;color:#f5d38d}" +
          ".grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}.field{min-width:0}.field.wide{grid-column:1/-1}" +
          ".label{display:block;margin-bottom:6px;color:#9aa7bd;font-size:12px;text-transform:uppercase;letter-spacing:.04em}" +
          "pre{margin:0;padding:11px;border-radius:8px;background:#0b1020;white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto}" +
          ".answer{color:#9be4c7}.empty{color:#9aa7bd;font-style:italic}@media(max-width:850px){.grid{grid-template-columns:1fr}.field.wide{grid-column:auto}}";
        document.head.appendChild(style);
        const main = document.createElement("main");
        const heading = document.createElement("h1");
        heading.textContent = "TAU Bench Verified Airline report";
        main.appendChild(heading);
        const subtitle = document.createElement("div");
        subtitle.className = "muted";
        subtitle.textContent =
          report.model + " · " + items.length + " evaluations · Run " + id;
        main.appendChild(subtitle);
        const counts = document.createElement("div");
        counts.className = "counts";
        for (const entry of [
          ["Passed", Number(report.passed || 0)],
          ["Failed", Number(report.failed || 0)],
          ["Skipped", Number(report.skipped || 0)],
          [
            "Total agent generation time",
            formatLatencyMs(report.totalGenerationTimeMs),
          ],
        ]) {
          const count = document.createElement("span");
          count.className = "count";
          count.textContent = entry[0] + ": " + entry[1];
          counts.appendChild(count);
        }
        main.appendChild(counts);
        const filterSummary = document.createElement("div");
        filterSummary.className = "muted";
        const toolbar = document.createElement("div");
        toolbar.className = "toolbar";
        const download = document.createElement("button");
        download.textContent = "Download JSON";
        download.addEventListener("click", () =>
          downloadArtifact(
            "/runs/" + encodeURIComponent(id) +
              "/tau-airline-report?download=1",
            id + "-tau-airline-report.json"
          )
        );
        toolbar.appendChild(download);
        const makeSelect = (labelText, options) => {
          const label = document.createElement("label");
          label.className = "filter";
          label.appendChild(document.createTextNode(labelText));
          const select = document.createElement("select");
          for (const option of options) {
            const element = document.createElement("option");
            element.value = option.value;
            element.textContent = option.label;
            select.appendChild(element);
          }
          label.appendChild(select);
          toolbar.appendChild(label);
          return select;
        };
        const resultFilter = makeSelect("Result", [
          { value: "all", label: "All (" + items.length + ")" },
          { value: "passed", label: "Passed (" + report.passed + ")" },
          { value: "failed", label: "Failed (" + report.failed + ")" },
          { value: "skipped", label: "Skipped (" + report.skipped + ")" },
        ]);
        const epochs = [...new Set(items.map((item) => Number(item.epoch)))]
          .filter(Number.isFinite)
          .sort((a, b) => a - b);
        const epochFilter = makeSelect(
          "Epoch",
          [{ value: "all", label: "All epochs" }].concat(
            epochs.map((epoch) => ({
              value: String(epoch),
              label: "Epoch " + (epoch + 1),
            }))
          )
        );
        const terminationReasons = [
          ...new Set(
            items.map((item) => String(item.terminationReason || "Unknown"))
          ),
        ].sort((a, b) => a.localeCompare(b));
        const terminationFilter = makeSelect(
          "Termination",
          [{ value: "all", label: "All reasons" }].concat(
            terminationReasons.map((reason) => ({
              value: reason,
              label: reason,
            }))
          )
        );
        const toolsFilter = makeSelect("Tool calls", [
          { value: "all", label: "All" },
          { value: "with", label: "With tool calls" },
          { value: "without", label: "Without tool calls" },
        ]);
        const reasoningFilter = makeSelect("Reasoning", [
          { value: "all", label: "All" },
          { value: "with", label: "With reasoning" },
          { value: "without", label: "Without reasoning" },
        ]);
        const searchLabel = document.createElement("label");
        searchLabel.className = "filter";
        searchLabel.appendChild(document.createTextNode("Search"));
        const searchFilter = document.createElement("input");
        searchFilter.type = "search";
        searchFilter.placeholder = "Scenario, answer, tool call…";
        searchLabel.appendChild(searchFilter);
        toolbar.appendChild(searchLabel);
        toolbar.appendChild(filterSummary);
        main.appendChild(toolbar);
        const list = document.createElement("div");
        list.className = "list";
        const addField = (container, labelText, value, wide, valueClass) => {
          const field = document.createElement("div");
          field.className = "field" + (wide ? " wide" : "");
          const label = document.createElement("span");
          label.className = "label";
          label.textContent = labelText;
          const content = document.createElement("pre");
          content.textContent =
            value === null || value === undefined || value === ""
              ? "Not available"
              : String(value);
          if (value === null || value === undefined || value === "") {
            content.className = "empty";
          } else if (valueClass) {
            content.className = valueClass;
          }
          field.appendChild(label);
          field.appendChild(content);
          container.appendChild(field);
        };
        const conversationText = (turns) =>
          (turns || [])
            .map((turn, index) => {
              const sections = [
                (index + 1) + ". [" + String(turn.role).toUpperCase() + "]",
              ];
              if (turn.content) {
                sections.push(turn.content);
              }
              if (turn.reasoning) {
                sections.push("Reasoning:\\n" + turn.reasoning);
              }
              if (Array.isArray(turn.toolCalls) && turn.toolCalls.length > 0) {
                sections.push(
                  "Tool calls:\\n" + JSON.stringify(turn.toolCalls, null, 2)
                );
              }
              return sections.join("\\n");
            })
            .join("\\n\\n");
        for (const [index, item] of items.entries()) {
          const card = document.createElement("article");
          card.className = "item";
          card.dataset.status = String(item.status);
          card.dataset.epoch = String(item.epoch);
          card.dataset.termination = String(
            item.terminationReason || "Unknown"
          );
          card.dataset.hasTools =
            Array.isArray(item.actualToolCalls) &&
            item.actualToolCalls.length > 0
              ? "true"
              : "false";
          card.dataset.hasReasoning = item.hasReasoning ? "true" : "false";
          card.dataset.search = JSON.stringify(item).toLowerCase();
          const itemHead = document.createElement("div");
          itemHead.className = "item-head";
          const title = document.createElement("strong");
          title.textContent =
            (index + 1) + ". " + item.taskId + " · Epoch " +
            (Number(item.epoch) + 1);
          const badge = document.createElement("span");
          badge.className = "badge " + item.status;
          const statusLabels = {
            passed: "Passed",
            failed: "Failed",
            skipped: "Skipped",
          };
          badge.textContent = statusLabels[item.status] || "Skipped";
          const termination = document.createElement("span");
          termination.className = "muted";
          termination.textContent =
            (item.terminationReason || "Unknown") +
            " · " +
            (item.stepCount === null ? "—" : item.stepCount) +
            " steps · Reward " +
            (item.reward === null ? "—" : item.reward) +
            " · Agent latency " +
            formatLatencyMs(item.latencyMs);
          itemHead.appendChild(title);
          itemHead.appendChild(badge);
          itemHead.appendChild(termination);
          card.appendChild(itemHead);
          const itemActions = document.createElement("div");
          itemActions.className = "item-actions";
          const retry = document.createElement("button");
          retry.type = "button";
          retry.className = "retry-action";
          retry.textContent = "↻ Retry";
          retry.title =
            "Rerun this complete TAU scenario without changing the original score";
          retry.addEventListener("click", () =>
            openReportRetryPanel(
              document,
              id,
              item,
              (retried) => [
                ["Result", retried.status],
                ["Reward", retried.reward],
                ["Agent latency", formatLatencyMs(retried.latencyMs)],
                ["Termination", retried.terminationReason],
                ["Final agent answer", retried.finalAgentAnswer],
                ["Actual tool calls", retried.actualToolCalls],
                ["Conversation", conversationText(retried.conversation)],
                ["Scorer explanation", retried.scorerExplanation],
              ],
              !isDigitalOceanCandidateBaseUrl(report.inference?.baseUrl)
            )
          );
          itemActions.appendChild(retry);
          card.appendChild(itemActions);
          const grid = document.createElement("div");
          grid.className = "grid";
          addField(grid, "Scenario", item.scenario, true);
          addField(grid, "Persona", item.persona, false);
          addField(grid, "Purpose", item.purpose, false);
          addField(
            grid,
            "Expected evaluation criteria",
            JSON.stringify(
              {
                rewardBasis: item.rewardBasis,
                actions: item.expectedActions,
                communicate: item.expectedCommunications,
                environmentAssertions: item.expectedEnvironmentAssertions,
                naturalLanguageAssertions:
                  item.expectedNaturalLanguageAssertions,
              },
              null,
              2
            ),
            true
          );
          addField(
            grid,
            "Actual tool calls",
            JSON.stringify(item.actualToolCalls || [], null, 2),
            true
          );
          addField(
            grid,
            "Final agent answer",
            item.finalAgentAnswer,
            true,
            "answer"
          );
          addField(
            grid,
            "Scorer explanation",
            item.scorerExplanation,
            true
          );
          addField(
            grid,
            "Conversation",
            conversationText(item.conversation),
            true
          );
          card.appendChild(grid);
          list.appendChild(card);
        }
        main.appendChild(list);
        document.body.appendChild(main);
        const applyFilters = () => {
          const query = searchFilter.value.trim().toLowerCase();
          let visible = 0;
          for (const card of list.children) {
            const resultMatches =
              resultFilter.value === "all" ||
              card.dataset.status === resultFilter.value;
            const epochMatches =
              epochFilter.value === "all" ||
              card.dataset.epoch === epochFilter.value;
            const terminationMatches =
              terminationFilter.value === "all" ||
              card.dataset.termination === terminationFilter.value;
            const toolsMatches =
              toolsFilter.value === "all" ||
              (toolsFilter.value === "with"
                ? card.dataset.hasTools === "true"
                : card.dataset.hasTools === "false");
            const reasoningMatches =
              reasoningFilter.value === "all" ||
              (reasoningFilter.value === "with"
                ? card.dataset.hasReasoning === "true"
                : card.dataset.hasReasoning === "false");
            const searchMatches =
              query === "" || card.dataset.search.includes(query);
            const show =
              resultMatches &&
              epochMatches &&
              terminationMatches &&
              toolsMatches &&
              reasoningMatches &&
              searchMatches;
            card.hidden = !show;
            if (show) {
              visible += 1;
            }
          }
          filterSummary.textContent =
            "Showing " + visible + " of " + items.length;
        };
        for (const control of [
          resultFilter,
          epochFilter,
          terminationFilter,
          toolsFilter,
          reasoningFilter,
        ]) {
          control.addEventListener("change", applyFilters);
        }
        searchFilter.addEventListener("input", applyFilters);
        applyFilters();
      } catch (error) {
        tab.document.body.textContent = String(error);
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

    function setStartFormValue(name, value) {
      const field = startForm.elements.namedItem(name);
      if (field !== null && "value" in field) {
        field.value =
          value === undefined || value === null ? "" : String(value);
      }
    }

    async function openRunRetry(run) {
      const inference = run.args.inference || {};
      const execution = run.args.execution || {};
      startForm.reset();
      startBenchmark.value = run.args.benchmark;
      applyBenchmarkDefaults();

      const knownBaseUrl = Array.from(inferenceBaseUrl.options).some(
        (option) =>
          option.value !== "other" && option.value === inference.baseUrl
      );
      inferenceBaseUrl.value = knownBaseUrl ? inference.baseUrl : "other";
      startError.textContent = "";
      setStartFormValue(
        "triggeredByEmail",
        run.triggeredByEmail || run.args.triggeredByEmail
      );
      setStartFormValue("triggerSecret", "");
      setStartFormValue("apiKey", "");
      setStartFormValue("simulatorApiKey", "");
      startDialog.showModal();

      await Promise.all([
        configureInferenceControls(),
        configureJudgeModelControls()
      ]);

      if (knownBaseUrl) {
        catalogModel.value = inference.model || "";
      } else {
        manualBaseUrl.value = inference.baseUrl || "";
        manualModel.value = inference.model || "";
      }
      sweAtlasJudgeModel.value = run.args.judgeModel || "";
      setStartFormValue("epochs", execution.epochs);
      setStartFormValue("concurrency", execution.concurrency);
      startForm.elements.namedItem("unordered").checked =
        execution.unordered === true;
      setStartFormValue("limit", execution.limit);
      setStartFormValue("start", execution.start);
      setStartFormValue("end", execution.end);
      setStartFormValue("maxRetries", execution.maxRetries);
      setStartFormValue("maxTokens", inference.maxTokens);
      setStartFormValue("temperature", inference.temperature);
      setStartFormValue("reasoningEffort", inference.reasoningEffort);
      setStartFormValue("timeoutMs", inference.timeoutMs);
      setStartFormValue(
        "completionTimeoutMs",
        inference.completionTimeoutMs
      );
      setStartFormValue("endpointId", inference.endpointId);
      setStartFormValue("costTier", inference.costTier);
      setStartFormValue("sort", inference.sort);
      setStartFormValue(
        "providerOnly",
        Array.isArray(inference.providerOnly)
          ? inference.providerOnly[0]
          : undefined
      );
      openrouterFallbacks.checked =
        inference.allowFallbacks === undefined
          ? true
          : inference.allowFallbacks === true;
      setStartFormValue("cloudflareVersion", inference.cloudflareVersion);
      setStartFormValue(
        "costQualityTradeoff",
        inference.costQualityTradeoff
      );
      setStartFormValue(
        "pinModel",
        inference.pinModel === undefined ? undefined : inference.pinModel
      );
      setStartFormValue("logLevel", run.args.logLevel);
    }

    function runPayload(form) {
      const data = new FormData(form);
      const benchmark = String(data.get("benchmark") || "gpqa_diamond");
      const judgeModel = String(data.get("judgeModel") || "").trim();
      const limit = String(data.get("limit") || "").trim();
      const start = String(data.get("start") || "").trim();
      const end = String(data.get("end") || "").trim();
      const maxTokens = String(data.get("maxTokens") || "").trim();
      const temperature = String(data.get("temperature") || "").trim();
      const reasoningEffort = String(
        data.get("reasoningEffort") || ""
      ).trim();
      const timeoutMs = String(data.get("timeoutMs") || "").trim();
      const completionTimeoutMs = String(
        data.get("completionTimeoutMs") || ""
      ).trim();
      const endpointId = String(data.get("endpointId") || "").trim();
      const costTier = String(data.get("costTier") || "").trim();
      const sort = String(data.get("sort") || "").trim();
      const providerOnly = String(data.get("providerOnly") || "").trim();
      const cloudflareVersion = String(
        data.get("cloudflareVersion") || ""
      ).trim();
      const costQualityTradeoff = String(
        data.get("costQualityTradeoff") || ""
      ).trim();
      const pinModel = String(data.get("pinModel") || "").trim();
      const maxRetries = String(data.get("maxRetries") || "").trim();
      const logLevel = String(data.get("logLevel") || "").trim();
      const simulatorApiKey = String(
        data.get("simulatorApiKey") || ""
      ).trim();
      const isOther = data.get("baseUrl") === "other";
      const isOpenRouter =
        data.get("baseUrl") === "https://openrouter.ai/api/v1";
      return {
        benchmark,
        triggeredByEmail: String(data.get("triggeredByEmail")),
        ...(isSweAtlasBenchmark(benchmark) &&
          judgeModel !== "" && { judgeModel }),
        ...(benchmark === "tau_bench_verified_airline" &&
          simulatorApiKey !== "" && { simulatorApiKey }),
        ...(logLevel === "" ? {} : { logLevel }),
        inference: {
          baseUrl: String(
            isOther ? data.get("manualBaseUrl") : data.get("baseUrl")
          ),
          apiKey: String(data.get("apiKey")),
          model: String(
            isOther ? data.get("manualModel") : data.get("catalogModel")
          ),
          ...(temperature === "" ? {} : { temperature: Number(temperature) }),
          ...(maxTokens === "" ? {} : { maxTokens: Number(maxTokens) }),
          ...(reasoningEffort === "" ? {} : { reasoningEffort }),
          ...(timeoutMs === "" ? {} : { timeoutMs: Number(timeoutMs) }),
          ...(completionTimeoutMs === ""
            ? {}
            : { completionTimeoutMs: Number(completionTimeoutMs) }),
          ...(endpointId === "" ? {} : { endpointId }),
          ...(costTier === "" ? {} : { costTier }),
          ...(sort === "" ? {} : { sort }),
          ...(isOpenRouter && providerOnly !== ""
            ? { providerOnly: [providerOnly] }
            : {}),
          ...(isOpenRouter
            ? { allowFallbacks: data.get("allowFallbacks") === "on" }
            : {}),
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
          ...(start === "" ? {} : { start: Number(start) }),
          ...(end === "" ? {} : { end: Number(end) }),
          ...(maxRetries === "" ? {} : { maxRetries: Number(maxRetries) })
        }
      };
    }

    function applyBenchmarkDefaults() {
      const isTau = startBenchmark.value === "tau_bench_verified_airline";
      const isDeepSwe = startBenchmark.value === "deep_swe";
      const isSweBench = startBenchmark.value === "swe_bench_verified";
      const isTerminalBench = startBenchmark.value === "terminal_bench";
      const isSweAtlas = isSweAtlasBenchmark(startBenchmark.value);
      const isSandboxBenchmark =
        isDeepSwe || isSweBench || isTerminalBench || isSweAtlas;
      const temperature = startForm.elements.namedItem("temperature");
      if (temperature) {
        temperature.value = isTau || isSandboxBenchmark ? "0" : "1";
      }
      const epochs = startForm.elements.namedItem("epochs");
      if (epochs) {
        epochs.value = isSandboxBenchmark ? "1" : "3";
      }
      const concurrency = startForm.elements.namedItem("concurrency");
      if (concurrency) {
        concurrency.value = isSandboxBenchmark ? "1" : "3";
        concurrency.max = isSandboxBenchmark ? "6" : "64";
      }
      sweAtlasJudgeModelLabel.hidden = !isSweAtlas;
      sweAtlasJudgeModel.disabled = !isSweAtlas;
      sweAtlasJudgeModel.required = isSweAtlas;
      tauUserSimulatorDefault.hidden = !isTau;
      configureTauSimulatorControls();
    }

    const scheduleRunFilterReload = () => {
      window.clearTimeout(filterTimer);
      filterTimer = window.setTimeout(applyRunFilters, 300);
    };
    for (const filter of [
      runModelFilter,
      runDurationFilter,
      runTriggeredFilter,
      runQualityFilter,
    ]) {
      filter.addEventListener("input", scheduleRunFilterReload);
    }
    runBenchmarkFilter.addEventListener("change", applyRunFilters);
    runStatusFilter.addEventListener("change", applyRunFilters);
    hideCanaryRuns.addEventListener("change", applyRunFilters);
    showDisabledRuns.addEventListener("change", applyRunFilters);
    document
      .getElementById("close-model-history")
      .addEventListener("click", closeModelHistory);
    modelHistoryBackdrop.addEventListener("click", closeModelHistory);
    modelHistoryIncludeNonCanary.addEventListener("change", () => {
      void loadModelHistory();
    });
    modelHistoryBenchmark.addEventListener("change", () => {
      void loadModelHistory();
    });
    modelHistoryStatus.addEventListener("change", () => {
      void loadModelHistory();
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modelHistoryDrawer.hidden) {
        closeModelHistory();
      }
    });
    previousRunPage.addEventListener("click", () => {
      if (runPage > 1) {
        runPage -= 1;
        void loadRuns();
      }
    });
    nextRunPage.addEventListener("click", () => {
      if (runPage < runTotalPages) {
        runPage += 1;
        void loadRuns();
      }
    });
    document
      .getElementById("clear-run-filters")
      .addEventListener("click", () => {
        runModelFilter.value = "";
        runDurationFilter.value = "";
        runTriggeredFilter.value = "";
        runBenchmarkFilter.value = "all";
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
    openrouterProvider.addEventListener("change", () => {
      openrouterFallbacks.checked = openrouterProvider.value === "";
    });
    startBenchmark.addEventListener("change", () => {
      applyBenchmarkDefaults();
      void configureJudgeModelControls();
    });
    startButton.addEventListener("click", async () => {
      startError.textContent = "";
      startDialog.showModal();
      await Promise.all([
        configureInferenceControls(),
        configureJudgeModelControls()
      ]);
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
        const benchmark = String(data.get("benchmark"));
        const epochs = Number(data.get("epochs"));
        const usesSandboxWorkers =
          benchmark !== "gpqa_diamond" &&
          benchmark !== "tau_bench_verified_airline";
        if (
          usesSandboxWorkers &&
          epochs > 1 &&
          !window.confirm(
            "Running this benchmark for more than one epoch can take a long time to finish and is not recommended. Start the run anyway?"
          )
        ) {
          return;
        }
        if (
          inferenceBaseUrl.value !== "other" &&
          (!catalogReady || !catalogModels.has(catalogModel.value))
        ) {
          throw new Error("Select a model from the loaded model list.");
        }
        if (
          isSweAtlasBenchmark(startBenchmark.value) &&
          (!judgeCatalogReady ||
            !judgeCatalogModels.has(sweAtlasJudgeModel.value))
        ) {
          throw new Error("Select a judge model from the loaded model list.");
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
        applyBenchmarkDefaults();
        void configureInferenceControls();
        void configureJudgeModelControls();
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
