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
import time
import json
import logging
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from typing import Any, Literal, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

import jwt
import requests
import psycopg2
import psycopg2.extras
from cryptography.hazmat.primitives import serialization
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

try:
    from auth import router as auth_router
except ImportError:
    from backend.auth import router as auth_router

load_dotenv(Path(__file__).with_name(".env"))

LANGFLOW_API_KEY = os.getenv("LANGFLOW_API_KEY", "")
LANGFLOW_BASE = os.getenv("LANGFLOW_BASE", "https://agent-builder.nhtech.link")
PLATFORM_BASE = os.getenv("PLATFORM_BASE", "https://ottom8.nhtech.link")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "http://localhost:5173")
FRONTEND_DOMAIN = os.getenv("FRONTEND_DOMAIN", "")
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", "")
TEST_TO_EMAIL = os.getenv("TEST_TO_EMAIL", "")
CC_EMAIL_1 = os.getenv("CC_EMAIL_1", "")
CC_EMAIL_2 = os.getenv("CC_EMAIL_2", "")
DATABASE_URL = os.getenv("DATABASE_URL", "")
COMPLIANCE_SCHEMA = os.getenv("COMPLIANCE_SCHEMA", "public")
PRIVATE_KEY_PATH = os.getenv(
    "PRIVATE_KEY_PATH",
    str((Path(__file__).resolve().parent / "keys" / "synapse_private_key.pem")),
)
LEGACY_PRIVATE_KEY_PATH = Path(__file__).resolve().parent / "keys" / "synapse_private.pem"
if not os.path.isabs(PRIVATE_KEY_PATH):
    PRIVATE_KEY_PATH = str((Path(__file__).resolve().parent / PRIVATE_KEY_PATH).resolve())
if not os.path.exists(PRIVATE_KEY_PATH) and LEGACY_PRIVATE_KEY_PATH.exists():
    PRIVATE_KEY_PATH = str(LEGACY_PRIVATE_KEY_PATH)

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
FLOW_CACHE_TTL_SECONDS = 120
EMAIL_FLOW_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
TRACE_FLOW_CACHE_TTL_SECONDS = 60
TRACE_FLOW_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
COMPLIANCE_CACHE_TTL_SECONDS = 30
COMPLIANCE_CACHE: dict[str, tuple[float, list[dict[str, Any]], dict[str, int], int]] = {}


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def mint_jwt() -> str:
    key_path = Path(PRIVATE_KEY_PATH)
    if not key_path.exists():
        raise FileNotFoundError(f"RSA private key not found at {key_path}")

    private_key = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
    now = int(time.time())
    payload = {
        "iss": "synapse",
        "aud": "ottom8",
        "iat": now,
        "exp": now + 299,
    }
    return jwt.encode(payload, private_key, algorithm="RS256")


def fetch_flows_for_email(email: str) -> list[dict[str, Any]]:
    normalized_email = _normalize_email(email)
    if not normalized_email:
        raise ValueError("Email is required")

    cached = EMAIL_FLOW_CACHE.get(normalized_email)
    if cached and time.time() - cached[0] < FLOW_CACHE_TTL_SECONDS:
        return cached[1]

    token = mint_jwt()
    url = f"{PLATFORM_BASE}/api/v1/integrations/synapse/flows"
    response = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"email": normalized_email},
        timeout=30,
    )

    if not response.ok:
        raise RuntimeError(f"Platform API returned {response.status_code}: {response.text[:300]}")

    try:
        payload = response.json()
    except ValueError as exc:
        raise RuntimeError("Platform API returned invalid JSON") from exc

    flows = payload
    if isinstance(payload, dict):
        for key in ("flows", "data", "items", "results"):
            value = payload.get(key)
            if isinstance(value, list):
                flows = value
                break
        else:
            flows = []

    if not isinstance(flows, list):
        flows = []

    mapped_agents = []
    for item in flows:
        if not isinstance(item, dict):
            continue
        flow_id = item.get("flow_id") or item.get("flowId") or item.get("id")
        if not flow_id:
            continue
        name = item.get("name") or item.get("flow_name") or item.get("flowName") or f"Agent {len(mapped_agents) + 1}"
        mapped_agents.append({
            "id": str(flow_id),
            "label": str(name),
            "flow_id": str(flow_id),
            "api_key": LANGFLOW_API_KEY,
            "tool_name": "",
            "description": item.get("description") or "",
            "project_id": item.get("project_id") or item.get("projectId") or "",
            "project_name": item.get("project_name") or item.get("projectName") or "",
        })

    EMAIL_FLOW_CACHE[normalized_email] = (time.time(), mapped_agents)
    return mapped_agents


def _get_agents_for_email(email: str) -> list[dict[str, Any]]:
    normalized_email = _normalize_email(email)
    if not normalized_email:
        return []

    try:
        return fetch_flows_for_email(normalized_email)
    except Exception:
        raise

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


class RequestSubmission(BaseModel):
    kind: Literal["issue_or_change", "workflow_change"]
    fields: dict[str, Any]
    agent_id: str = "all"


REQUEST_FIELD_LABELS = {
    "type": "Request type",
    "target_agent": "Agent this is about",
    "description": "Description",
    "priority": "Priority",
    "name": "Name",
    "email": "Email",
    "change": "Change requested",
    "why": "Why is this needed?",
    "example": "Example query / request",
    "output": "Expected output",
}


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

    try:
        output = trace.get("output") or {}
        message = output.get("message") or {}
        data = message.get("data") or {}
        content_blocks = data.get("content_blocks") or []

        if not isinstance(content_blocks, list):
            return False

        for block in content_blocks:
            if not isinstance(block, dict):
                continue
            contents = block.get("contents") or []
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
    except Exception:
        return False


def _get_cached_flow_traces(flow_id: str, api_key: str, tool_name: str):
    cached = TRACE_FLOW_CACHE.get(flow_id)
    if cached and time.time() - cached[0] < TRACE_FLOW_CACHE_TTL_SECONDS:
        return cached[1], None

    traces, error = _fetch_all_traces_for_flow(flow_id, api_key, tool_name)
    if error is None and traces is not None:
        TRACE_FLOW_CACHE[flow_id] = (time.time(), traces)
    return traces, error


def _fetch_traces_for_agents(agents: list[dict[str, Any]]):
    all_traces: list[dict[str, Any]] = []
    partial_errors: list[dict[str, str]] = []

    if not agents:
        return all_traces, partial_errors

    max_workers = min(10, len(agents))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(_get_cached_flow_traces, agent["flow_id"], agent["api_key"], agent["tool_name"]): agent
            for agent in agents
        }
        for future in as_completed(futures):
            agent = futures[future]
            try:
                traces, error = future.result()
            except Exception as exc:
                partial_errors.append({"agent_id": agent["id"], "error": str(exc)})
                continue
            if error:
                partial_errors.append({"agent_id": agent["id"], "error": error})
                continue
            all_traces.extend(_tag_trace(trace, agent) for trace in traces or [])

    all_traces.sort(key=lambda t: t.get("startTime", ""), reverse=True)
    return all_traces, partial_errors


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


def _agent_label(agent_id: str):
    if agent_id == "all":
        return "All agents"
    agent = _find_agent(agent_id)
    if agent:
        return agent["label"]
    return agent_id.replace("_", " ").replace("-", " ").title()


def _request_kind_label(kind: str):
    if kind == "workflow_change":
        return "Workflow Change Request"
    return "Report Issue"


def _field_label(key: str):
    if key in REQUEST_FIELD_LABELS:
        return REQUEST_FIELD_LABELS[key]
    return key.replace("_", " ").strip().capitalize()


def _format_field_value(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return escape(str(value))
    return escape(str(value))


def _db_connect():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not configured")
    return psycopg2.connect(DATABASE_URL)


def _json_value(value):
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return value
        try:
            return json.loads(text)
        except Exception:
            return value
    return value


def _normalize_status(value):
    return str(value or "").strip().upper() or None


def _normalize_datetime(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _serialize_compliance_row(row: dict[str, Any]):
    evidence_json = _json_value(row.get("evidence_json"))
    issues = _json_value(row.get("issues"))
    missing_evidence = _json_value(row.get("missing_evidence"))
    event_data = _json_value(row.get("event_data") or row.get("log_event_data"))
    return {
        "id": row.get("id"),
        "treaty_audit_id": row.get("treaty_audit_id"),
        "audit_id": row.get("audit_id") or row.get("treaty_audit_id"),
        "session_id": row.get("session_id") or row.get("log_session_id"),
        "email_id": row.get("email_id"),
        "sender_email": row.get("sender_email"),
        "agent_name": row.get("agent_name"),
        "action_type": row.get("action_type"),
        "event_type": row.get("event_type") or row.get("log_event_type"),
        "action_status": row.get("action_status"),
        "action_timestamp": _normalize_datetime(row.get("action_timestamp")),
        "compliance_status": _normalize_status(row.get("compliance_status")),
        "verification_status": _normalize_status(row.get("verification_status")),
        "route": row.get("route"),
        "policy_id": row.get("policy_id"),
        "policy_version": row.get("policy_version"),
        "violation_type": row.get("violation_type"),
        "severity": _normalize_status(row.get("severity")),
        "reason": row.get("reason"),
        "decision_supported": row.get("decision_supported"),
        "evidence_integrity": row.get("evidence_integrity"),
        "verification_reason": row.get("verification_reason"),
        "issues": issues,
        "missing_evidence": missing_evidence,
        "evidence_json": evidence_json,
        "created_at": _normalize_datetime(row.get("created_at") or row.get("log_created_at")),
        "verified_at": _normalize_datetime(row.get("verified_at")),
        "event_data": event_data,
    }


def _compliance_cache_key(filters: dict[str, Any]) -> str:
    return json.dumps(filters, sort_keys=True, default=str)


def _load_treaty_compliance(filters: dict[str, Any]):
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not configured")

    cache_key = _compliance_cache_key(filters)
    cached = COMPLIANCE_CACHE.get(cache_key)
    if cached and time.time() - cached[0] < COMPLIANCE_CACHE_TTL_SECONDS:
        return cached[1], cached[2], cached[3]

    where = []
    params: list[Any] = []
    if filters.get("compliance_status"):
        where.append("upper(coalesce(ca.compliance_status, '')) = upper(%s)")
        params.append(filters["compliance_status"])
    if filters.get("severity"):
        where.append("upper(coalesce(ca.severity, '')) = upper(%s)")
        params.append(filters["severity"])
    if filters.get("action_type"):
        where.append("upper(coalesce(ca.action_type, '')) = upper(%s)")
        params.append(filters["action_type"])
    if filters.get("verification_status"):
        where.append("upper(coalesce(ca.verification_status, '')) = upper(%s)")
        params.append(filters["verification_status"])
    if filters.get("q"):
        q = f"%{filters['q']}%"
        where.append("("
            "coalesce(ca.treaty_audit_id::text, '') ilike %s or "
            "coalesce(ca.session_id::text, '') ilike %s or "
            "coalesce(ca.email_id::text, '') ilike %s or "
            "coalesce(ca.sender_email, '') ilike %s or "
            "coalesce(ca.action_type, '') ilike %s or "
            "coalesce(ca.policy_id, '') ilike %s"
        ")")
        params.extend([q, q, q, q, q, q])
    if filters.get("from"):
        where.append("coalesce(ca.action_timestamp, ca.created_at) >= %s")
        params.append(filters["from"])
    if filters.get("to"):
        where.append("coalesce(ca.action_timestamp, ca.created_at) <= %s")
        params.append(filters["to"])
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    offset = max(0, (filters["page"] - 1) * filters["size"])
    size = filters["size"]

    query = f"""
        SELECT
          ca.*
        FROM {COMPLIANCE_SCHEMA}.compliance_audit_results ca
        {where_sql}
        ORDER BY coalesce(ca.action_timestamp, ca.created_at) DESC NULLS LAST, ca.id DESC
        LIMIT %s OFFSET %s
    """

    count_query = f"""
        SELECT count(*) AS total
        FROM {COMPLIANCE_SCHEMA}.compliance_audit_results ca
        {where_sql}
    """

    summary_query = f"""
        SELECT
          count(*) AS total_actions,
          count(*) FILTER (WHERE upper(trim(coalesce(ca.compliance_status, ''))) IN ('COMPLIANT', 'PASS', 'PASSED', 'SUCCESS')) AS compliant,
          count(*) FILTER (WHERE upper(trim(coalesce(ca.compliance_status, ''))) IN ('VIOLATION', 'NON_COMPLIANT', 'NON-COMPLIANT', 'FAILED')) AS violations,
          count(*) FILTER (WHERE upper(trim(coalesce(ca.compliance_status, ''))) IN ('UNVERIFIABLE', 'NEEDS_REVIEW', 'REVIEW', 'UNKNOWN')) AS unverifiable,
          count(*) FILTER (WHERE upper(trim(coalesce(ca.severity, ''))) IN ('HIGH', 'CRITICAL')) AS high_critical
        FROM {COMPLIANCE_SCHEMA}.compliance_audit_results ca
        {where_sql}
    """

    with _db_connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(count_query, params)
            total = int(cur.fetchone()["total"])
            cur.execute(summary_query, params)
            summary = dict(cur.fetchone())
            cur.execute(query, [*params, size, offset])
            rows = [dict(row) for row in cur.fetchall()]

    items = [_serialize_compliance_row(row) for row in rows]
    COMPLIANCE_CACHE[cache_key] = (time.time(), items, summary, total)
    return items, summary, total


def _load_treaty_timeline(session_id: str):
    if not DATABASE_URL:
        return []
    query = f"""
        SELECT
          audit_id,
          session_id,
          email_id,
          sender_email,
          event_type,
          event_status,
          event_data,
          created_at
        FROM {COMPLIANCE_SCHEMA}.treaty_audit_logs
        WHERE session_id = %s
        ORDER BY created_at ASC, audit_id ASC
    """
    with _db_connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query, [session_id])
            return [dict(row) for row in cur.fetchall()]


def _detail_for_compliance(row: dict[str, Any]):
    session_id = row.get("session_id")
    timeline = _load_treaty_timeline(session_id) if session_id else []
    return {
        **_serialize_compliance_row(row),
        "timeline": [
            {
                "audit_id": item.get("audit_id"),
                "session_id": item.get("session_id"),
                "email_id": item.get("email_id"),
                "sender_email": item.get("sender_email"),
                "event_type": item.get("event_type"),
                "event_status": item.get("event_status"),
                "event_data": _json_value(item.get("event_data")),
                "created_at": _normalize_datetime(item.get("created_at")),
            }
            for item in timeline
        ],
    }


@app.get("/api/compliance/treaty")
def get_treaty_compliance(
    q: Optional[str] = None,
    compliance_status: Optional[str] = None,
    severity: Optional[str] = None,
    action_type: Optional[str] = None,
    verification_status: Optional[str] = None,
    from_ts: Optional[str] = None,
    to_ts: Optional[str] = None,
    page: int = 1,
    size: int = 20,
):
    page = max(1, page)
    size = max(1, min(size, 100))
    filters = {
        "q": q,
        "compliance_status": compliance_status,
        "severity": severity,
        "action_type": action_type,
        "verification_status": verification_status,
        "from": from_ts,
        "to": to_ts,
        "page": page,
        "size": size,
    }
    try:
        items, summary, total = _load_treaty_compliance(filters)
    except Exception as exc:
        logger.exception("Treaty compliance query failed")
        return JSONResponse(
            status_code=500,
            content={
                "source": "error",
                "items": [],
                "total": 0,
                "page": page,
                "pages": 1,
                "summary": {
                    "total_actions": 0,
                    "compliant": 0,
                    "violations": 0,
                    "unverifiable": 0,
                    "high_critical": 0,
                },
                "message": "Failed to load Treaty compliance data",
            },
        )

    pages = max(1, math.ceil(total / size))
    return {
        "source": "live",
        "items": items,
        "total": total,
        "page": page,
        "pages": pages,
        "summary": {
            "total_actions": int(summary.get("total_actions") or 0),
            "compliant": int(summary.get("compliant") or 0),
            "violations": int(summary.get("violations") or 0),
            "unverifiable": int(summary.get("unverifiable") or 0),
            "high_critical": int(summary.get("high_critical") or 0),
        },
    }


@app.get("/api/compliance/treaty/{audit_id}")
def get_treaty_compliance_detail(audit_id: str):
    if not DATABASE_URL:
        return JSONResponse(
            status_code=500,
            content={"source": "error", "message": "DATABASE_URL is not configured"},
        )

    query = f"""
        SELECT *
        FROM {COMPLIANCE_SCHEMA}.compliance_audit_results
        WHERE id::text = %s OR treaty_audit_id::text = %s
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT 1
    """
    try:
        with _db_connect() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(query, [audit_id, audit_id])
                row = cur.fetchone()
    except Exception as exc:
        logger.exception("Treaty compliance detail query failed for audit identifier")
        return JSONResponse(
            status_code=500,
            content={"source": "error", "message": "Failed to load Treaty compliance detail"},
        )

    if not row:
        return JSONResponse(
            status_code=404,
            content={"source": "error", "message": "Compliance action not found"},
        )

    return _detail_for_compliance(dict(row))


def _build_request_html(kind: str, fields: dict, agent_label: str):
    timestamp = datetime.now(timezone.utc).isoformat()
    rows = [
        ("Agent", agent_label),
        ("Timestamp", timestamp),
    ]
    rows.extend((_field_label(key), value) for key, value in fields.items())

    requester_parts = [
        str(fields.get("name", "")).strip(),
        str(fields.get("email", "")).strip(),
    ]
    requested_by = " ".join(part for part in requester_parts if part)
    if requested_by:
        rows.append(("Requested by", requested_by))

    row_html = "".join(
        "<tr>"
        f"<th style=\"text-align:left;padding:8px 12px;border-bottom:1px solid #dfe6ee;color:#43536a;vertical-align:top;\">{escape(label)}</th>"
        f"<td style=\"padding:8px 12px;border-bottom:1px solid #dfe6ee;color:#101b2c;white-space:pre-wrap;\">{_format_field_value(value)}</td>"
        "</tr>"
        for label, value in rows
    )

    return (
        "<div style=\"font-family:Inter,Segoe UI,Arial,sans-serif;color:#101b2c;line-height:1.5;\">"
        f"<h2 style=\"margin:0 0 12px;\">{escape(_request_kind_label(kind))}</h2>"
        "<table style=\"border-collapse:collapse;width:100%;max-width:720px;border:1px solid #dfe6ee;\">"
        f"{row_html}"
        "</table>"
        "</div>"
    )


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
def get_agents(email: Optional[str] = None):
    normalized_email = _normalize_email(email)
    if normalized_email:
        try:
            agents = _get_agents_for_email(normalized_email)
        except Exception as exc:
            return JSONResponse(
                status_code=500,
                content={
                    "message": "We couldn't find any agents for this email — check with your team.",
                    "detail": str(exc),
                },
            )
        return [_agent_public(agent) for agent in agents]
    return [_agent_public(agent) for agent in AGENTS]


@app.post("/api/requests")
def create_request(payload: RequestSubmission):
    if not RESEND_API_KEY or not FROM_EMAIL:
        return JSONResponse(
            status_code=500,
            content={
                "message": "Failed to send request",
                "detail": "RESEND_API_KEY and FROM_EMAIL must be configured",
            },
        )

    recipient = TEST_TO_EMAIL or str(payload.fields.get("email", "")).strip()
    if not recipient:
        return JSONResponse(
            status_code=500,
            content={
                "message": "Failed to send request",
                "detail": "No recipient email provided",
            },
        )

    agent_label = _agent_label(payload.agent_id)
    resend_payload = {
        "from": FROM_EMAIL,
        "to": [recipient],
        "subject": f"[Synapse] {_request_kind_label(payload.kind)} — {agent_label}",
        "html": _build_request_html(payload.kind, payload.fields, agent_label),
    }
    cc_list = [email for email in [CC_EMAIL_1, CC_EMAIL_2] if email]
    if cc_list:
        resend_payload["cc"] = cc_list
    try:
        res = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json=resend_payload,
            timeout=30,
        )
    except requests.RequestException as exc:
        return JSONResponse(
            status_code=500,
            content={"message": "Failed to send request", "detail": str(exc)},
        )

    if not res.ok:
        return JSONResponse(
            status_code=500,
            content={"message": "Failed to send request", "detail": res.text},
        )

    return {"message": "Request sent"}


@app.get("/api/traces")
def get_traces(agent_id: str = "all", page: int = 1, size: int = 20, email: Optional[str] = None):
    agents_for_scope = AGENTS
    requested_email = _normalize_email(email)
    if requested_email:
        try:
            agents_for_scope = _get_agents_for_email(requested_email)
        except Exception as exc:
            return _error_response(f"Could not load agents for {requested_email}: {exc}")
    if not agents_for_scope:
        return _error_response("No Langflow agents configured")

    page = max(1, page)
    size = max(1, min(size, 100))
    partial_errors = []

    if agent_id and agent_id != "all":
        agent = next((item for item in agents_for_scope if item["id"] == agent_id), None)
        if not agent:
            return _error_response("Agent not configured")
        all_traces, error = _get_cached_flow_traces(agent["flow_id"], agent["api_key"], agent["tool_name"])
        if error:
            return _error_response(error)
        all_traces = [_tag_trace(trace, agent) for trace in all_traces]
    else:
        all_traces, partial_errors = _fetch_traces_for_agents(agents_for_scope)

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
def get_trace_detail(trace_id: str, agent_id: str = "all", email: Optional[str] = None):
    agents_for_scope = AGENTS
    requested_email = _normalize_email(email)
    if requested_email:
        try:
            agents_for_scope = _get_agents_for_email(requested_email)
        except Exception as exc:
            return _error_response(f"Could not load agents for {requested_email}: {exc}")
    if not agents_for_scope:
        return _error_response("No Langflow agents configured")

    agents = agents_for_scope
    if agent_id and agent_id != "all":
        agent = next((item for item in agents_for_scope if item["id"] == agent_id), None)
        if not agent:
            return _error_response("Agent not configured")
        agents = [agent]

    if agent_id and agent_id != "all":
        all_traces, error = _get_cached_flow_traces(agents[0]["flow_id"], agents[0]["api_key"], agents[0]["tool_name"])
        if not error:
            match: Optional[dict] = next((t for t in all_traces if t.get("id") == trace_id), None)
            if match:
                return _tag_trace(match, agents[0])
    else:
        with ThreadPoolExecutor(max_workers=min(10, len(agents))) as executor:
            futures = {
                executor.submit(_get_cached_flow_traces, agent["flow_id"], agent["api_key"], agent["tool_name"]): agent
                for agent in agents
            }
            for future in as_completed(futures):
                agent = futures[future]
                try:
                    all_traces, error = future.result()
                except Exception:
                    continue
                if error:
                    continue
                match = next((t for t in all_traces if t.get("id") == trace_id), None)
                if match:
                    return _tag_trace(match, agent)

    return _error_response("Trace not found")
