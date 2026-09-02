import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { fetchAgents, fetchTraces, fetchTreatyCompliance, fetchTreatyComplianceDetail, logout as apiLogout } from "./services/api";

/* ============================================================================
   SYNAPSE — control plane for Hello Agent (manager-facing edition)
   Sections: Overview · Connectors · Workflows · Work Done by Agent
   Audience: business managers. Technical detail lives inside collapsible
   "Advanced details" / "Technical trace" sections, never upfront.

   Data policy: the frontend talks to the backend API configured by
   VITE_API_BASE_URL. If the backend is unavailable, the dashboard falls back
   to an anonymised, clearly labelled reference dataset from documented agent runs.
   ========================================================================== */

/* ----------------------------- configuration ----------------------------- */

const CONFIG = {
  PROXY_BASE: (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, ""),
  FLOW_ID: "50ef3478-588d-493b-b8df-2c1676d6f09f", // shown only inside technical sections
  // Display-only references for Advanced details sections:
  LANGFLOW_BASE: "https://agent-builder.nhtech.link",
  FRAPPE_BASE: "https://erpnext-olp-ofw.m.frappe.cloud",
  CAD_ENDPOINT: "https://image-analysis-eliw.onrender.com/analyze-floorplan",
  HIGH_LATENCY_MS: 60000,
};

/* --------------------------------- styles -------------------------------- */

const STYLES = `
:root { color-scheme: light; }
.syn-root {
  --bg: #f4f6f9;
  --surface: #ffffff;
  --surface-2: #f8fafc;
  --line: #dfe6ee;
  --line-strong: #c9d4e0;
  --ink: #101b2c;
  --ink-2: #43536a;
  --muted: #6d7d92;
  --accent: #1e5eea;
  --accent-soft: #e8effd;
  --accent-ink: #1a4fc4;
  --ok: #0e8f63;
  --ok-soft: #e2f5ec;
  --err: #cc4343;
  --err-soft: #fbeaea;
  --warn: #b3730f;
  --warn-soft: #fcf1dd;
  --cad: #0c8a86;
  --cad-soft: #ddf3f1;
  --erp: #1e5eea;
  --erp-soft: #e8effd;
  --demo: #7a5cd6;
  --demo-soft: #efe9fb;
  --shadow: 0 1px 2px rgba(16,27,44,.05), 0 4px 14px rgba(16,27,44,.05);
  --shadow-lg: 0 8px 30px rgba(16,27,44,.14);
  --mono: ui-monospace, "SFMono-Regular", "Menlo", "Consolas", monospace;
  --sans: "Inter", -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
.syn-root.dark {
  color-scheme: dark;
  --bg: #0b1220;
  --surface: #121b2d;
  --surface-2: #16213699;
  --line: #223048;
  --line-strong: #31425e;
  --ink: #e7edf6;
  --ink-2: #b3c1d4;
  --muted: #7c8ca3;
  --accent: #4d82ff;
  --accent-soft: #1a2a4d;
  --accent-ink: #8db0ff;
  --ok: #35b789;
  --ok-soft: #123227;
  --err: #e06c6c;
  --err-soft: #3a1d1d;
  --warn: #d99a3d;
  --warn-soft: #362a13;
  --cad: #35b3ae;
  --cad-soft: #10302f;
  --erp: #4d82ff;
  --erp-soft: #1a2a4d;
  --demo: #a78bfa;
  --demo-soft: #261d40;
  --shadow: 0 1px 2px rgba(0,0,0,.35), 0 6px 18px rgba(0,0,0,.28);
  --shadow-lg: 0 14px 40px rgba(0,0,0,.5);
}
.syn-root {
  font-family: var(--sans);
  background: var(--bg);
  color: var(--ink);
  min-height: 100svh;
  width: 100%;
  display: flex;
  align-items: stretch;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.syn-root * { box-sizing: border-box; }
.syn-root ::selection { background: var(--accent-soft); }

/* sidebar */
.syn-side {
  width: 264px; flex-shrink: 0; background: var(--surface);
  border-right: 1px solid var(--line); position: sticky; top: 0; height: 100svh;
  display: flex; flex-direction: column; z-index: 30;
}
.syn-logo { display:flex; align-items:center; gap:12px; padding: 22px 20px 18px; }
.syn-logo-mark {
  width: 34px; height: 34px; border-radius: 9px; flex-shrink:0;
  background: linear-gradient(135deg, var(--accent), #6d5ce6);
  display:flex; align-items:center; justify-content:center;
}
.syn-logo-name { font-weight: 700; font-size: 16px; letter-spacing: -.01em; }
.syn-logo-sub { font-size: 11px; line-height: 1.25; color: var(--muted); letter-spacing:.02em; margin-top:-1px; max-width: 170px; }
.syn-navsec { padding: 10px 18px 6px; font-size: 10.5px; font-weight:600; letter-spacing:.09em; text-transform: uppercase; color: var(--muted); }
.syn-nav { padding: 0 12px; display:flex; flex-direction:column; gap:4px; }
.syn-nav button {
  display:flex; align-items:center; gap:10px; width:100%; text-align:left;
  min-height: 42px; padding: 10px 12px; border-radius: 8px; border:none; background:transparent;
  color: var(--ink-2); font: inherit; font-weight:500; cursor:pointer; font-size:14px;
}
.syn-nav button svg { flex-shrink: 0; }
.syn-nav button:hover { background: var(--surface-2); color: var(--ink); }
.syn-nav button.active { background: var(--accent-soft); color: var(--accent-ink); font-weight:600; }
.syn-nav button:focus-visible, .syn-root button:focus-visible, .syn-root input:focus-visible,
.syn-root select:focus-visible, .syn-root textarea:focus-visible, .syn-root summary:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 1px;
}
.syn-side-foot { margin-top:auto; padding: 16px 20px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--muted); }

/* topbar + main */
.syn-main { flex:1; min-width:0; display:flex; flex-direction:column; min-height: 100svh; }
.syn-top {
  min-height: 58px; background: var(--surface); border-bottom: 1px solid var(--line);
  display:flex; align-items:center; gap:12px; padding: 0 clamp(20px, 2.2vw, 40px); position: sticky; top:0; z-index:20;
}
.syn-top-title { font-weight: 650; font-size: 14.5px; }
.syn-top-crumb { color: var(--muted); font-size: 12.5px; }
.syn-top-right { margin-left:auto; display:flex; align-items:center; gap:10px; }
.syn-content {
  flex: 1;
  width: 100%;
  max-width: none;
  margin: 0;
  padding: clamp(24px, 2.6vw, 44px) clamp(24px, 3vw, 56px) 56px;
}

/* generic */
.syn-h1 { font-size: 19px; font-weight: 700; letter-spacing:-.01em; margin: 0 0 4px; }
.syn-sub { color: var(--muted); font-size: 13px; margin: 0 0 18px; }
.syn-card {
  background: var(--surface); border: 1px solid var(--line); border-radius: 12px;
  box-shadow: var(--shadow); padding: 18px;
}
.syn-grid { display:grid; gap: 14px; }
.syn-label { font-size: 10.5px; font-weight: 600; letter-spacing:.08em; text-transform:uppercase; color: var(--muted); }
.syn-mono { font-family: var(--mono); }
.syn-btn {
  border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink);
  border-radius: 8px; padding: 7px 13px; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
  display:inline-flex; align-items:center; gap:6px;
}
.syn-btn:hover { background: var(--surface-2); }
.syn-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight:600; }
.syn-btn.primary:hover { filter: brightness(1.06); }
.syn-btn:disabled { opacity:.55; cursor:not-allowed; }
.syn-chip {
  display:inline-flex; align-items:center; gap:5px; padding: 2px 9px; border-radius: 999px;
  font-size: 11.5px; font-weight: 600; white-space: nowrap;
}
.syn-dot { width:6px; height:6px; border-radius:999px; background: currentColor; flex-shrink:0; }
.chip-ok { background: var(--ok-soft); color: var(--ok); }
.chip-err { background: var(--err-soft); color: var(--err); }
.chip-warn { background: var(--warn-soft); color: var(--warn); }
.chip-erp { background: var(--erp-soft); color: var(--erp); }
.chip-cad { background: var(--cad-soft); color: var(--cad); }
.chip-demo { background: var(--demo-soft); color: var(--demo); }
.chip-neutral { background: var(--surface-2); color: var(--ink-2); border:1px solid var(--line); }
.syn-login-message {
  border-radius: 9px; padding: 9px 11px; font-size: 12.5px; margin-bottom: 13px;
  border: 1px solid var(--line);
}
.syn-login-message.err { background: var(--err-soft); color: var(--err); border-color: var(--err-soft); }

/* metric cards */
.syn-metrics { display:grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 14px; align-items: stretch; }
.syn-metric { background: var(--surface); border:1px solid var(--line); border-radius: 12px; padding: 18px 18px 16px; box-shadow: var(--shadow); min-width:0; min-height: 128px; display:flex; flex-direction:column; justify-content:center; }
.syn-metric .v { font-size: clamp(24px, 1.7vw, 30px); line-height:1.1; font-weight: 700; letter-spacing:-.02em; margin-top:7px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.syn-metric .s { font-size: 12px; line-height:1.35; color: var(--muted); margin-top: 7px; }
.syn-metric.tone-ok .v { color: var(--ok); }
.syn-metric.tone-err .v { color: var(--err); }
.syn-metric.tone-accent .v { color: var(--accent-ink); }

/* pipeline (inside advanced details only) */
.syn-pipe { display:flex; align-items:stretch; gap:0; overflow-x:auto; padding: 6px 2px 10px; }
.syn-pipe-node {
  min-width: 130px; flex:1; background: var(--surface-2); border:1px solid var(--line);
  border-radius: 10px; padding: 10px 12px; position:relative;
}
.syn-pipe-node .t { font-weight: 600; font-size: 12.5px; }
.syn-pipe-node .d { font-size: 10.5px; color: var(--muted); margin-top:2px; }
.syn-pipe-node.hot { border-color: var(--accent); background: var(--accent-soft); }
.syn-pipe-link { width: 34px; flex-shrink:0; display:flex; align-items:center; justify-content:center; }
.syn-pipe-link svg { display:block; }
.syn-pipe-dash { stroke: var(--line-strong); stroke-width: 2; stroke-dasharray: 4 4; animation: syn-flow 1.2s linear infinite; }
@keyframes syn-flow { to { stroke-dashoffset: -16; } }
@media (prefers-reduced-motion: reduce) { .syn-pipe-dash { animation: none; } }

/* table */
.syn-tablewrap { border:1px solid var(--line); border-radius: 12px; overflow:hidden; background: var(--surface); box-shadow: var(--shadow); }
.syn-tablescroll { overflow-x:auto; }
table.syn-table { width:100%; border-collapse: collapse; font-size: 13px; min-width: 720px; }
.syn-table th {
  text-align:left; font-size: 10.5px; letter-spacing:.07em; text-transform:uppercase; color: var(--muted);
  font-weight:600; padding: 9px 12px; border-bottom: 1px solid var(--line); background: var(--surface-2);
  white-space: nowrap;
}
.syn-table td { padding: 11px 12px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.syn-table tbody tr { cursor:pointer; }
.syn-table tbody tr:hover { background: var(--surface-2); }
.syn-table tbody tr:last-child td { border-bottom: none; }
.td-ellip { max-width: min(58vw, 760px); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* filters */
.syn-filters { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom: 12px; }
.syn-seg { display:inline-flex; background: var(--surface); border:1px solid var(--line-strong); border-radius: 9px; padding:2px; gap:2px; }
.syn-seg button { border:none; background:transparent; color: var(--ink-2); font:inherit; font-size:12.5px; font-weight:500; padding: 5px 11px; border-radius: 7px; cursor:pointer; }
.syn-seg button.active { background: var(--accent); color:#fff; font-weight:600; }
.syn-search { position:relative; flex:1; min-width: 200px; max-width: 340px; }
.syn-search input {
  width:100%; padding: 7px 12px 7px 32px; border-radius: 9px; border:1px solid var(--line-strong);
  background: var(--surface); color: var(--ink); font:inherit; font-size: 13px;
}
.syn-search svg { position:absolute; left:10px; top:50%; transform: translateY(-50%); color: var(--muted); }

/* drawer */
.syn-scrim { position: fixed; inset:0; background: rgba(10,16,28,.45); z-index: 60; }
.syn-drawer {
  position: fixed; top:0; right:0; height:100vh; width: min(600px, 100vw); z-index: 70;
  background: var(--surface); border-left:1px solid var(--line); box-shadow: var(--shadow-lg);
  display:flex; flex-direction:column; animation: syn-slide .18s ease-out;
}
@keyframes syn-slide { from { transform: translateX(24px); opacity:0; } to { transform:none; opacity:1; } }
@media (prefers-reduced-motion: reduce) { .syn-drawer, .syn-modal { animation: none !important; } }
.syn-drawer-head { padding: 16px 20px; border-bottom:1px solid var(--line); display:flex; align-items:flex-start; gap:12px; }
.syn-drawer-body { overflow-y:auto; padding: 18px 20px 40px; flex:1; }
.syn-kv { display:grid; grid-template-columns: 165px 1fr; gap: 7px 14px; font-size: 13px; }
.syn-kv .k { color: var(--muted); }
.syn-kv .v { min-width:0; overflow-wrap:anywhere; }
.syn-block { background: var(--surface-2); border:1px solid var(--line); border-radius: 10px; padding: 11px 13px; font-size: 12.5px; white-space: pre-wrap; overflow-wrap:anywhere; max-height: 240px; overflow-y:auto; }
.syn-json {
  margin: 0;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 14px;
  font-size: 12px;
  line-height: 1.55;
  overflow: auto;
  max-height: 320px;
  white-space: pre;
  font-family: var(--mono);
}
.syn-sec { margin-top: 18px; }
.syn-sec > .syn-label { display:block; margin-bottom: 7px; }

/* timeline */
.syn-tl { position:relative; padding-left: 22px; display:flex; flex-direction:column; gap: 13px; }
.syn-tl::before { content:""; position:absolute; left:7px; top:6px; bottom:6px; width:2px; background: var(--line); border-radius:2px; }
.syn-tl-item { position:relative; }
.syn-tl-item::before {
  content:""; position:absolute; left:-21px; top:4px; width:12px; height:12px; border-radius:999px;
  background: var(--surface); border: 3px solid var(--accent);
}
.syn-tl-item.err::before { border-color: var(--err); }
.syn-tl-item.done::before { border-color: var(--ok); }
.syn-tl-title { font-weight: 600; font-size: 13px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.syn-tl-meta { font-size: 11.5px; color: var(--muted); font-family: var(--mono); }

/* cards */
.syn-conn-head { display:flex; align-items:flex-start; gap:12px; margin-bottom: 10px; }
.syn-conn-icon {
  width: 38px; height:38px; border-radius: 9px; display:flex; align-items:center; justify-content:center;
  flex-shrink:0; font-weight:700; font-size:14px;
}
.syn-conn-name { font-weight: 650; font-size: 14.5px; }
.syn-conn-type { font-size: 12px; color: var(--muted); }
.syn-taglist { display:flex; flex-wrap:wrap; gap:6px; }
.syn-tag { background: var(--surface-2); border:1px solid var(--line); color: var(--ink-2); border-radius: 6px; padding: 2px 8px; font-size: 11.5px; }
.syn-note { border-left: 3px solid var(--warn); background: var(--warn-soft); color: var(--ink); border-radius: 0 8px 8px 0; padding: 9px 12px; font-size: 12.5px; }
.syn-hr { border:none; border-top:1px solid var(--line); margin: 13px 0; }
.syn-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.syn-page-head { gap: 16px; margin-bottom: 18px; }
.syn-page-head > div:first-child { min-width: 260px; }
.syn-page-head .syn-btn.primary { margin-left: auto; }
.syn-overview-how { margin-top: 18px; text-align: center; }
.syn-overview-how p { max-width: 960px; margin-inline: auto !important; }
.syn-banner {
  display:flex; gap:10px; align-items:center; border:1px solid var(--line); border-left: 3px solid var(--demo);
  background: var(--surface); border-radius: 0 10px 10px 0; padding: 11px 14px; font-size: 13px; margin-bottom: 16px;
}

/* collapsible advanced details */
details.syn-details { border:1px solid var(--line); border-radius: 10px; background: var(--surface-2); margin-top: 12px; }
details.syn-details > summary {
  cursor: pointer; list-style: none; padding: 9px 13px; font-size: 12.5px; font-weight: 600;
  color: var(--ink-2); display:flex; align-items:center; gap:8px; user-select:none;
}
details.syn-details > summary::-webkit-details-marker { display:none; }
details.syn-details > summary::before {
  content:""; width:7px; height:7px; border-right:2px solid var(--muted); border-bottom:2px solid var(--muted);
  transform: rotate(-45deg); transition: transform .12s ease; flex-shrink:0; margin-left:2px;
}
details.syn-details[open] > summary::before { transform: rotate(45deg); }
details.syn-details > .syn-details-body { padding: 4px 13px 13px; border-top:1px dashed var(--line); font-size: 12.5px; }

/* modal */
.syn-modal {
  position: fixed; z-index: 80; inset: 0; display:flex; align-items:center; justify-content:center; padding: 18px;
}
.syn-modal-card {
  background: var(--surface); border:1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow-lg);
  width: min(520px, 100%); max-height: 90vh; overflow-y:auto; padding: 20px 22px; animation: syn-pop .16s ease-out;
}
@keyframes syn-pop { from { transform: translateY(8px); opacity: 0; } to { transform:none; opacity:1; } }
.syn-field { margin-bottom: 13px; }
.syn-field label { display:block; font-size: 12.5px; font-weight: 600; color: var(--ink-2); margin-bottom: 5px; }
.syn-field input, .syn-field select, .syn-field textarea {
  width:100%; padding: 8px 11px; border-radius: 9px; border:1px solid var(--line-strong);
  background: var(--surface); color: var(--ink); font:inherit; font-size: 13.5px;
}
.syn-field textarea { min-height: 84px; resize: vertical; }
.syn-success { text-align:center; padding: 26px 10px; }
.syn-success .ic {
  width: 46px; height: 46px; border-radius: 999px; background: var(--ok-soft); color: var(--ok);
  display:flex; align-items:center; justify-content:center; margin: 0 auto 12px;
}

/* responsive */
.syn-menu-btn { display:none; }
@media (min-width: 1700px) {
  .syn-metrics { grid-template-columns: repeat(6, minmax(0, 1fr)); }
}
@media (max-width: 1279px) {
  .syn-side { width: 248px; }
  .syn-content { padding-inline: 24px; }
  .syn-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 1100px) {
  .syn-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 900px) {
  .syn-side { position: fixed; left:0; transform: translateX(-100%); transition: transform .18s ease; box-shadow: var(--shadow-lg); }
  .syn-side.open { transform: none; }
  .syn-menu-btn { display:inline-flex; }
  .syn-content { padding: 16px 14px 40px; }
  .syn-kv { grid-template-columns: 130px 1fr; }
  .syn-page-head { align-items: stretch !important; }
  .syn-page-head > div:first-child { min-width: 0; }
  .syn-page-head .syn-btn.primary { width: 100%; justify-content: center; margin-left: 0; }
  .syn-overview-how { text-align: left; }
}
@media (max-width: 640px) {
  .syn-root { font-size: 13.5px; }
  .syn-top { min-height: 54px; padding-inline: 12px; }
  .syn-top-crumb { display:none; }
  .syn-content { padding: 14px 12px 32px; }
  .syn-card { padding: 14px; }
  .syn-metrics { grid-template-columns: 1fr; gap: 10px; }
  .syn-metric { min-height: 108px; padding: 15px; }
  .syn-banner { align-items: flex-start; flex-direction: column; }
  .syn-kv { grid-template-columns: 1fr; gap: 3px 0; }
}
`;

async function submitRequest(kind, fields, agentId = "all") {
  const headers = { "Content-Type": "application/json" };
  try {
    const token = localStorage.getItem("synapse_token");
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch (e) {}

  const res = await fetch(`${CONFIG.PROXY_BASE}/api/requests`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      kind,
      fields,
      agent_id: agentId || "all",
    }),
  });

  if (!res.ok) {
    let message = "Failed to send request";
    try {
      const json = await res.json();
      message = json?.detail || json?.message || message;
    } catch {
      message = `Failed to send request (${res.status})`;
    }
    throw new Error(message);
  }

  return res.json();
}

/* ------------------------------ trace parsing ----------------------------- */

/* Single-agent dashboard. Tool names are still parsed so reference trace data
   never breaks, but live traces may also be direct single-step runs. */
const FOCUS_WORKFLOW = "Financial News Intelligence";
const FOCUS_AGENT = "Financial News Intelligence Agent";
const FOCUS_CONNECTOR = "News and Portfolio Intelligence Source";

const TOOL_TO_WORKFLOW = {
  call_cad_agent: FOCUS_WORKFLOW,
  call_erp_agent: "Other workflow", // parsed but never shown in this demo
};
const TOOL_TO_AGENT = {
  call_cad_agent: FOCUS_AGENT,
  call_erp_agent: "Other agent",
};
const WORKFLOW_TO_CONNECTOR = {
  [FOCUS_WORKFLOW]: FOCUS_CONNECTOR,
};

function getBlocks(trace) {
  try {
    const cbs = trace.output.message.data.content_blocks || [];
    return cbs.flatMap((b) => b.contents || []);
  } catch { return []; }
}

function getWorkflowFromTrace(trace) {
  const tool = getBlocks(trace).find((c) => c.type === "tool_use" && TOOL_TO_WORKFLOW[c.name]);
  return tool ? TOOL_TO_WORKFLOW[tool.name] : "Direct";
}

function getConnectorFromWorkflow(workflow) {
  return WORKFLOW_TO_CONNECTOR[workflow] || "—";
}

function getAgentNameFromTrace(trace) {
  const name = trace.name || trace.flowName || trace.flow_name;
  if (!name) return FOCUS_AGENT;
  const flowId = trace.flowId || trace.flow_id || CONFIG.FLOW_ID;
  return String(name).replace(` - ${flowId}`, "").trim();
}

function getTraceInputValue(trace) {
  const inputValue = trace.input && (trace.input.input_value || trace.input.value || trace.input.query);
  if (inputValue) return String(inputValue);
  const data = trace.input && trace.input.data;
  if (data && (data.input_value || data.value || data.query)) {
    return String(data.input_value || data.value || data.query);
  }
  return "";
}

function parseEmailMeta(trace) {
  const blocks = getBlocks(trace);
  const retrieved = blocks.find((c) => c.type === "tool_use" && c.name === "retrieve_email");
  const em = retrieved && retrieved.output && retrieved.output.email;
  let sender = em && (em.from || em.sender);
  let recipient = em && (em.to || em.recipient);
  let subject = em && em.subject;
  let body = em && (em.text || em.body);
  const inputBlock = blocks.find((c) => c.type === "text" && c.header && /input/i.test(c.header.title || ""));
  const inputText = inputBlock ? inputBlock.text : "";
  if (!sender) { const m = inputText.match(/From:\s*(.+)/i); sender = m && m[1].trim(); }
  if (!recipient) { const m = inputText.match(/To:\s*(.+)/i); recipient = m && m[1].trim(); }
  if (!subject) { const m = inputText.match(/Subject:\s*(.+)/i); subject = m && m[1].trim(); }
  return {
    sender: sender || "Unknown sender",
    recipient: recipient || "—",
    subject: subject || "(no subject)",
    body: body || "",
    inputText,
  };
}

function parseTraceToAgentRun(trace) {
  const blocks = getBlocks(trace);
  const workflow = getWorkflowFromTrace(trace);
  const connector = getConnectorFromWorkflow(workflow);
  const meta = parseEmailMeta(trace);
  const tools = blocks.filter((c) => c.type === "tool_use");
  const subTool = tools.find((c) => TOOL_TO_WORKFLOW[c.name]);
  const retrieveTool = tools.find((c) => c.name === "retrieve_email");
  const outBlock = blocks.find((c) => c.type === "text" && c.header && /output/i.test(c.header.title || ""));
  const data = (trace.output && trace.output.message && trace.output.message.data) || {};
  const usage = (data.properties && data.properties.usage) || {};
  const toolStatus = subTool && subTool.output ? subTool.output.status : undefined;
  const traceOk = (trace.status || "").toLowerCase() === "ok";
  const failed = !traceOk || toolStatus === "error";
  const outText = (outBlock && outBlock.text) || data.text || "";
  const query = getTraceInputValue(trace) || meta.body || meta.subject;
  const subMsg = (subTool && subTool.output && subTool.output.message) || "";
  const combined = `${subMsg} ${outText}`;
  const discrepancyFlagged = /discrepanc/i.test(combined);
  const confMatch = combined.match(/confidence[:\s]+["']?(high|medium|low)/i);
  const srcMatch = combined.match(/source_used[:\s]+["']?([a-z_]+)/i);
  const SOURCE_LABELS = { kb: "Knowledge base", visual_tool: "Drawing analysis", visual: "Drawing analysis" };
  return {
    id: trace.id,
    agentId: trace.agentId || trace.agent_id,
    agentLabel: trace.agentLabel || trace.agent_label || getAgentNameFromTrace(trace),
    startTime: trace.startTime,
    latencyMs: trace.totalLatencyMs || 0,
    tokens: trace.totalTokens || usage.total_tokens || 0,
    tokensIn: usage.input_tokens,
    tokensOut: usage.output_tokens,
    model: data.properties && data.properties.source && data.properties.source.source,
    status: failed ? "Failed" : "Completed",
    traceStatus: trace.status,
    toolStatus,
    workflow, connector,
    agent: subTool ? TOOL_TO_AGENT[subTool.name] : getAgentNameFromTrace(trace),
    sender: meta.sender, recipient: meta.recipient, subject: meta.subject,
    query,
    requestBody: meta.body,
    inputText: meta.inputText,
    retrieveTool, subTool,
    subSummary: subMsg,
    discrepancyFlagged,
    confidence: confMatch ? confMatch[1].charAt(0).toUpperCase() + confMatch[1].slice(1).toLowerCase() : null,
    source: srcMatch ? (SOURCE_LABELS[srcMatch[1].toLowerCase()] || srcMatch[1]) : null,
    finalText: outText.replace(/\n*Email sent successfully:\s*(yes|no)\s*$/i, "").trim(),
    highLatency: (trace.totalLatencyMs || 0) >= CONFIG.HIGH_LATENCY_MS,
    raw: trace,
  };
}

function calculateMetricsFromRuns(runs) {
  const ok = runs.filter((r) => r.status === "Completed");
  const failed = runs.filter((r) => r.status === "Failed");
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((s, r) => s + r.latencyMs, 0) / arr.length) : 0);
  const today = new Date().toDateString();
  const isToday = (r) => {
    const d = new Date(r.startTime && !String(r.startTime).endsWith("Z") && !String(r.startTime).includes("+") ? r.startTime + "Z" : r.startTime);
    return !isNaN(d) && d.toDateString() === today;
  };
  const latest = (arr) => (arr.length ? arr.reduce((a, b) => (new Date(a.startTime) > new Date(b.startTime) ? a : b)) : null);
  return {
    total: runs.length,
    successful: ok.length,
    failed: failed.length,
    completedToday: ok.filter(isToday).length,
    discrepancies: runs.filter((r) => r.discrepancyFlagged).length,
    avgLatencyMs: avg(runs),
    slowRuns: runs.filter((r) => r.highLatency).length,
    totalTokens: runs.reduce((s, r) => s + (r.tokens || 0), 0),
    lastRun: latest(runs),
    runs,
  };
}

function calculateDashboardMetrics(traces) {
  // The backend already filters traces to this dashboard's flow.
  return calculateMetricsFromRuns(traces.map(parseTraceToAgentRun));
}

/* -------------------------------- utilities ------------------------------- */

function getRunsForAgent(runs, agent) {
  if (!agent) return runs || [];
  return (runs || []).filter((run) =>
    run.agentId === agent.id || run.agentLabel === agent.label
  );
}

function getRecentQueriesForAgent(runs, agent, limit = 4) {
  const seen = new Set();
  return getRunsForAgent(runs, agent)
    .slice()
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
    .map((run) => (run.query || "").trim())
    .filter((query) => {
      if (!query || seen.has(query)) return false;
      seen.add(query);
      return true;
    })
    .slice(0, limit);
}

const fmtMs = (ms) => (ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
const fmtFriendly = (ms) => {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} seconds`;
  return `${Math.floor(s / 60)} min ${s % 60} sec`;
};
const fmtNum = (n) => (n == null ? "—" : n.toLocaleString());
const fmtTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(String(iso).endsWith("Z") || String(iso).includes("+") ? iso : iso + "Z");
  if (isNaN(d)) return String(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};
const fmtDateTime = fmtTime;
const safeJson = (value) => {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try { return JSON.parse(trimmed); } catch { return value; }
  }
  return value;
};
const normalizeText = (value) => String(value || "").trim() || "—";
const statusLabel = (value) => {
  const v = String(value || "").toUpperCase();
  if (v === "UNVERIFIABLE") return "Needs Review";
  return v || "—";
};
const jsonString = (value) => JSON.stringify(value, null, 2);
const complianceRowKey = (item) => {
  if (item?.id != null) return `id:${item.id}`;
  return [
    item?.treaty_audit_id || item?.audit_id || "",
    item?.action_timestamp || item?.created_at || "",
    item?.compliance_status || "",
    item?.verification_status || "",
    item?.email_id || "",
  ].join("|");
};

/* ----------------------------- small components ---------------------------- */

const Icon = ({ d, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d.map((p, i) => <path key={i} d={p} />)}
  </svg>
);
const ICONS = {
  overview: ["M3 12h5V3H3v9zM3 21h5v-5H3v5zM12 21h9v-9h-9v9zM12 3v5h9V3h-9z"],
  connectors: ["M9 17H7a5 5 0 0 1 0-10h2", "M15 7h2a5 5 0 0 1 0 10h-2", "M8 12h8"],
  workflows: ["M6 3v12", "M18 9v12", "M6 15a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3", "M3 6l3-3 3 3", "M15 18l3 3 3-3"],
  work: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  sun: ["M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z", "M12 1v2", "M12 21v2", "M4.22 4.22l1.42 1.42", "M18.36 18.36l1.42 1.42", "M1 12h2", "M21 12h2", "M4.22 19.78l1.42-1.42", "M18.36 5.64l1.42-1.42"],
  moon: ["M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.35-4.35"],
  close: ["M18 6L6 18", "M6 6l12 12"],
  refresh: ["M23 4v6h-6", "M1 20v-6h6", "M3.51 9a9 9 0 0 1 14.85-3.36L23 10", "M20.49 15a9 9 0 0 1-14.85 3.36L1 14"],
  menu: ["M3 6h18", "M3 12h18", "M3 18h18"],
  plus: ["M12 5v14", "M5 12h14"],
  check: ["M20 6L9 17l-5-5"],
  shield: ["M12 3l7 3v5c0 5-3.2 9.2-7 10-3.8-.8-7-5-7-10V6l7-3z", "M9.5 12l1.8 1.8L15.5 10"],
  alert: ["M12 9v4", "M12 17h.01", "M10.3 4.3l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-2.7l-8-14a2 2 0 0 0-3.4 0z"],
  document: ["M7 3h7l5 5v13H7z", "M14 3v5h5"],
  copy: ["M9 9h10v12H9z", "M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"],
  eye: ["M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z", "M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
};

function EnvBadge({ env }) {
  if (env === "live") return <span className="syn-chip chip-ok"><span className="syn-dot" />Live</span>;
  return <span className="syn-chip chip-demo"><span className="syn-dot" />Reference Data</span>;
}

function StatusChip({ status }) {
  if (status === "Completed") return <span className="syn-chip chip-ok"><span className="syn-dot" />Completed</span>;
  if (status === "Failed") return <span className="syn-chip chip-err"><span className="syn-dot" />Failed</span>;
  return <span className="syn-chip chip-neutral">{status}</span>;
}

function FlagChip({ flagged }) {
  return flagged
    ? <span className="syn-chip chip-warn"><span className="syn-dot" />Flagged</span>
    : <span className="syn-chip chip-neutral">None</span>;
}

function ComplianceStatusChip({ status }) {
  const v = String(status || "").toUpperCase();
  if (v === "COMPLIANT") return <span className="syn-chip chip-ok"><span className="syn-dot" />Compliant</span>;
  if (v === "VIOLATION") return <span className="syn-chip chip-err"><span className="syn-dot" />Violation</span>;
  if (v === "UNVERIFIABLE") return <span className="syn-chip chip-warn"><span className="syn-dot" />Needs Review</span>;
  return <span className="syn-chip chip-neutral">{statusLabel(v)}</span>;
}

function SeverityChip({ severity }) {
  const v = String(severity || "").toUpperCase();
  if (!v || v === "NONE") return <span className="syn-chip chip-neutral">None</span>;
  if (v === "LOW") return <span className="syn-chip chip-ok">Low</span>;
  if (v === "MEDIUM") return <span className="syn-chip chip-warn">Medium</span>;
  if (v === "HIGH" || v === "CRITICAL") return <span className="syn-chip chip-err">{v}</span>;
  return <span className="syn-chip chip-neutral">{v}</span>;
}

function Metric({ label, value, sub, tone }) {
  return (
    <div className={`syn-metric ${tone ? `tone-${tone}` : ""}`}>
      <div className="syn-label">{label}</div>
      <div className="v" title={String(value)}>{value}</div>
      {sub ? <div className="s">{sub}</div> : null}
    </div>
  );
}

function Advanced({ title = "Advanced details", children, mono = false }) {
  return (
    <details className="syn-details">
      <summary>{title}</summary>
      <div className={`syn-details-body ${mono ? "syn-mono" : ""}`}>{children}</div>
    </details>
  );
}

function PipeLink() {
  return (
    <div className="syn-pipe-link" aria-hidden="true">
      <svg width="34" height="12">
        <line x1="0" y1="6" x2="26" y2="6" className="syn-pipe-dash" />
        <path d="M25 2 L32 6 L25 10 Z" fill="var(--line-strong)" />
      </svg>
    </div>
  );
}

function Pipeline({ nodes }) {
  return (
    <div className="syn-pipe" role="img" aria-label={"System flow: " + nodes.map((n) => n.t).join(" to ")}>
      {nodes.map((n, i) => (
        <React.Fragment key={n.t}>
          <div className={`syn-pipe-node ${n.hot ? "hot" : ""}`}>
            <div className="t">{n.t}</div>
            <div className="d">{n.d}</div>
          </div>
          {i < nodes.length - 1 && <PipeLink />}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ------------------------------ request modal ------------------------------ */
function RequestModal({ title, intro, fields, submitLabel = "Submit request", successNote, onClose, kind, agentId, agents = [] }) {  const [values, setValues] = useState(() => {
    const v = {};
    fields.forEach((f) => { v[f.id] = f.default || ""; });
    return v;
  });
  const [state, setState] = useState("form"); // form | sending | done
  const [error, setError] = useState("");
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const missing = fields.filter((f) => f.required && !String(values[f.id]).trim());
  const submit = async () => {
    if (missing.length) return;
    setError("");
    setState("sending");
    try {
      await submitRequest(kind, values, agentId);
      setState("done");
    } catch (err) {
      setError(err.message || "Failed to send request");
      setState("form");
    }
  };
  return (
    <div className="syn-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="syn-scrim" onClick={onClose} style={{ zIndex: -1 }} />
      <div className="syn-modal-card">
        {state !== "done" ? (
          <>
            <div className="syn-row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>
              <button className="syn-btn" onClick={onClose} aria-label="Close" style={{ padding: "5px 8px" }}>
                <Icon d={ICONS.close} size={14} />
              </button>
            </div>
            {intro && <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--muted)" }}>{intro}</p>}
            {error && <div className="syn-login-message err">{error}</div>}
            {fields.map((f) => (
              <div className="syn-field" key={f.id}>
                <label htmlFor={`fld-${f.id}`}>{f.label}{f.required ? " *" : ""}</label>
                {f.type === "select" ? (
                  <select id={`fld-${f.id}`} value={values[f.id]} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })}>
                    {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea id={`fld-${f.id}`} value={values[f.id]} placeholder={f.placeholder || ""}
                    onChange={(e) => setValues({ ...values, [f.id]: e.target.value })} />
                ) : (
                  <input id={`fld-${f.id}`} type={f.type || "text"} value={values[f.id]} placeholder={f.placeholder || ""}
                    onChange={(e) => setValues({ ...values, [f.id]: e.target.value })} />
                )}
              </div>
            ))}
            <div className="syn-row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="syn-btn" onClick={onClose}>Cancel</button>
              <button className="syn-btn primary" onClick={submit} disabled={state === "sending" || missing.length > 0}
                title={missing.length ? `Please fill: ${missing.map((f) => f.label).join(", ")}` : undefined}>
                {state === "sending" ? "Sending…" : submitLabel}
              </button>
            </div>
          </>
        ) : (
          <div className="syn-success">
            <div className="ic"><Icon d={ICONS.check} size={22} /></div>
            <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 6 }}>Request received</div>
            <p style={{ margin: "0 0 4px", fontSize: 13.5, color: "var(--ink-2)" }}>
              Our team will review this and get back to you.
            </p>
            {successNote && <p style={{ margin: "0 0 4px", fontSize: 12.5, color: "var(--muted)" }}>{successNote}</p>}
            <button className="syn-btn primary" style={{ marginTop: 14 }} onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}


/* --------------------------------- drawer --------------------------------- */
/* Business-friendly by default; raw trace/tool detail lives inside the
   collapsed "Technical trace" section. */

function ExecutionDrawer({ run, onClose, isLive }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!run) return null;
  return (
    <>
      <div className="syn-scrim" onClick={onClose} />
      <aside className="syn-drawer" role="dialog" aria-modal="true" aria-label="Work item details">
        <div className="syn-drawer-head">
          <div style={{ minWidth: 0 }}>
            <div className="syn-row" style={{ marginBottom: 6 }}>
              <StatusChip status={run.status} />
              {run.discrepancyFlagged && <span className="syn-chip chip-warn"><span className="syn-dot" />Discrepancy flagged</span>}
              {!isLive && <span className="syn-chip chip-demo">Reference Data</span>}
            </div>
            <div style={{ fontWeight: 650, fontSize: 15, overflowWrap: "anywhere" }}>{run.query}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{fmtTime(run.startTime)}</div>
          </div>
          <button className="syn-btn" onClick={onClose} aria-label="Close details" style={{ marginLeft: "auto", padding: "6px 8px" }}>
            <Icon d={ICONS.close} />
          </button>
        </div>
        <div className="syn-drawer-body">
          <div className="syn-kv">
            <div className="k">Handled by</div><div className="v">{run.agentLabel || run.agent || "Agent"}</div>
            <div className="k">Time taken</div><div className="v">{fmtFriendly(run.latencyMs)}{run.highLatency ? " (slower than usual)" : ""}</div>
            {run.confidence && (<><div className="k">Confidence</div><div className="v">{run.confidence}</div></>)}
            {run.source && (<><div className="k">Answer source</div><div className="v">{run.source}</div></>)}
            <div className="k">Discrepancy flagged</div><div className="v"><FlagChip flagged={run.discrepancyFlagged} /></div>
          </div>

          <div className="syn-sec">
            <span className="syn-label">What was asked</span>
            <div className="syn-block">{run.query}</div>
          </div>

          {run.status === "Failed" && (
            <div className="syn-sec">
              <span className="syn-label">What went wrong</span>
              <div className="syn-block" style={{ borderColor: "var(--err)", background: "var(--err-soft)" }}>
                {(run.subTool && run.subTool.output && run.subTool.output.status === "error" && run.subTool.output.message) ||
                  "This run did not complete. The team can investigate using the technical trace below."}
              </div>
            </div>
          )}

          <div className="syn-sec">
            <span className="syn-label">What the agent answered</span>
            <div className="syn-block">{run.finalText || "—"}</div>
          </div>

          {run.discrepancyFlagged && (
            <div className="syn-sec">
              <span className="syn-label">Discrepancy details</span>
              <div className="syn-note">{run.subSummary || "The agent flagged a mismatch for review."}</div>
            </div>
          )}

          <Advanced title="Technical trace">
            <div className="syn-kv" style={{ gridTemplateColumns: "130px 1fr", marginTop: 8 }}>
              <div className="k">Trace ID</div><div className="v syn-mono" style={{ fontSize: 11.5 }}>{run.id}</div>
              <div className="k">Start time</div><div className="v syn-mono" style={{ fontSize: 11.5 }}>{run.startTime}</div>
              <div className="k">Total latency</div><div className="v syn-mono" style={{ fontSize: 11.5 }}>{fmtMs(run.latencyMs)}{run.highLatency ? " (high — likely service waking from idle)" : ""}</div>
              <div className="k">Tokens</div><div className="v syn-mono" style={{ fontSize: 11.5 }}>{fmtNum(run.tokens)}{run.tokensIn != null ? ` (${fmtNum(run.tokensIn)} in / ${fmtNum(run.tokensOut)} out)` : ""}</div>
              <div className="k">Trace status</div><div className="v syn-mono" style={{ fontSize: 11.5 }}>{run.traceStatus}</div>
              {run.toolStatus && (<><div className="k">Tool status</div><div className="v syn-mono" style={{ fontSize: 11.5 }}>{run.toolStatus}</div></>)}
              {run.model && (<><div className="k">Model</div><div className="v syn-mono" style={{ fontSize: 11.5 }}>{run.model}</div></>)}
              <div className="k">Agent tool</div><div className="v syn-mono" style={{ fontSize: 11.5 }}>{run.subTool ? run.subTool.name : "—"}</div>
              {run.subTool && (<><div className="k">Tool duration</div><div className="v syn-mono" style={{ fontSize: 11.5 }}>{fmtMs(run.subTool.duration)}</div></>)}
            </div>
            {run.subTool && (
              <div className="syn-sec">
                <span className="syn-label">Tool input</span>
                <div className="syn-block syn-mono" style={{ fontSize: 11 }}>{JSON.stringify(run.subTool.tool_input || {}, null, 2)}</div>
              </div>
            )}
            {run.subTool && run.subTool.output && (
              <div className="syn-sec">
                <span className="syn-label">Tool output</span>
                <div className="syn-block syn-mono" style={{ fontSize: 11 }}>{JSON.stringify(run.subTool.output, null, 2)}</div>
              </div>
            )}
            <div className="syn-sec">
              <span className="syn-label">Raw input (Langflow trace)</span>
              <div className="syn-block" style={{ fontSize: 11.5 }}>{run.query || run.inputText || "Not captured."}</div>
            </div>
          </Advanced>
        </div>
      </aside>
    </>
  );
}

/* ---------------------------------- pages --------------------------------- */

function OverviewPage({ metrics, onOpenRequest, selectedAgentId, agents }) {
  const m = metrics;
  const isAllAgents = selectedAgentId === "all";
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const selectedAgentLabel = selectedAgent?.label || "Selected agent";
  const agentValue = isAllAgents ? `All agents (${agents.length})` : selectedAgentLabel;
  const agentSub = isAllAgents ? "Combined view" : "Selected agent";
  const connectorSub = isAllAgents ? "All configured connectors" : `${selectedAgentLabel} connector`;
  const workflowSub = isAllAgents ? "All configured workflows" : `${selectedAgentLabel} workflow`;
  const overviewSubheading = isAllAgents ? "Your agents at a glance." : `Your ${selectedAgentLabel} at a glance.`;
  const howItWorksAgentText = isAllAgents ? "The selected agent" : `The ${selectedAgentLabel}`;
  return (
    <div>
      <div className="syn-row syn-page-head" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="syn-h1">Overview</h1>
          <p className="syn-sub">{overviewSubheading}</p>
        </div>
        <button className="syn-btn primary" onClick={onOpenRequest}>
          <Icon d={ICONS.plus} size={14} />Report Issue / Request Agent Change
        </button>
      </div>
      <div className="syn-metrics">
        <Metric label="Agent" value={agentValue} sub={agentSub} />
        <Metric label="Connector" value="Connected" tone="ok" sub={connectorSub} />
        <Metric label="Workflow" value="Active" tone="ok" sub={workflowSub} />
        <Metric label="Requests handled" value={fmtNum(m.total)} tone="accent" sub={`${fmtNum(m.completedToday)} today`} />
        <Metric label="Successful responses" value={fmtNum(m.successful)} tone="ok" sub="Answered in chat" />
        <Metric label="Issues detected" value={fmtNum(m.failed)} tone={m.failed ? "err" : "ok"} sub={m.failed ? "See Work Done by Agent" : "No open issues in view"} />
      </div>
      <div className="syn-card syn-overview-how">
        <div style={{ fontWeight: 650, fontSize: 14.5, marginBottom: 4 }}>How it works</div>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)" }}>
          Your team sends a request. <strong>{howItWorksAgentText}</strong> reads it,
          gathers what it needs, and returns an answer. Every request is recorded under{" "}
          <strong>Work Done by Agent</strong>.
        </p>
        <Advanced title="Advanced details — flow & technical stats">
          <div style={{ marginTop: 10 }}>
            <Pipeline nodes={[
              { t: "Incoming request", d: "Submitted by a user" },
              { t: "Agent", d: "Interprets the request", hot: true },
              { t: "Tools or sources", d: "Information gathered" },
              { t: "Reasoning step", d: "Context applied" },
              { t: "Response", d: "Answer returned" },
              { t: "Work log", d: "Run recorded" },
            ]} />
          </div>
          <div className="syn-kv" style={{ gridTemplateColumns: "190px 1fr", marginTop: 8 }}>
            <div className="k">Average response time</div><div className="v syn-mono">{fmtMs(m.avgLatencyMs)}</div>
            <div className="k">Slower runs (service idle)</div><div className="v syn-mono">{fmtNum(m.slowRuns)}</div>
            <div className="k">Items flagged</div><div className="v syn-mono">{fmtNum(m.discrepancies)}</div>
            <div className="k">Tokens used (in view)</div><div className="v syn-mono">{fmtNum(m.totalTokens)}</div>
            <div className="k">Last run</div><div className="v syn-mono">{m.lastRun ? fmtTime(m.lastRun.startTime) : "—"}</div>
            <div className="k">Execution log</div><div className="v syn-mono" style={{ fontSize: 11.5 }}>Langflow trace</div>
          </div>
        </Advanced>
      </div>
    </div>
  );
}

function ConnectorPage({ onOpenRequest, selectedAgentId, agents }) {
  const visibleAgents = selectedAgentId === "all"
    ? agents
    : agents.filter((agent) => agent.id === selectedAgentId);
  return (
    <div>
      <div>
        <h1 className="syn-h1">Connector</h1>
        <p className="syn-sub">The system your agent works with.</p>
      </div>
      <div className="syn-grid" style={{ gridTemplateColumns: "minmax(0, 560px)" }}>
        {visibleAgents.map((agent) => (
          <div className="syn-card" key={agent.id}>
            <div className="syn-conn-head">
              <div className="syn-conn-icon" style={{ background: "var(--cad-soft)", color: "var(--cad)" }}>FN</div>
              <div style={{ minWidth: 0 }}>
                <div className="syn-conn-name">{agent.label} connector</div>
                <div className="syn-conn-type">Used by {agent.label}</div>
              </div>
              <span className="syn-chip chip-ok" style={{ marginLeft: "auto" }}><span className="syn-dot" />Connected</span>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--ink-2)" }}>
              Provides the information or actions this agent needs to handle incoming requests.
            </p>
            <span className="syn-label">What it enables</span>
            <ul style={{ margin: "7px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--ink-2)", display: "flex", flexDirection: "column", gap: 4 }}>
              <li>Receive requests for {agent.label}</li>
              <li>Gather the context needed for a useful response</li>
              <li>Return an answer through the configured workflow</li>
              <li>Log outcomes and notable issues for review</li>
            </ul>
            <Advanced title="Advanced details">
              <div className="syn-kv" style={{ gridTemplateColumns: "110px 1fr", marginTop: 8 }}>
                <div className="k">Source</div><div className="v syn-mono" style={{ fontSize: 11.5 }}>{agent.label} configured source</div>
                <div className="k">Called by</div><div className="v syn-mono" style={{ fontSize: 11.5 }}>Langflow direct run</div>
                <div className="k">Scope</div><div className="v" style={{ fontSize: 12 }}>Requests handled by {agent.label}</div>
              </div>
              <div className="syn-note" style={{ marginTop: 10 }}>
                Some live sources may take longer to respond. Slower runs show as latency, not necessarily failure.
              </div>
            </Advanced>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 14 }}>
        Need the agent to work with another source or system? Use{" "}
        <button className="syn-btn" style={{ padding: "3px 10px", fontSize: 12 }} onClick={onOpenRequest}>Report Issue / Request Agent Change</button>
      </p>
    </div>
  );
}

function WorkflowPage({ metrics, onOpenRequest, selectedAgentId, agents }) {
  const m = metrics;
  const visibleAgents = selectedAgentId === "all"
    ? agents
    : agents.filter((agent) => agent.id === selectedAgentId);
  return (
    <div>
      <div className="syn-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="syn-h1">Workflow</h1>
          <p className="syn-sub">What your agent does end-to-end.</p>
        </div>
        <button className="syn-btn primary" onClick={onOpenRequest}>
          <Icon d={ICONS.plus} size={14} />Request Workflow Change
        </button>
      </div>
      <div className="syn-grid" style={{ gridTemplateColumns: "minmax(0, 640px)" }}>
        {visibleAgents.map((agent) => {
          const agentRuns = getRunsForAgent(m.runs, agent);
          const agentMetrics = calculateMetricsFromRuns(agentRuns);
          const exampleQueries = getRecentQueriesForAgent(m.runs, agent);
          return (
            <div className="syn-card" key={agent.id}>
              <div className="syn-row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                <div className="syn-conn-name">{agent.label} workflow</div>
                <span className="syn-chip chip-ok"><span className="syn-dot" />Active</span>
              </div>
              <div className="syn-kv" style={{ gridTemplateColumns: "95px 1fr", marginBottom: 10 }}>
                <div className="k">Agent</div><div className="v">{agent.label}</div>
                <div className="k">Connector</div><div className="v">{agent.label} connector</div>
                <div className="k">Trigger</div><div className="v">A team member sends a request to {agent.label}</div>
                <div className="k">Output</div><div className="v">The agent returns an answer using its configured workflow</div>
              </div>
              <span className="syn-label">Example requests</span>
              <div className="syn-taglist" style={{ marginTop: 7 }}>
                {exampleQueries.length > 0
                  ? exampleQueries.map((query) => (
                    <span key={query} className="syn-tag">{query}</span>
                  ))
                  : <span className="syn-tag">No recent requests in view</span>}
              </div>
              <Advanced title="Workflow statistics">
                <div className="syn-kv" style={{ gridTemplateColumns: "170px 1fr", marginTop: 8 }}>
                  <div className="k">Requests handled (in view)</div><div className="v syn-mono">{fmtNum(agentMetrics.total)}</div>
                  <div className="k">Successful responses</div><div className="v syn-mono">{fmtNum(agentMetrics.successful)}</div>
                  <div className="k">Issues</div><div className="v syn-mono">{fmtNum(agentMetrics.failed)}</div>
                  <div className="k">Items flagged</div><div className="v syn-mono">{fmtNum(agentMetrics.discrepancies)}</div>
                  <div className="k">Average response time</div><div className="v syn-mono">{fmtMs(agentMetrics.avgLatencyMs)}</div>
                  <div className="k">Slower runs (service idle)</div><div className="v syn-mono">{fmtNum(agentMetrics.slowRuns)}</div>
                  <div className="k">Last run</div><div className="v syn-mono">{agentMetrics.lastRun ? fmtTime(agentMetrics.lastRun.startTime) : "—"}</div>
                </div>
                <p style={{ fontSize: 12, color: "var(--muted)", margin: "10px 0 0" }}>
                  Each run is executed as a Langflow trace, then logged with its response time, status, and any notable flags.
                </p>
              </Advanced>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkDonePage({ metrics, isLive, onRefresh, loading, pageInfo, onPageChange, showAgentColumn, selectedAgentId }) {
  const [statusFilter, setStatusFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const runs = metrics.runs;
  useEffect(() => { setSelected(null); }, [selectedAgentId]);
  const filtered = useMemo(() => {
    let out = runs.slice().sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    if (statusFilter === "Completed") out = out.filter((r) => r.status === "Completed");
    if (statusFilter === "Issues") out = out.filter((r) => r.status === "Failed" || r.discrepancyFlagged);
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((r) =>
        [r.query, r.finalText].some((f) => (f || "").toLowerCase().includes(q))
      );
    }
    return out;
  }, [runs, statusFilter, query]);
  return (
    <div>
      <div className="syn-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="syn-h1">Work Done by Agent</h1>
          <p className="syn-sub">Every request the agent has handled. Click a row for details.</p>
        </div>
        <button className="syn-btn" onClick={onRefresh} disabled={loading}>
          <Icon d={ICONS.refresh} size={14} />{loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <div className="syn-filters">
        <div className="syn-seg" role="tablist" aria-label="Filter by status">
          {["All", "Completed", "Issues"].map((f) => (
            <button key={f} className={statusFilter === f ? "active" : ""} onClick={() => setStatusFilter(f)}>{f}</button>
          ))}
        </div>
        <div className="syn-search">
          <Icon d={ICONS.search} size={14} />
          <input placeholder="Search requests…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search work items" />
        </div>
      </div>
      <div className="syn-tablewrap">
        <div className="syn-tablescroll">
          <table className="syn-table">
            <thead>
              <tr>
                <th>Time</th>{showAgentColumn && <th>Agent</th>}<th>Query</th><th>Status</th><th>Issue Flagged</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={showAgentColumn ? 5 : 4} style={{ textAlign: "center", padding: 28, color: "var(--muted)", cursor: "default" }}>
                  Nothing matches this view. Clear the search or choose "All".
                </td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id} onClick={() => setSelected(r)} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") setSelected(r); }}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtTime(r.startTime)}</td>
                  {showAgentColumn && <td style={{ whiteSpace: "nowrap" }}>{r.agentLabel || "—"}</td>}
                  <td className="td-ellip" title={r.query}>{r.query}</td>
                  <td><StatusChip status={r.status} /></td>
                  <td><FlagChip flagged={r.discrepancyFlagged} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="syn-row" style={{ justifyContent: "space-between", marginTop: 10 }}>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
          {`${fmtNum(filtered.length)} request${filtered.length === 1 ? "" : "s"} in view.`}
        </p>
        {isLive && pageInfo && pageInfo.pages > 1 && (
          <div className="syn-row">
            <button className="syn-btn" disabled={loading || pageInfo.page <= 1} onClick={() => onPageChange(pageInfo.page - 1)}>Previous</button>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>page {pageInfo.page} of {pageInfo.pages}</span>
            <button className="syn-btn" disabled={loading || pageInfo.page >= pageInfo.pages} onClick={() => onPageChange(pageInfo.page + 1)}>Next</button>
          </div>
        )}
      </div>
  {selected && <ExecutionDrawer run={selected} onClose={() => setSelected(null)} isLive={isLive} />}
  </div>
  );
}

function JsonPanel({ value, title = "Raw JSON" }) {
  const [copied, setCopied] = useState(false);
  const parsed = safeJson(value);
  const raw = typeof value === "string" ? value : jsonString(parsed ?? value);
  const text = typeof raw === "string" ? raw : jsonString(raw);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (e) {}
  };
  return (
    <details className="syn-details" open>
      <summary>{title}</summary>
      <div className="syn-details-body">
        <div className="syn-row" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
          <button className="syn-btn" onClick={copy}><Icon d={ICONS.copy} size={14} />{copied ? "Copied" : "Copy"}</button>
        </div>
        <pre className="syn-json">{text || "—"}</pre>
      </div>
    </details>
  );
}

function ComplianceDrawer({ item, detail, onClose, loading }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!item) return null;
  const row = detail || item;
  const timeline = row.timeline || [];
  const evidence = safeJson(row.evidence_json);
  const issues = safeJson(row.issues);
  const missingEvidence = safeJson(row.missing_evidence);
  const eventData = safeJson(row.event_data);
  return (
    <>
      <div className="syn-scrim" onClick={onClose} />
      <aside className="syn-drawer" role="dialog" aria-modal="true" aria-label="Compliance action details">
        <div className="syn-drawer-head">
          <div style={{ minWidth: 0 }}>
            <div className="syn-row" style={{ marginBottom: 6 }}>
              <ComplianceStatusChip status={row.compliance_status} />
              <SeverityChip severity={row.severity} />
              <span className="syn-chip chip-neutral">{normalizeText(row.verification_status)}</span>
            </div>
            <div style={{ fontWeight: 650, fontSize: 15, overflowWrap: "anywhere" }}>
              {normalizeText(row.action_type)} · {normalizeText(row.agent_name)}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{fmtDateTime(row.action_timestamp || row.created_at)}</div>
          </div>
          <button className="syn-btn" onClick={onClose} aria-label="Close details" style={{ marginLeft: "auto", padding: "6px 8px" }}>
            <Icon d={ICONS.close} />
          </button>
        </div>
        <div className="syn-drawer-body">
          {loading && <p style={{ color: "var(--muted)" }}>Loading…</p>}
          <div className="syn-kv">
            <div className="k">Audit ID</div><div className="v syn-mono">{normalizeText(row.audit_id || row.treaty_audit_id || row.id)}</div>
            <div className="k">Agent</div><div className="v">{normalizeText(row.agent_name)}</div>
            <div className="k">Action type</div><div className="v">{normalizeText(row.action_type)}</div>
            <div className="k">Action status</div><div className="v">{normalizeText(row.action_status)}</div>
            <div className="k">Timestamp</div><div className="v">{fmtDateTime(row.action_timestamp || row.created_at)}</div>
            <div className="k">Session ID</div><div className="v syn-mono">{normalizeText(row.session_id)}</div>
            <div className="k">Email ID</div><div className="v syn-mono">{normalizeText(row.email_id)}</div>
            <div className="k">Sender email</div><div className="v">{normalizeText(row.sender_email)}</div>
          </div>

          <div className="syn-sec">
            <span className="syn-label">Compliance decision</span>
            <div className="syn-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: 8 }}>
              <div className="syn-card" style={{ padding: 14 }}>
                <div className="syn-label">Status</div>
                <div style={{ marginTop: 8 }}><ComplianceStatusChip status={row.compliance_status} /></div>
              </div>
              <div className="syn-card" style={{ padding: 14 }}>
                <div className="syn-label">Severity</div>
                <div style={{ marginTop: 8 }}><SeverityChip severity={row.severity} /></div>
              </div>
              <div className="syn-card" style={{ padding: 14 }}>
                <div className="syn-label">Verification</div>
                <div style={{ marginTop: 8 }}>{normalizeText(row.verification_status)}</div>
              </div>
            </div>
            <div className="syn-kv" style={{ gridTemplateColumns: "150px 1fr", marginTop: 10 }}>
              <div className="k">Violation type</div><div className="v">{normalizeText(row.violation_type)}</div>
              <div className="k">Reason</div><div className="v">{normalizeText(row.reason)}</div>
              <div className="k">Policy ID</div><div className="v syn-mono">{normalizeText(row.policy_id)}</div>
              <div className="k">Policy version</div><div className="v syn-mono">{normalizeText(row.policy_version)}</div>
              <div className="k">Route</div><div className="v syn-mono">{normalizeText(row.route)}</div>
              <div className="k">Decision supported</div><div className="v">{row.decision_supported == null ? "—" : String(row.decision_supported)}</div>
            </div>
          </div>

          <div className="syn-sec">
            <span className="syn-label">Policy</span>
            <div className="syn-block" style={{ marginTop: 8 }}>
              <div><strong>Policy ID:</strong> {normalizeText(row.policy_id)}</div>
              <div><strong>Policy version:</strong> {normalizeText(row.policy_version)}</div>
              <div><strong>Relevant requirement:</strong> {normalizeText(row.reason || row.violation_type)}</div>
              <div><strong>Policy reference:</strong> {normalizeText(row.route)}</div>
            </div>
          </div>

          <div className="syn-sec">
            <span className="syn-label">Evidence</span>
            <div className="syn-block" style={{ marginTop: 8 }}>
              <div><strong>Evidence integrity:</strong> {normalizeText(row.evidence_integrity)}</div>
              <div><strong>Verification reason:</strong> {normalizeText(row.verification_reason)}</div>
              <div><strong>Issues:</strong> {issues ? jsonString(issues) : "—"}</div>
              <div><strong>Missing evidence:</strong> {missingEvidence ? jsonString(missingEvidence) : "—"}</div>
            </div>
          </div>

          <div className="syn-sec">
            <span className="syn-label">Evidence summary</span>
            <div className="syn-block" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
              {evidence ? (typeof evidence === "string" ? evidence : "Structured evidence available below.") : "Evidence unavailable for this action."}
            </div>
          </div>

          <JsonPanel title="Structured evidence" value={evidence} />
          <JsonPanel title="Raw JSON" value={row.evidence_json || row.event_data || row} />

          {timeline.length > 0 && (
            <div className="syn-sec">
              <span className="syn-label">Audit timeline</span>
              <div className="syn-tl" style={{ marginTop: 10 }}>
                {timeline.map((step, idx) => (
                  <div key={`${step.audit_id || idx}-${idx}`} className="syn-tl-item done">
                    <div className="syn-tl-title">
                      {normalizeText(step.event_type)}
                      <span className="syn-chip chip-neutral">{normalizeText(step.event_status)}</span>
                    </div>
                    <div className="syn-tl-meta">{fmtDateTime(step.created_at)} · {normalizeText(step.audit_id || step.email_id)}</div>
                    <div className="syn-block" style={{ marginTop: 7 }}>{typeof step.event_data === "string" ? step.event_data : jsonString(step.event_data || {})}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {eventData && (
            <div className="syn-sec">
              <span className="syn-label">Correlated event data</span>
              <div className="syn-block syn-mono" style={{ marginTop: 8 }}>{jsonString(eventData)}</div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function CompliancePage({ onRefreshSignal, selectedAgentId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ total_actions: 0, compliant: 0, violations: 0, unverifiable: 0, high_critical: 0 });
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [severityFilter, setSeverityFilter] = useState("ALL");
  const [actionTypeFilter, setActionTypeFilter] = useState("ALL");
  const [verificationFilter, setVerificationFilter] = useState("ALL");
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [fromTs, setFromTs] = useState("");
  const [toTs, setToTs] = useState("");
  const loadId = useRef(0);
  const detailRequestId = useRef(0);

  const load = useCallback(async (nextPage = 1) => {
    const id = loadId.current + 1;
    loadId.current = id;
    setLoading(true);
    const response = await fetchTreatyCompliance({
      page: nextPage,
      size: 20,
      q: query.trim(),
      compliance_status: statusFilter,
      severity: severityFilter,
      action_type: actionTypeFilter,
      verification_status: verificationFilter,
      from_ts: fromTs || undefined,
      to_ts: toTs || undefined,
    });
    if (id !== loadId.current) return;
    if (response?.source === "error") {
      setError(response.error || response.message || "Failed to load compliance data");
      setItems([]);
      setSummary({ total_actions: 0, compliant: 0, violations: 0, unverifiable: 0, high_critical: 0 });
      setPages(1);
    } else {
      setError("");
      setItems(response.items || []);
      setSummary(response.summary || { total_actions: 0, compliant: 0, violations: 0, unverifiable: 0, high_critical: 0 });
      setPages(response.pages || 1);
    }
    setPage(response.page || nextPage);
    setLoading(false);
  }, [actionTypeFilter, fromTs, query, severityFilter, statusFilter, toTs, verificationFilter]);

  useEffect(() => { load(1); }, [load, selectedAgentId, onRefreshSignal]);
  useEffect(() => { setSelected(null); setDetail(null); }, [selectedAgentId]);
  useEffect(() => {
    if (!selected) return;
    const requestId = detailRequestId.current + 1;
    detailRequestId.current = requestId;
    setDetail(null);
    setDetailLoading(true);
    fetchTreatyComplianceDetail(selected.id ?? selected.treaty_audit_id ?? selected.audit_id).then((result) => {
      if (requestId !== detailRequestId.current) return;
      setDetail(result);
      setDetailLoading(false);
    });
  }, [selected]);

  const filteredItems = useMemo(() => items, [items]);

  const refresh = () => load(page);
  return (
    <div>
      <div className="syn-row syn-page-head" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="syn-h1">Compliance</h1>
          <p className="syn-sub">Treaty compliance monitoring for comparison actions, evidence, and verification results.</p>
        </div>
        <button className="syn-btn" onClick={refresh} disabled={loading}>
          <Icon d={ICONS.refresh} size={14} />{loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <div className="syn-login-message err">{error}</div>}

      <div className="syn-metrics">
        <Metric label="Total Actions" value={summary.total_actions || 0} tone="accent" sub="Compliance records" />
        <Metric label="Compliant" value={summary.compliant || 0} tone="ok" sub="Actions that passed review" />
        <Metric label="Violations" value={summary.violations || 0} tone="err" sub="Actions that failed policy" />
        <Metric label="Needs Review" value={summary.unverifiable || 0} tone="warn" sub="Unverifiable results" />
        <Metric label="High / Critical Issues" value={summary.high_critical || 0} tone="err" sub="Escalation candidates" />
      </div>

      <div className="syn-filters">
        <div className="syn-search" style={{ maxWidth: 420 }}>
          <Icon d={ICONS.search} size={14} />
          <input placeholder="Search audit ID, session ID, email ID, sender, action, policy…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="syn-seg"><button className={statusFilter === "ALL" ? "active" : ""} onClick={() => setStatusFilter("ALL")}>All Status</button><button className={statusFilter === "COMPLIANT" ? "active" : ""} onClick={() => setStatusFilter("COMPLIANT")}>Compliant</button><button className={statusFilter === "VIOLATION" ? "active" : ""} onClick={() => setStatusFilter("VIOLATION")}>Violation</button><button className={statusFilter === "UNVERIFIABLE" ? "active" : ""} onClick={() => setStatusFilter("UNVERIFIABLE")}>Needs Review</button></div>
        <select className="syn-btn" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
          <option value="ALL">All severities</option><option>NONE</option><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option>
        </select>
        <select className="syn-btn" value={verificationFilter} onChange={(e) => setVerificationFilter(e.target.value)}>
          <option value="ALL">All verification</option><option>VERIFIED</option><option>UNVERIFIED</option><option>NEEDS_REVIEW</option>
        </select>
        <select className="syn-btn" value={actionTypeFilter} onChange={(e) => setActionTypeFilter(e.target.value)}>
          <option value="ALL">All action types</option>
          {Array.from(new Set(items.map((item) => item.action_type).filter(Boolean))).map((value) => <option key={value}>{value}</option>)}
        </select>
        <input className="syn-btn" type="date" value={fromTs} onChange={(e) => setFromTs(e.target.value)} />
        <input className="syn-btn" type="date" value={toTs} onChange={(e) => setToTs(e.target.value)} />
        <button className="syn-btn primary" onClick={() => load(1)} disabled={loading}>Apply</button>
      </div>

      <div className="syn-tablewrap">
        <div className="syn-tablescroll">
          <table className="syn-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Agent</th>
                <th>Timestamp</th>
                <th>Audit ID</th>
                <th>Session ID</th>
                <th>Email ID</th>
                <th>Status</th>
                <th>Severity</th>
                <th>Policy</th>
                <th>Verification</th>
              </tr>
            </thead>
            <tbody>
              {loading && filteredItems.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: "center", padding: 28, color: "var(--muted)", cursor: "default" }}>Loading compliance actions…</td></tr>
              )}
              {!loading && filteredItems.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: "center", padding: 28, color: "var(--muted)", cursor: "default" }}>No Treaty compliance actions found.</td></tr>
              )}
              {filteredItems.map((item) => (
                <tr key={complianceRowKey(item)} onClick={() => setSelected(item)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setSelected(item); }}>
                  <td className="td-ellip" title={item.action_type}>{normalizeText(item.action_type)}</td>
                  <td className="td-ellip" title={item.agent_name}>{normalizeText(item.agent_name)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(item.action_timestamp || item.created_at)}</td>
                  <td className="syn-mono td-ellip" title={item.audit_id || item.treaty_audit_id}>{normalizeText(item.audit_id || item.treaty_audit_id)}</td>
                  <td className="syn-mono td-ellip" title={item.session_id}>{normalizeText(item.session_id)}</td>
                  <td className="syn-mono td-ellip" title={item.email_id}>{normalizeText(item.email_id)}</td>
                  <td><ComplianceStatusChip status={item.compliance_status} /></td>
                  <td><SeverityChip severity={item.severity} /></td>
                  <td className="syn-mono td-ellip" title={item.policy_id}>{normalizeText(item.policy_id)}</td>
                  <td>{normalizeText(item.verification_status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="syn-row" style={{ justifyContent: "space-between", marginTop: 10 }}>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>{`${filteredItems.length} action${filteredItems.length === 1 ? "" : "s"} in view.`}</p>
        {pages > 1 && (
          <div className="syn-row">
            <button className="syn-btn" disabled={loading || page <= 1} onClick={() => load(page - 1)}>Previous</button>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>page {page} of {pages}</span>
            <button className="syn-btn" disabled={loading || page >= pages} onClick={() => load(page + 1)}>Next</button>
          </div>
        )}
      </div>

      {selected && <ComplianceDrawer item={selected} detail={detail} loading={detailLoading} onClose={() => setSelected(null)} />}
    </div>
  );
}

/* ---------------------------------- shell --------------------------------- */

const NAV = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "connector", label: "Connector", icon: "connectors" },
  { id: "workflow", label: "Workflow", icon: "workflows" },
  { id: "work", label: "Work Done by Agent", icon: "work" },
  { id: "compliance", label: "Compliance", icon: "shield" },
];

export default function SynapseDashboard({ onLogout, loggedInEmail = "" }) {
  const [dark, setDark] = useState(false);
  const [page, setPage] = useState("overview");
  const [sideOpen, setSideOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [traceResult, setTraceResult] = useState({ source: "reference", traces: [] });
  const [tracePage, setTracePage] = useState(1);
  const [agents, setAgents] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState("all");
  const [modal, setModal] = useState(null); // 'issue' | 'workflow' | null
  const loadRequestRef = useRef(0);

  const load = useCallback(async (pageNo = 1, agentId = "all") => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setLoading(true);
    setTraceResult((previous) => ({
      ...previous,
      traces: [],
      total: 0,
      page: pageNo,
      pages: 1,
    }));
    const tr = await fetchTraces(pageNo, 20, agentId, loggedInEmail);
    if (requestId !== loadRequestRef.current) return;
    setTraceResult(tr);
    setTracePage(tr.page || pageNo);
    setLoading(false);
  }, [loggedInEmail]);
  useEffect(() => {
    let active = true;
    fetchAgents(loggedInEmail).then((items) => {
      if (!active) return;
      setAgents(items);
      setSelectedAgentId((current) => {
        if (current !== "all") return current;
        if (items.length > 1) return items[0]?.id || "all";
        return "all";
      });
    });
    return () => { active = false; };
  }, [loggedInEmail]);
  useEffect(() => { load(1, selectedAgentId); }, [load, selectedAgentId]);

  const onAgentChange = (event) => {
    const nextAgentId = event.target.value || "all";
    setSelectedAgentId(nextAgentId);
    setTracePage(1);
  };

  const isLive = traceResult.source === "live";
  const metrics = useMemo(() => calculateDashboardMetrics(traceResult.traces || []), [traceResult]);
  const active = NAV.find((n) => n.id === page);
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const selectedAgentLabel = selectedAgent?.label || "Selected agent";
  const sidebarSubtitle = selectedAgentId === "all" ? "Multi-agent dashboard" : selectedAgentLabel;
  const workflowRequestIntro = selectedAgentId === "all"
    ? "Describe how one of these workflows should change or what it should also handle."
    : `Describe how the ${selectedAgentLabel} workflow should change or what it should also handle.`;

  const targetAgentOptions = ["General / not agent-specific", ...agents.map((a) => a.label)];
  const targetAgentDefault = selectedAgentId !== "all" && selectedAgent
    ? selectedAgent.label
    : "General / not agent-specific";

  return (
    <div className={`syn-root ${dark ? "dark" : ""}`}>
      <style>{STYLES}</style>
      <nav className={`syn-side ${sideOpen ? "open" : ""}`} aria-label="Main navigation">
        <div className="syn-logo">
          <div className="syn-logo-mark">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l4 4M14 14l4 4M18 6l-4 4M10 14l-4 4" /><circle cx="12" cy="12" r="2.2" fill="#fff" stroke="none" />
            </svg>
          </div>
          <div>
            <div className="syn-logo-name">Synapse</div>
            <div className="syn-logo-sub">{sidebarSubtitle}</div>
          </div>
        </div>
        <div className="syn-navsec">Menu</div>
        <div className="syn-nav">
          {NAV.map((n) => (
            <button key={n.id} className={page === n.id ? "active" : ""}
              onClick={() => { setPage(n.id); setSideOpen(false); }}>
              <Icon d={ICONS[n.icon]} size={16} />{n.label}
            </button>
          ))}
        </div>
        <div className="syn-side-foot">Synapse · powered by NightHack</div>
      </nav>
      {sideOpen && <div className="syn-scrim" style={{ zIndex: 25 }} onClick={() => setSideOpen(false)} />}
      <div className="syn-main">
        <header className="syn-top">
          <button className="syn-btn syn-menu-btn" aria-label="Open navigation" onClick={() => setSideOpen(true)}>
            <Icon d={ICONS.menu} size={16} />
          </button>
          <span className="syn-top-crumb">Synapse /</span>
          <span className="syn-top-title">{active ? active.label : ""}</span>
          <div className="syn-top-right">
            <EnvBadge env={isLive ? "live" : "reference"} />
            <select className="syn-btn" value={selectedAgentId} onChange={onAgentChange} aria-label="Select agent">
              <option value="all">All agents</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.label}</option>
              ))}
            </select>
            <button className="syn-btn" onClick={() => setDark((d) => !d)} aria-label="Toggle theme">
              <Icon d={dark ? ICONS.sun : ICONS.moon} size={15} />
            </button>
            <button className="syn-btn" onClick={async () => { try { await apiLogout(); } catch (e) {} if (onLogout) onLogout(); }} aria-label="Logout">
              Logout
            </button>
          </div>
        </header>
        <main className="syn-content">
          {!isLive && (
            <div className="syn-banner">
              <span className="syn-chip chip-demo" style={{ flexShrink: 0 }}><span className="syn-dot" />Reference Data</span>
              <span style={{ color: "var(--ink-2)" }}>
                Showing reference data from documented agent runs. Live connection can be added through a secure backend proxy.
              </span>
            </div>
          )}
          {loading && metrics.total === 0 ? (
            <p style={{ color: "var(--muted)" }}>Loading…</p>
          ) : (
            <>
              {page === "overview" && (
                <OverviewPage
                  metrics={metrics}
                  onOpenRequest={() => setModal("issue")}
                  selectedAgentId={selectedAgentId}
                  agents={agents}
                />
              )}
              {page === "connector" && (
                <ConnectorPage
                  onOpenRequest={() => setModal("issue")}
                  selectedAgentId={selectedAgentId}
                  agents={agents}
                />
              )}
              {page === "workflow" && (
                <WorkflowPage
                  metrics={metrics}
                  onOpenRequest={() => setModal("workflow")}
                  selectedAgentId={selectedAgentId}
                  agents={agents}
                />
              )}
              {page === "work" && (
                <WorkDonePage
                  metrics={metrics}
                  isLive={isLive}
                  onRefresh={() => load(tracePage, selectedAgentId)}
                  loading={loading}
                  pageInfo={{ page: tracePage, pages: traceResult.pages || 1, total: traceResult.total }}
                  onPageChange={(p) => load(p, selectedAgentId)}
                  showAgentColumn={selectedAgentId === "all"}
                  selectedAgentId={selectedAgentId}
                />
              )}
              {page === "compliance" && (
                <CompliancePage
                  selectedAgentId={selectedAgentId}
                />
              )}
            </>
          )}
        </main>
      </div>

      {modal === "issue" && (
        <RequestModal
          kind="issue_or_change"
          title="Report Issue / Request Agent Change"
          intro="Tell us what's wrong or what you'd like changed. No technical detail needed."
          onClose={() => setModal(null)}
          agentId={selectedAgentId}
          agents={agents}
          fields={[
            { id: "target_agent", label: "Which agent is this about?", type: "select", options: targetAgentOptions, default: targetAgentDefault, required: true },
            { id: "type", label: "Request type", type: "select", options: ["Report issue", "Request agent change"], default: "Report issue", required: true },
            { id: "description", label: "Description", type: "textarea", placeholder: "What happened, or what should change?", required: true },
            { id: "priority", label: "Priority", type: "select", options: ["Low", "Medium", "High"], default: "Medium", required: true },
            { id: "name", label: "Your name", required: true },
            { id: "email", label: "Your email", type: "email", placeholder: "you@company.com", required: true },
          ]}
        />
      )}
      {modal === "workflow" && (
        <RequestModal
          kind="workflow_change"
          title="Request Workflow Change"
          intro={workflowRequestIntro}
          onClose={() => setModal(null)}
          agentId={selectedAgentId}
          agents={agents}
          fields={[
            { id: "target_agent", label: "Which agent is this about?", type: "select", options: targetAgentOptions, default: targetAgentDefault, required: true },
            { id: "change", label: "Change requested", type: "textarea", placeholder: "e.g. Also answer questions about sector exposure", required: true },
            { id: "why", label: "Why is this needed?", type: "textarea", required: true },
            { id: "example", label: "Example query / request", type: "textarea", placeholder: "An example of the kind of question the agent should handle" },
            { id: "output", label: "Expected output", type: "textarea", placeholder: "What should the reply contain?" },
            { id: "email", label: "Your email", type: "email", placeholder: "you@company.com", required: true },
          ]}
        />
      )}
    </div>
  );
}
