"""
Synapse backend proxy (FastAPI)
--------------------------------
Sits between the dashboard frontend and Langflow's monitor traces API.
The Langflow x-api-key never reaches the browser — it's attached here,
server-side, from environment variables.

NOTE: Langflow's `flow_id` query param on /api/v1/monitor/traces does NOT
reliably filter server-side (it can return traces from every flow in the
workspace). So this proxy pulls a wide batch and filters by each trace's
own `flowId` field itself, then paginates the filtered result.

Env vars expected (backend/.env):
    LANGFLOW_API_KEY=<real key>
    LANGFLOW_BASE=https://agent-builder.nhtech.link
    FLOW_ID=<the Dispatcher Agent flow's UUID, from its URL in the Langflow UI>
    AGENT_TOOL_NAME=<tool_use name for this agent dashboard>
    ALLOWED_ORIGIN=http://localhost:5173

Run:
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000
"""

import os
import math
from typing import Optional

import requests
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

LANGFLOW_API_KEY = os.getenv("LANGFLOW_API_KEY", "")
LANGFLOW_BASE = os.getenv("LANGFLOW_BASE", "https://agent-builder.nhtech.link")
FLOW_ID = os.getenv("FLOW_ID", "")
AGENT_TOOL_NAME = os.getenv("AGENT_TOOL_NAME", "")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "http://localhost:5173")
FRONTEND_DOMAIN = os.getenv("FRONTEND_DOMAIN", "")

KEY_CONFIGURED = bool(LANGFLOW_API_KEY) and LANGFLOW_API_KEY != "yaha_apni_key_daalo"

allow_origin_regex = r"https://.*\.vercel\.app"
allow_origins = [origin for origin in [ALLOWED_ORIGIN, FRONTEND_DOMAIN] if origin]

app = FastAPI(title="Synapse backend proxy")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_origin_regex=allow_origin_regex,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _langflow_headers():
    return {
        "x-api-key": LANGFLOW_API_KEY,
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


def _trace_uses_agent_tool(trace):
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
                and item.get("name") == AGENT_TOOL_NAME
            ):
                return True
    return False


def _fetch_all_traces_for_flow():
    """
    Pull traces from Langflow (a wide single page, since the workspace-wide
    total is small — tens of runs, not thousands) and keep only the ones
    belonging to FLOW_ID and this dashboard's AGENT_TOOL_NAME.
    """
    url = f"{LANGFLOW_BASE}/api/v1/monitor/traces"
    params = {"flow_id": FLOW_ID, "page": 1, "size": 100}

    try:
        res = requests.get(url, headers=_langflow_headers(), params=params, timeout=30)
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

    # Keep only this flow's own traces (server-side flow_id filtering from
    # Langflow isn't reliable, so we filter on each trace's flowId here).
    filtered = [
        t for t in items
        if isinstance(t, dict)
        and t.get("flowId") == FLOW_ID
        and (not AGENT_TOOL_NAME or _trace_uses_agent_tool(t))
    ]

    # Most recent first.
    filtered.sort(key=lambda t: t.get("startTime", ""), reverse=True)
    return filtered, None


@app.get("/health")
def root_health():
    return {"status": "ok"}


@app.get("/api/health")
def health():
    """Lets the frontend show 'Live' vs 'Reference Data' correctly."""
    return {"status": "ok", "langflow_configured": KEY_CONFIGURED}


@app.get("/api/traces")
def get_traces(page: int = 1, size: int = 20):
    if not KEY_CONFIGURED:
        return _error_response("LANGFLOW_API_KEY not configured")
    if not FLOW_ID:
        return _error_response("FLOW_ID not configured")

    all_traces, error = _fetch_all_traces_for_flow()
    if error:
        return _error_response(error)

    page = max(1, page)
    size = max(1, min(size, 100))
    total = len(all_traces)
    pages = max(1, math.ceil(total / size))
    start = (page - 1) * size
    page_items = all_traces[start:start + size]

    return {
        "source": "live",
        "traces": page_items,
        "total": total,
        "page": page,
        "pages": pages,
    }


@app.get("/api/traces/{trace_id}")
def get_trace_detail(trace_id: str):
    if not KEY_CONFIGURED:
        return _error_response("LANGFLOW_API_KEY not configured")
    if not FLOW_ID:
        return _error_response("FLOW_ID not configured")

    all_traces, error = _fetch_all_traces_for_flow()
    if error:
        return _error_response(error)

    match: Optional[dict] = next((t for t in all_traces if t.get("id") == trace_id), None)
    if not match:
        return _error_response("Trace not found")
    return match
