import React, { useState } from "react";
import { login } from "./services/api";

const LOGIN_STYLES = `
.syn-login {
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
  --line-focus: #1e5eea;
  --shadow: 0 1px 2px rgba(16,27,44,.05), 0 4px 14px rgba(16,27,44,.05);
  --sans: "Inter", -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  min-height: 100svh;
  background: var(--bg);
  color: var(--ink);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  font-family: var(--sans);
}
.syn-login * { box-sizing: border-box; }
.syn-login-card {
  width: min(420px, 100%);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow);
  padding: 24px;
}
.syn-login-logo { display:flex; align-items:center; gap:12px; margin-bottom: 22px; }
.syn-login-mark {
  width: 34px; height: 34px; border-radius: 9px; flex-shrink:0;
  background: linear-gradient(135deg, var(--accent), #6d5ce6);
  display:flex; align-items:center; justify-content:center;
}
.syn-login-name { font-weight: 700; font-size: 16px; }
.syn-login-sub { color: var(--muted); font-size: 12px; margin-top: -1px; }
.syn-login-tabs {
  display:inline-flex; background: var(--surface); border:1px solid var(--line-strong);
  border-radius: 9px; padding:2px; gap:2px; margin-bottom: 18px;
}
.syn-login-tabs button {
  border:none; background:transparent; color: var(--ink-2); font:inherit; font-size:12.5px;
  font-weight:500; padding: 6px 12px; border-radius: 7px; cursor:pointer;
}
.syn-login-tabs button.active { background: var(--accent); color:#fff; font-weight:600; }
.syn-login-field { margin-bottom: 13px; }
.syn-login-field label { display:block; font-size: 12.5px; font-weight: 600; color: var(--ink-2); margin-bottom: 5px; }
.syn-login-field input {
  width:100%; padding: 9px 11px; border-radius: 9px; border:1px solid var(--line-strong);
  background: var(--surface); color: var(--ink); font:inherit; font-size: 13.5px;
}
.syn-login-field input:focus-visible, .syn-login button:focus-visible {
  outline: 2px solid var(--line-focus); outline-offset: 1px;
}
.syn-login-btn {
  width: 100%; border: 1px solid var(--accent); background: var(--accent); color: #fff;
  border-radius: 8px; padding: 9px 13px; font: inherit; font-size: 13px; font-weight: 600;
  cursor: pointer; display:inline-flex; align-items:center; justify-content:center;
}
.syn-login-btn:hover { filter: brightness(1.06); }
.syn-login-btn:disabled { opacity:.55; cursor:not-allowed; }
.syn-login-message {
  border-radius: 9px; padding: 9px 11px; font-size: 12.5px; margin-bottom: 13px;
  border: 1px solid var(--line);
}
.syn-login-message.ok { background: var(--ok-soft); color: var(--ok); border-color: var(--ok-soft); }
.syn-login-message.err { background: var(--err-soft); color: var(--err); border-color: var(--err-soft); }
`;

export default function LoginPage({ onLoginSuccess }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();
    setMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setMessage({ type: "err", text: "Please enter your email." });
      return;
    }

    setLoading(true);
    try {
      await login(trimmedEmail);
      onLoginSuccess(trimmedEmail);
    } catch (error) {
      setMessage({
        type: "err",
        text: error.message || "We couldn't find any agents for this email — check with your team.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="syn-login">
      <style>{LOGIN_STYLES}</style>
      <form className="syn-login-card" onSubmit={onSubmit}>
        <div className="syn-login-logo">
          <div className="syn-login-mark">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l4 4M14 14l4 4M18 6l-4 4M10 14l-4 4" /><circle cx="12" cy="12" r="2.2" fill="#fff" stroke="none" />
            </svg>
          </div>
          <div>
            <div className="syn-login-name">Synapse</div>
            <div className="syn-login-sub">Sign in to view your agents</div>
          </div>
        </div>

        {message && <div className={`syn-login-message ${message.type}`}>{message.text}</div>}

        <div className="syn-login-field">
          <label htmlFor="login-email">Email</label>
          <input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>

        <button className="syn-login-btn" type="submit" disabled={loading}>
          {loading ? "Please wait..." : "Continue"}
        </button>
      </form>
    </div>
  );
}
