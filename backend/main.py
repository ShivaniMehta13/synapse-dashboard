"""
Synapse backend proxy (FastAPI)
--------------------------------
Sits between the dashboard frontend and Langflow's monitor traces API.
Langflow x-api-key values never reach the browser; they are attached here,
server-side, from environment variables.

NOTE: Langflow's `flow_id` query param on /api/v1/monitor/traces does NOT
reliably filter server-side (it can return traces from every flow in the
workspace). So this proxy pulls a wide batch and filters by each trace's
own `flowId` field itself, then paginates the filtered result.
"""

import math
import os
import re
from typing import Optional

import requests
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

try:
    from auth import router as auth_router
except ImportError:
    from backend.auth import router as auth_router

load_dotenv()

LANGFLOW_API_KEY = os.getenv("LANGFLOW_API_KEY", "")
LANGFLOW_BASE = os.getenv("LANGFLOW_BASE", "https://agent-builder.nhtech.link")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "http://localhost:5173")
FRONTEND_DOMAIN = os.getenv("FRONTEND_DOMAIN", "")

AGENTS = []
for key in os.environ:
    m = re.match(r"^FLOW_ID_(.+)$", key)
    if m:
        suffix = m.group(1)
        flow_id = os.getenv(f"FLOW_ID_{suffix}", "")
        api_key = os.getenv(f"API_KEY_{suffix}", LANGFLOW_API_KEY)
        if flow_id and api_key:
            AGENTS.append({
                "id": suffix.lower(),
                "label": os.getenv(f"AGENT_LABEL_{suffix}", suffix.replace("_", " ").title()),
                "flow_id": flow_id,
                "api_key": api_key,
                "tool_name": os.getenv(f"AGENT_TOOL_NAME_{suffix}", ""),
            })

KEY_CONFIGURED = bool(AGENTS)

allow_origin_regex = r"https://.*\.vercel\.app"
allow_origins = [origin for origin in [ALLOWED_ORIGIN, FRONTEND_DOMAIN] if origin]

app = FastAPI(title="Synapse backend proxy")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_origin_regex=allow_origin_regex,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(auth_router)


def _langflow_headers(api_key: str):
    return {
        "x-api-key": api_key,
        "Content-Type": "application/json",
    }


def _error_response(reason: str):
    return {
        "source": "error",
        "traces": [],
        "page": 1,
        "pages": 1,
        "total": 0,
        "error": reason,
    }


def _extract_traces(data):
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return []
    for key in ("traces", "items", "data", "results"):
        value = data.get(key)
        if isinstance(value, list):
            return value
    return []


def _trace_uses_agent_tool(trace, tool_name: str):
    if not tool_name:
        return True

    content_blocks = (
        trace.get("output", {})
        .get("message", {})
        .get("data", {})
        .get("content_blocks", [])
    )
    if not isinstance(content_blocks, list):
        return False

    for block in content_blocks:
        contents = block.get("contents", []) if isinstance(block, dict) else []
        if not isinstance(contents, list):
            continue
        for item in contents:
            if (
                isinstance(item, dict)
                and item.get("type") == "tool_use"
                and item.get("name") == tool_name
            ):
                return True
    return False


def _fetch_all_traces_for_flow(flow_id: str, api_key: str, tool_name: str):
    """
    Pull traces from Langflow and keep only the ones belonging to the requested
    flow and optional dashboard tool name.
    """
    url = f"{LANGFLOW_BASE}/api/v1/monitor/traces"
    params = {"flow_id": flow_id, "page": 1, "size": 100}

    try:
        res = requests.get(url, headers=_langflow_headers(api_key), params=params, timeout=30)
    except requests.Timeout:
        return None, "Langflow request timed out"
    except requests.RequestException:
        return None, "Could not reach Langflow"

    if not res.ok:
        return None, f"Langflow responded {res.status_code}"

    try:
        data = res.json()
    except ValueError:
        return None, "Langflow returned invalid JSON"

    items = _extract_traces(data)

    filtered = [
        t for t in items
        if isinstance(t, dict)
        and t.get("flowId") == flow_id
        and _trace_uses_agent_tool(t, tool_name)
    ]

    filtered.sort(key=lambda t: t.get("startTime", ""), reverse=True)
    return filtered, None


def _agent_public(agent):
    return {"id": agent["id"], "label": agent["label"]}


def _find_agent(agent_id: str):
    return next((agent for agent in AGENTS if agent["id"] == agent_id), None)


def _tag_trace(trace, agent):
    tagged = dict(trace)
    tagged["agentId"] = agent["id"]
    tagged["agentLabel"] = agent["label"]
    return tagged


@app.get("/health")
def root_health():
    return {"status": "ok"}


@app.get("/api/health")
def health():
    """Lets the frontend show 'Live' vs 'Reference Data' correctly."""
    return {"status": "ok", "langflow_configured": KEY_CONFIGURED}


@app.get("/api/agents")
def get_agents():
    return [_agent_public(agent) for agent in AGENTS]


@app.get("/api/traces")
def get_traces(agent_id: str = "all", page: int = 1, size: int = 20):
    if not KEY_CONFIGURED:
        return _error_response("No Langflow agents configured")

    page = max(1, page)
    size = max(1, min(size, 100))
    partial_errors = []

    if agent_id and agent_id != "all":
        agent = _find_agent(agent_id)
        if not agent:
            return _error_response("Agent not configured")
        all_traces, error = _fetch_all_traces_for_flow(agent["flow_id"], agent["api_key"], agent["tool_name"])
        if error:
            return _error_response(error)
        all_traces = [_tag_trace(trace, agent) for trace in all_traces]
    else:
        all_traces = []
        for agent in AGENTS:
            traces, error = _fetch_all_traces_for_flow(agent["flow_id"], agent["api_key"], agent["tool_name"])
            if error:
                partial_errors.append({"agent_id": agent["id"], "error": error})
                continue
            all_traces.extend(_tag_trace(trace, agent) for trace in traces)
        all_traces.sort(key=lambda t: t.get("startTime", ""), reverse=True)

    total = len(all_traces)
    pages = max(1, math.ceil(total / size))
    start = (page - 1) * size
    page_items = all_traces[start:start + size]

    response = {
        "source": "live",
        "traces": page_items,
        "total": total,
        "page": page,
        "pages": pages,
    }
    if partial_errors:
        response["partial_errors"] = partial_errors
    return response


@app.get("/api/traces/{trace_id}")
def get_trace_detail(trace_id: str, agent_id: str = "all"):
    if not KEY_CONFIGURED:
        return _error_response("No Langflow agents configured")

    agents = AGENTS
    if agent_id and agent_id != "all":
        agent = _find_agent(agent_id)
        if not agent:
            return _error_response("Agent not configured")
        agents = [agent]

    for agent in agents:
        all_traces, error = _fetch_all_traces_for_flow(agent["flow_id"], agent["api_key"], agent["tool_name"])
        if error:
            continue
        match: Optional[dict] = next((t for t in all_traces if t.get("id") == trace_id), None)
        if match:
            return _tag_trace(match, agent)

    return _error_response("Trace not found")
