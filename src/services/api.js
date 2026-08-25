/* Synapse dashboard API service
   - Reads backend base URL from VITE_API_BASE_URL.
   - Uses real backend endpoints if available.
   - Falls back to documented reference trace data when the backend is unavailable.
*/

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const REFERENCE_TOTAL_RUNS = 55;

const ANONYMIZE_REFERENCE_DATA = true;
const ANON_SENDER_MAP = {
  "shivanijoshi1330@gmail.com": "finance@demo-client.com",
  "shreya.p@nighthack.in": "ops@demo-client.com",
  "aditi.jha@nighthack.in": "projects@demo-client.com",
};
const anonSender = (addr) => ANONYMIZE_REFERENCE_DATA ? (ANON_SENDER_MAP[addr] || addr) : addr;

const FLOW_ID = "50ef3478-588d-493b-b8df-2c1676d6f09f";
const FLOW = FLOW_ID;

function refTrace({ id, at, status = "ok", tool, latency, tokensIn, tokensOut, email, retrieveMs = 450, subMs, subStatus = "success", subMessage, subError, finalText, sentLine = "Email sent successfully: yes" }) {
  const total = (tokensIn || 0) + (tokensOut || 0);
  const from = anonSender(email.from);
  return {
    id,
    name: `Dispatcher Agent - ${FLOW}`,
    status,
    startTime: at,
    totalLatencyMs: latency,
    totalTokens: total,
    flowId: FLOW,
    sessionId: FLOW,
    output: {
      message: {
        data: {
          text: finalText,
          timestamp: at.replace("T", " ").slice(0, 19) + " UTC",
          sender: "Machine",
          properties: {
            source: { display_name: "Agent", source: "gpt-5.4" },
            usage: { input_tokens: tokensIn, output_tokens: tokensOut, total_tokens: total },
          },
          content_blocks: [
            {
              title: "Agent Steps",
              contents: [
                {
                  type: "text",
                  header: { title: "Input" },
                  text: `A new email has been received. Email ID: ${email.emailId}\nFrom: ${from}\nSubject: ${email.subject}\n\nUse the Retrieve Received Email tool to fetch the full email before answering.`,
                },
                {
                  type: "tool_use",
                  name: "retrieve_email",
                  duration: retrieveMs,
                  tool_input: { email_id: email.emailId },
                  output: {
                    status: "success",
                    email: { from, to: email.to, subject: email.subject, text: email.body },
                  },
                },
                {
                  type: "tool_use",
                  name: tool,
                  duration: subMs != null ? subMs : Math.max(0, latency - retrieveMs - 1400),
                  tool_input: { email_id: email.emailId, sender_email: from, recipient_email: email.to, subject: email.subject, email_body: email.body },
                  output: subStatus === "success"
                    ? { status: "success", message: subMessage }
                    : { status: "error", message: subError },
                },
                {
                  type: "text",
                  header: { title: "Output" },
                  text: status === "ok" ? `${finalText}\n\n${sentLine}` : finalText,
                },
              ],
            },
          ],
        },
      },
    },
  };
}

const REFERENCE_TRACES = [
  refTrace({
    id: "c91f4b7a-2d3e-4f60-9a15-6e8b0c1d2f3a", at: "2026-07-09T10:08:41.132047", tool: "call_cad_agent",
    latency: 39017, tokensIn: 23487, tokensOut: 828, retrieveMs: 424, subMs: 30850,
    email: { emailId: "7f2a1c9e-11aa-4b3c-8d2e-90f1a2b3c4d5", from: "shivanijoshi1330@gmail.com", to: "agent@helloagent.nhtech.link", subject: "Floor plan summary", body: "Can you give me a summary of the Level 27 floor plan drawing?" },
    subMessage: "Answered from knowledge base (source_used: kb, confidence: high). Summary of the WSP Level 27 partition drawing returned and logged.",
    finalText: "Here is a summary of the WSP Level 27 partition drawing: office interior fit-out layout showing full- and partial-height partitions, the 27-xx room numbering scheme, and door/glazing schedule references.",
  }),
  refTrace({
    id: "d4028e1b-9c5f-4a71-b326-7f9c1d2e3a4b", at: "2026-07-09T10:03:44.201880", status: "error", tool: "call_cad_agent",
    latency: 34620, tokensIn: 19800, tokensOut: 310, subStatus: "error",
    email: { emailId: "b3c4d5e6-22bb-4c5d-9e3f-01a2b3c4d5e6", from: "shivanijoshi1330@gmail.com", to: "agent@helloagent.nhtech.link", subject: "Floor plan summary", body: "Can you summarise the Level 27 floor plan drawing?" },
    subError: "Upsert Drawing Query failed: the query-logging step returned a hard error from the database layer. The agent declined to send an email reply rather than respond without a logged record.",
    finalText: "Run failed while logging the drawing query. No email reply was sent — the agent declined to respond rather than respond without a logged record.",
    sentLine: "Email sent successfully: no",
  }),
  refTrace({
    id: "8ac84cde-4b42-4351-aafb-ff4a4ab1ad52", at: "2026-07-09T08:32:59.524324", tool: "call_erp_agent",
    latency: 25554, tokensIn: 21120, tokensOut: 953, retrieveMs: 469, subMs: 19752,
    email: { emailId: "18cb6636-a3d4-4442-b514-5643b1870502", from: "shivanijoshi1330@gmail.com", to: "agent@helloagent.nhtech.link", subject: "Create a sales invoice", body: "Customer ABC Pvt Ltd, Posting date 2026-07-09, Due date 2026-07-21, Item Keyboard qty 3 rate 1000, No taxes" },
    subMessage: "Done.",
    finalText: "Done.",
  }),
  refTrace({
    id: "e5139f2c-0d6a-4b82-c437-8a0d2e3f4b5c", at: "2026-07-09T08:26:02.118332", tool: "call_erp_agent",
    latency: 21600, tokensIn: 18450, tokensOut: 610,
    email: { emailId: "c4d5e6f7-33cc-4d6e-af40-12b3c4d5e6f7", from: "shivanijoshi1330@gmail.com", to: "agent@helloagent.nhtech.link", subject: "New sales invoice", body: "Please create a new sales invoice for NHT Pvt Ltd — item Keyboard, qty 3, rate 1000, no taxes." },
    subMessage: "Created Sales Invoice for NHT Pvt Ltd (item Keyboard, qty 3, rate 1000, no taxes).",
    finalText: "The sales invoice for NHT Pvt Ltd has been created — item Keyboard, quantity 3 at rate 1000, no taxes applied.",
  }),
  refTrace({
    id: "f6240a3d-1e7b-4c93-d548-9b1e3f4a5c6d", at: "2026-07-09T08:19:02.093214", tool: "call_cad_agent",
    latency: 86900, tokensIn: 22900, tokensOut: 780,
    email: { emailId: "d5e6f7a8-44dd-4e7f-b051-23c4d5e6f7a8", from: "shivanijoshi1330@gmail.com", to: "agent@helloagent.nhtech.link", subject: "Floor plan summary", body: "Summary of the Level 27 partition drawing please." },
    subMessage: "Analysis service was waking from idle — run completed successfully after 86.9s total. Structured summary returned and logged.",
    finalText: "Summary of the WSP Level 27 partition drawing returned. Note: this run took longer than usual because the analysis service was waking from idle.",
  }),
  refTrace({
    id: "07351b4e-2f8c-4da4-e659-0c2f4a5b6d7e", at: "2026-07-09T08:19:01.887401", tool: "call_erp_agent",
    latency: 23100, tokensIn: 16780, tokensOut: 520,
    email: { emailId: "e6f7a8b9-55ee-4f80-c162-34d5e6f7a8b9", from: "shreya.p@nighthack.in", to: "agent@helloagent.nhtech.link", subject: "Payment invoice — fetch SINV-26-00001", body: "Please fetch the details of Sales Invoice SINV-26-00001 — status, due date, and outstanding amount." },
    subMessage: "Fetched SINV-26-00001 (read-only lookup). Returned customer, posting date, due date, grand total, outstanding amount, status.",
    finalText: "Sales Invoice SINV-26-00001: details fetched, including due date, grand total, outstanding amount, and current status. Reply sent with the full record summary.",
  }),
  refTrace({
    id: "18462c5f-3a9d-4eb5-f760-1d3a5b6c7e8f", at: "2026-07-09T06:37:01.442190", tool: "call_cad_agent",
    latency: 77000, tokensIn: 22400, tokensOut: 745,
    email: { emailId: "f7a8b9c0-66ff-4091-d273-45e6f7a8b9c0", from: "shivanijoshi1330@gmail.com", to: "agent@helloagent.nhtech.link", subject: "Floor plan summary", body: "Could you summarise the floor plan drawing?" },
    subMessage: "Analysis service was waking from idle — completed successfully in 77.0s. Summary returned and logged.",
    finalText: "Floor plan summary returned for the WSP Level 27 partition drawing (slower response while the analysis service woke from idle).",
  }),
  refTrace({
    id: "29573d60-4bae-4fc6-a871-2e4b6c7d8f90", at: "2026-07-09T05:51:28.310577", tool: "call_erp_agent",
    latency: 26200, tokensIn: 17900, tokensOut: 640,
    email: { emailId: "a8b9c0d1-7700-41a2-e384-56f7a8b9c0d1", from: "aditi.jha@nighthack.in", to: "agent@helloagent.nhtech.link", subject: "Update due date, SINV-26-00001", body: "Please update the due date on Sales Invoice SINV-26-00001 to 2026-07-30." },
    subMessage: "Fetched SINV-26-00001, synced the payment schedule, and applied the due-date update.",
    finalText: "The due date on SINV-26-00001 has been updated to 30 Jul 2026. The invoice's payment schedule was synced so the finance system accepted the change.",
  }),
  refTrace({
    id: "3a684e71-5cbf-40d7-b982-3f5c7d8e9a01", at: "2026-07-09T05:42:05.664239", tool: "call_cad_agent",
    latency: 49000, tokensIn: 21300, tokensOut: 890,
    email: { emailId: "b9c0d1e2-8811-42b3-f495-67a8b9c0d1e2", from: "shreya.p@nighthack.in", to: "agent@helloagent.nhtech.link", subject: "Floor plan summary", body: "Summary of the Level 27 drawing — how many rooms are shown?" },
    subMessage: "Summary returned. Data check flagged: visual analysis counted 12 rooms vs 10 in the drawing schedule. Discrepancy note logged for review.",
    finalText: "Summary returned for the Level 27 drawing. Heads up: I counted 12 rooms visually but the drawing schedule lists 10 — a count discrepancy has been flagged and logged for review.",
  }),
  refTrace({
    id: "4b795f82-6dc0-41e8-ca93-406d8e9f0b12", at: "2026-07-09T05:05:00.129804", tool: "call_erp_agent",
    latency: 21800, tokensIn: 16500, tokensOut: 570,
    email: { emailId: "c0d1e2f3-9922-43c4-a5a6-78b9c0d1e2f3", from: "shreya.p@nighthack.in", to: "agent@helloagent.nhtech.link", subject: "Update ERP — due date, SINV-26-00004", body: "Change the due date on SINV-26-00004 to 2026-07-25." },
    subMessage: "Fetched SINV-26-00004, synced the payment schedule, update applied successfully.",
    finalText: "Done — SINV-26-00004 now has a due date of 25 Jul 2026, with its payment schedule synced to match.",
  }),
  refTrace({
    id: "5c8a6093-7ed1-42f9-db04-517e9f0a1c23", at: "2026-07-09T05:03:18.557462", tool: "call_erp_agent",
    latency: 63300, tokensIn: 19700, tokensOut: 720,
    email: { emailId: "d1e2f3a4-aa33-44d5-b6b7-89c0d1e2f3a4", from: "shreya.p@nighthack.in", to: "agent@helloagent.nhtech.link", subject: "Re: New Invoice — qty 3→4 on SINV-26-00005", body: "On SINV-26-00005, please change the item quantity from 3 to 4." },
    subMessage: "Located SINV-26-00005 from the reply thread, updated item qty 3 → 4, totals recalculated.",
    finalText: "SINV-26-00005 has been updated: item quantity changed from 3 to 4 and totals recalculated.",
  }),
];

function normalizeTrace(trace) {
  if (!trace || typeof trace !== "object") return trace;
  const normalized = { ...trace };
  if (normalized.start_time && normalized.startTime == null) normalized.startTime = normalized.start_time;
  if (normalized.total_latency_ms != null && normalized.totalLatencyMs == null) normalized.totalLatencyMs = normalized.total_latency_ms;
  if (normalized.total_tokens != null && normalized.totalTokens == null) normalized.totalTokens = normalized.total_tokens;
  if (normalized.session_id && normalized.sessionId == null) normalized.sessionId = normalized.session_id;
  if (normalized.flow_id && normalized.flowId == null) normalized.flowId = normalized.flow_id;
  if (normalized.output == null && trace.output != null) normalized.output = trace.output;
  return normalized;
}

function buildUrl(path) {
  const trimmedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${trimmedPath}`;
}

async function parseApiMessage(res) {
  try {
    const json = await res.json();
    return json?.message || json?.detail?.message || json?.detail || `API responded with ${res.status}`;
  } catch {
    return `API responded with ${res.status}`;
  }
}

function _authHeaders() {
  try {
    const token = localStorage.getItem("synapse_token");
    if (token) return { Authorization: `Bearer ${token}` };
  } catch (e) {
    // ignore
  }
  return {};
}

export async function fetchAgents(email = "") {
  if (!API_BASE_URL) return [];

  try {
    const params = new URLSearchParams();
    if (email) params.set("email", email);
    const query = params.toString();
    const url = query ? buildUrl(`/api/agents?${query}`) : buildUrl("/api/agents");
    const res = await fetch(url, { headers: _authHeaders() });
    if (!res.ok) throw new Error(`API responded with ${res.status}`);
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } catch (error) {
    console.error("[synapse api] fetchAgents failed:", error);
    return [];
  }
}

export async function login(email) {
  const res = await fetch(buildUrl("/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(await parseApiMessage(res));
  return res.json();
}

export async function signin(email, password) {
  return login(email);
}

export async function signup(email, password) {
  return login(email);
}

export async function logout() {
  try {
    const token = localStorage.getItem("synapse_token");
    await fetch(buildUrl("/api/auth/logout"), {
      method: "POST",
      headers: { ..._authHeaders(), "Content-Type": "application/json" },
    });
  } catch (e) {
    // ignore network errors
  }
  try { localStorage.removeItem("synapse_token"); } catch (e) {}
}

export async function fetchTraces(page = 1, size = 20, agentId = "all", email = "") {
  if (!API_BASE_URL) {
    return {
      source: "reference",
      traces: REFERENCE_TRACES,
      total: REFERENCE_TOTAL_RUNS,
      page: 1,
      pages: 1,
    };
  }

  try {
    const params = new URLSearchParams({
      page: String(page),
      size: String(size),
      agent_id: agentId || "all",
    });
    if (email) params.set("email", email);
    const url = buildUrl(`/api/traces?${params.toString()}`);
    const res = await fetch(url, { headers: _authHeaders() });
    if (!res.ok) throw new Error(`API responded with ${res.status}`);
    const json = await res.json();
    if (json?.source !== "live") {
      throw new Error(json?.error || "API returned fallback source");
    }

    const items = Array.isArray(json)
      ? json
      : json.items || json.traces || [];
    const traces = items.map(normalizeTrace);
    const total = Number(json.total ?? json.count ?? traces.length) || traces.length;
    const currentPage = Number(json.page ?? page) || page;
    const pages = Number(json.pages ?? json.total_pages ?? Math.max(1, Math.ceil(total / size))) || Math.max(1, Math.ceil(total / size));

    return {
      source: "live",
      traces,
      total,
      page: currentPage,
      pages,
    };
  } catch (error) {
    console.error("[synapse api] fetchTraces failed:", error);
    return {
      source: "reference",
      traces: REFERENCE_TRACES,
      total: REFERENCE_TOTAL_RUNS,
      page: 1,
      pages: 1,
      error,
    };
  }
}

export async function fetchTraceDetails(traceId, traces = [], agentId = "all") {
  const existing = (traces || []).find((t) => t.id === traceId);
  if (existing) return existing;
  if (!API_BASE_URL) return null;

  try {
    const params = new URLSearchParams({ agent_id: agentId || "all" });
    const res = await fetch(buildUrl(`/api/traces/${traceId}?${params.toString()}`), { headers: _authHeaders() });
    if (!res.ok) throw new Error(`API responded with ${res.status}`);
    const json = await res.json();
    return normalizeTrace(json);
  } catch (error) {
    console.error("[synapse api] fetchTraceDetails failed:", error);
    return null;
  }
}
