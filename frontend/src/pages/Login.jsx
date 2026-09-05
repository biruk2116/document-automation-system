import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ROLES } from '../utils/roles';
import logo from '../assets/logo.svg';

function defaultRouteForRole(role) {
  switch (role) {
    case ROLES.SUPER_ADMIN:
    case ROLES.SYSTEM_ADMIN: return '/templates';
    case ROLES.APPROVER:     return '/approvals';
    default:                 return '/documents';
  }
}

function EyeIcon({ off }) {
  return off ? (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ) : (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

/* ── Document automation illustration matching the provided design ── */
function DocAutomationIllustration() {
  return (
    <svg viewBox="0 0 300 300" fill="none" xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true" style={{ width: '100%', maxWidth: 280 }}>
      
      {/* Main document 1 - back */}
      <g opacity="0.7">
        <rect x="90" y="80" width="120" height="160" rx="8"
          fill="var(--doc-bg)" stroke="var(--doc-stroke)" strokeWidth="2"/>
        <rect x="105" y="100" width="70" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="105" y="110" width="85" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="105" y="120" width="65" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="105" y="135" width="75" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="105" y="145" width="80" height="4" rx="2" fill="var(--doc-line)"/>
      </g>

      {/* Main document 2 - middle */}
      <g opacity="0.85">
        <animateTransform attributeName="transform" type="translate"
          values="0,0;-2,-2;0,0" dur="3s" repeatCount="indefinite"/>
        <rect x="70" y="90" width="120" height="160" rx="8"
          fill="var(--doc-bg)" stroke="var(--doc-stroke)" strokeWidth="2"/>
        <rect x="85" y="110" width="70" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="85" y="120" width="85" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="85" y="130" width="65" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="85" y="145" width="75" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="85" y="155" width="80" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="85" y="165" width="60" height="4" rx="2" fill="var(--doc-line)"/>
      </g>

      {/* Main document 3 - front (with checkmark) */}
      <g>
        <animateTransform attributeName="transform" type="translate"
          values="0,0;-3,-3;0,0" dur="4s" repeatCount="indefinite"/>
        <rect x="50" y="100" width="120" height="160" rx="8"
          fill="var(--doc-bg-front)" stroke="var(--doc-stroke-front)" strokeWidth="2.5"/>
        <rect x="65" y="120" width="70" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="65" y="130" width="85" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="65" y="140" width="65" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="65" y="155" width="75" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="65" y="165" width="80" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="65" y="175" width="60" height="4" rx="2" fill="var(--doc-line)"/>
        
        {/* Checkmark circle */}
        <circle cx="110" cy="215" r="24" fill="var(--check-bg)" stroke="var(--check-stroke)" strokeWidth="2">
          <animate attributeName="opacity" values="1;0.8;1" dur="2s" repeatCount="indefinite"/>
        </circle>
        <path d="M98 215 l8 8 16-16" stroke="var(--check-mark)" strokeWidth="3.5"
          strokeLinecap="round" strokeLinejoin="round">
          <animate attributeName="stroke-dashoffset" from="35" to="0" dur="2s" repeatCount="indefinite"/>
          <animate attributeName="stroke-dasharray" values="0 35;35 0" dur="2s" repeatCount="indefinite"/>
        </path>
      </g>

      {/* Circular arrows - document flow animation */}
      <g>
        {/* Left arrow */}
        <path d="M 65 140 Q 30 140 30 105" stroke="var(--arrow-color)" strokeWidth="2.5"
          fill="none" strokeLinecap="round" opacity="0.6">
          <animate attributeName="stroke-dashoffset" from="100" to="0" dur="3s" repeatCount="indefinite"/>
          <animate attributeName="stroke-dasharray" values="0 100;100 0" dur="3s" repeatCount="indefinite"/>
        </path>
        <circle cx="30" cy="100" r="3" fill="var(--arrow-color)">
          <animate attributeName="opacity" values="0;1;0" dur="3s" repeatCount="indefinite"/>
        </circle>

        {/* Right arrow */}
        <path d="M 155 220 Q 220 220 220 180" stroke="var(--arrow-color)" strokeWidth="2.5"
          fill="none" strokeLinecap="round" opacity="0.6">
          <animate attributeName="stroke-dashoffset" from="100" to="0" dur="3s" begin="1s" repeatCount="indefinite"/>
          <animate attributeName="stroke-dasharray" values="0 100;100 0" dur="3s" begin="1s" repeatCount="indefinite"/>
        </path>
        <circle cx="220" cy="175" r="3" fill="var(--arrow-color)">
          <animate attributeName="opacity" values="0;1;0" dur="3s" begin="1s" repeatCount="indefinite"/>
        </circle>
      </g>

      {/* Gear icon - automation symbol */}
      <g opacity="0.7">
        <animateTransform attributeName="transform" type="rotate"
          values="0 220 120; 360 220 120" dur="8s" repeatCount="indefinite"/>
        <circle cx="220" cy="120" r="20" fill="var(--gear-bg)" stroke="var(--gear-stroke)" strokeWidth="2"/>
        <circle cx="220" cy="120" r="8" fill="var(--doc-bg-front)"/>
        {[0, 60, 120, 180, 240, 300].map((angle, i) => (
          <rect key={i}
            x="218" y="100" width="4" height="8" rx="2"
            fill="var(--gear-stroke)"
            transform={`rotate(${angle} 220 120)`}/>
        ))}
      </g>

      {/* Water drop/refresh icon */}
      <g opacity="0.6">
        <animateTransform attributeName="transform" type="translate"
          values="0,0;0,-3;0,0" dur="2.5s" repeatCount="indefinite"/>
        <ellipse cx="40" cy="190" rx="12" ry="15" fill="var(--drop-color)" opacity="0.3"/>
        <ellipse cx="40" cy="188" rx="10" ry="13" fill="var(--drop-color)"/>
        <circle cx="40" cy="183" r="3" fill="var(--doc-bg-front)" opacity="0.6"/>
      </g>

      {/* Define CSS variables for theming */}
      <defs>
        <style>{`
          :root {
            --doc-bg: rgba(255, 255, 255, 0.95);
            --doc-bg-front: #ffffff;
            --doc-stroke: rgba(59, 130, 246, 0.3);
            --doc-stroke-front: rgba(14, 165, 233, 0.5);
            --doc-line: rgba(148, 163, 184, 0.4);
            --check-bg: rgba(34, 197, 94, 0.15);
            --check-stroke: rgba(34, 197, 94, 0.5);
            --check-mark: rgb(34, 197, 94);
            --arrow-color: rgba(14, 165, 233, 0.6);
            --gear-bg: rgba(251, 191, 36, 0.15);
            --gear-stroke: rgba(251, 191, 36, 0.6);
            --drop-color: rgba(14, 165, 233, 0.5);
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --doc-bg: rgba(30, 41, 59, 0.6);
              --doc-bg-front: rgb(30, 41, 59);
              --doc-stroke: rgba(56, 189, 248, 0.3);
              --doc-stroke-front: rgba(14, 165, 233, 0.6);
              --doc-line: rgba(71, 85, 105, 0.6);
              --check-bg: rgba(34, 197, 94, 0.2);
              --check-stroke: rgba(34, 197, 94, 0.6);
              --check-mark: rgb(74, 222, 128);
              --arrow-color: rgba(56, 189, 248, 0.7);
              --gear-bg: rgba(251, 191, 36, 0.2);
              --gear-stroke: rgba(251, 191, 36, 0.7);
              --drop-color: rgba(56, 189, 248, 0.6);
            }
          }
        `}</style>
      </defs>
    </svg>
  );
}

export default function Login() {
  const { login }    = useAuth();
  const navigate     = useNavigate();
  const location     = useLocation();

  const [email,      setEmail]      = useState('');
  const [password,   setPassword]   = useState('');
  const [showPw,     setShowPw]     = useState(false);
  const [remember,   setRemember]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim())  { setError('Please enter your work email.');  return; }
    if (!password)      { setError('Please enter your password.');     return; }
    setError(null);
    setSubmitting(true);
    try {
      const u = await login(email.trim(), password, remember);
      const to = location.state?.from?.pathname || defaultRouteForRole(u.role);
      navigate(to, { replace: true, state: location.state?.from?.state });
    } catch (err) {
      setError(err.message || 'Invalid email or password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <style>{`
        /* ── reset ── */
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        /* ─────────────────────────────────────
           PAGE SHELL — split screen layout
        ───────────────────────────────────────*/
        .lp {
          display: flex;
          width: 100vw;
          height: 100vh;
          overflow: hidden;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #F8FAFC;
        }
        @media (prefers-color-scheme: dark) {
          .lp { background: #0F172A; }
        }

        /* ─────────────────────────────────────
           LEFT HERO — 50%
        ───────────────────────────────────────*/
        .lp-hero {
          flex: 0 0 50%;
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px;
          overflow: hidden;
          background: linear-gradient(135deg, #FFFFFF 0%, #F1F5F9 100%);
        }
        @media (prefers-color-scheme: dark) {
          .lp-hero {
            background: linear-gradient(135deg, #1E293B 0%, #0F172A 100%);
          }
        }

        .lp-hi {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          max-width: 500px;
          width: 100%;
        }

        /* Brand logo at top */
        .lp-brand {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 50px;
        }
        .lp-brand-logo {
          width: 48px;
          height: 48px;
          border-radius: 12px;
          overflow: hidden;
          flex-shrink: 0;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        @media (prefers-color-scheme: dark) {
          .lp-brand-logo {
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          }
        }
        .lp-brand-logo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .lp-brand-text {
          display: flex;
          flex-direction: column;
        }
        .lp-brand-name {
          font-size: 1.1rem;
          font-weight: 700;
          color: #0F172A;
          line-height: 1.2;
        }
        @media (prefers-color-scheme: dark) {
          .lp-brand-name { color: #F8FAFC; }
        }
        .lp-brand-sub {
          font-size: 0.75rem;
          font-weight: 500;
          color: #64748B;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        /* Illustration container */
        .lp-illus {
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 40px;
        }

        /* Welcome text */}
        .lp-headline {
          font-size: 2.5rem;
          font-weight: 800;
          color: #0F172A;
          text-align: center;
          letter-spacing: -0.02em;
        }
        @media (prefers-color-scheme: dark) {
          .lp-headline { color: #F8FAFC; }
        }

        /* Hidden elements on left */}
        .lp-grid, .lp-centre, .lp-desc, .lp-pills {
          display: none;
        }

        /* ─────────────────────────────────────
           RIGHT PANEL — 50%
        ───────────────────────────────────────*/
        .lp-right {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px;
          background: #FFFFFF;
          overflow: auto;
        }
        @media (prefers-color-scheme: dark) {
          .lp-right { background: #1E293B; }
        }

        /* Card container */
        .lp-card {
          width: 100%;
          max-width: 420px;
          animation: card-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }
        @keyframes card-in {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        /* Card logo */}
        .lp-clogo {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          margin-bottom: 30px;
        }
        .lp-clogo-icon {
          width: 56px;
          height: 56px;
          border-radius: 14px;
          overflow: hidden;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
        }
        @media (prefers-color-scheme: dark) {
          .lp-clogo-icon {
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
          }
        }
        .lp-clogo-icon img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .lp-clogo-name {
          font-size: 1rem;
          font-weight: 700;
          color: #0F172A;
          text-align: center;
        }
        @media (prefers-color-scheme: dark) {
          .lp-clogo-name { color: #F8FAFC; }
        }
        .lp-clogo-tag {
          display: none;
        }

        /* Form heading */}
        .lp-card h1 {
          display: none;
        }
        .lp-sub {
          display: none;
        }

        /* Error message */}
        .lp-err {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px 14px;
          background: #FEF2F2;
          border: 1px solid #FCA5A5;
          border-radius: 10px;
          font-size: 0.875rem;
          color: #DC2626;
          margin-bottom: 16px;
          animation: shake 0.4s ease;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-6px); }
          75% { transform: translateX(6px); }
        }
        @media (prefers-color-scheme: dark) {
          .lp-err {
            background: rgba(220, 38, 38, 0.15);
            border-color: rgba(248, 113, 113, 0.3);
            color: #FCA5A5;
          }
        }

        /* Form fields */}
        .lp-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 16px;
        }
        .lp-lbl {
          font-size: 0.875rem;
          font-weight: 600;
          color: #334155;
          letter-spacing: 0.01em;
        }
        @media (prefers-color-scheme: dark) {
          .lp-lbl { color: #CBD5E1; }
        }

        .lp-wrap {
          position: relative;
        }
        .lp-inp {
          width: 100%;
          padding: 13px 16px;
          border: 2px solid #E2E8F0;
          border-radius: 10px;
          font-size: 0.9375rem;
          font-family: inherit;
          color: #0F172A;
          background: #F8FAFC;
          outline: none;
          transition: all 0.2s ease;
        }
        .lp-inp:focus {
          border-color: #0EA5E9;
          background: #FFFFFF;
          box-shadow: 0 0 0 4px rgba(14, 165, 233, 0.1);
        }
        .lp-inp::placeholder {
          color: #94A3B8;
        }
        @media (prefers-color-scheme: dark) {
          .lp-inp {
            background: #0F172A;
            border-color: #334155;
            color: #F8FAFC;
          }
          .lp-inp:focus {
            border-color: #38BDF8;
            background: #1E293B;
            box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.15);
          }
          .lp-inp::placeholder {
            color: #475569;
          }
        }
        .lp-inp-pw {
          padding-right: 46px;
        }

        /* Password toggle button */}
        .lp-eye {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          color: #94A3B8;
          display: flex;
          align-items: center;
          padding: 6px;
          border-radius: 6px;
          transition: all 0.2s;
          line-height: 0;
        }
        .lp-eye:hover {
          color: #0EA5E9;
          background: rgba(14, 165, 233, 0.1);
        }
        @media (prefers-color-scheme: dark) {
          .lp-eye {
            color: #475569;
          }
          .lp-eye:hover {
            color: #38BDF8;
            background: rgba(56, 189, 248, 0.1);
          }
        }

        /* OR divider */}
        .lp-or {
          display: flex;
          align-items: center;
          text-align: center;
          margin: 20px 0;
          color: #94A3B8;
          font-size: 0.875rem;
          font-weight: 500;
        }
        .lp-or::before,
        .lp-or::after {
          content: '';
          flex: 1;
          border-bottom: 1px solid #E2E8F0;
        }
        @media (prefers-color-scheme: dark) {
          .lp-or {
            color: #64748B;
          }
          .lp-or::before,
          .lp-or::after {
            border-color: #334155;
          }
        }
        .lp-or span {
          padding: 0 12px;
        }

        /* Options row */}
        .lp-opts {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
          gap: 8px;
        }
        .lp-rem {
          display: none;
        }
        .lp-chk {
          width: 16px;
          height: 16px;
          border-radius: 4px;
          cursor: pointer;
          accent-color: #0EA5E9;
          flex-shrink: 0;
        }
        .lp-forgot {
          font-size: 0.875rem;
          font-weight: 600;
          color: #0EA5E9;
          text-decoration: none;
          transition: color 0.2s;
          margin-left: auto;
        }
        .lp-forgot:hover {
          color: #0284C7;
          text-decoration: underline;
        }
        @media (prefers-color-scheme: dark) {
          .lp-forgot {
            color: #38BDF8;
          }
          .lp-forgot:hover {
            color: #7DD3FC;
          }
        }

        /* Submit button */}
        .lp-btn {
          width: 100%;
          padding: 14px;
          background: #0EA5E9;
          color: #FFFFFF;
          border: none;
          border-radius: 10px;
          font-size: 0.9375rem;
          font-weight: 700;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3);
        }
        .lp-btn:hover:not(:disabled) {
          background: #0284C7;
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(14, 165, 233, 0.4);
        }
        .lp-btn:active:not(:disabled) {
          transform: translateY(0);
        }
        .lp-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }
        @media (prefers-color-scheme: dark) {
          .lp-btn {
            background: #38BDF8;
            box-shadow: 0 4px 12px rgba(56, 189, 248, 0.3);
          }
          .lp-btn:hover:not(:disabled) {
            background: #0EA5E9;
            box-shadow: 0 6px 16px rgba(56, 189, 248, 0.4);
          }
        }
        .lp-spin {
          display: inline-block;
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: #FFFFFF;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
          vertical-align: middle;
          margin-right: 8px;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* Verify link */}
        .lp-div {
          height: 1px;
          background: linear-gradient(90deg, transparent, #E2E8F0 30%, #E2E8F0 70%, transparent);
          margin: 24px 0;
        }
        @media (prefers-color-scheme: dark) {
          .lp-div {
            background: linear-gradient(90deg, transparent, #334155 30%, #334155 70%, transparent);
          }
        }

        .lp-foot {
          text-align: center;
          font-size: 0.875rem;
          color: #64748B;
          line-height: 1.6;
        }
        .lp-foot a {
          color: #0EA5E9;
          font-weight: 600;
          text-decoration: none;
        }
        .lp-foot a:hover {
          text-decoration: underline;
        }
        @media (prefers-color-scheme: dark) {
          .lp-foot {
            color: #64748B;
          }
          .lp-foot a {
            color: #38BDF8;
          }
        }
        .lp-foot-lbl {
          display: block;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #94A3B8;
          margin-bottom: 4px;
        }
        @media (prefers-color-scheme: dark) {
          .lp-foot-lbl {
            color: #475569;
          }
        }
        .lp-vcode {
          font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
          font-size: 0.75rem;
          opacity: 0.6;
          margin-left: 4px;
        }

        /* ─────────────────────────────────────
           RESPONSIVE
        ───────────────────────────────────────*/
        @media (max-width: 1024px) {
          .lp {
            flex-direction: column;
          }
          .lp-hero {
            flex: 0 0 auto;
            min-height: 35vh;
            padding: 30px 24px;
          }
          .lp-brand {
            margin-bottom: 30px;
          }
          .lp-illus {
            margin-bottom: 20px;
          }
          .lp-headline {
            font-size: 2rem;
          }
          .lp-right {
            flex: 1;
            padding: 30px 24px;
          }
        }
        @media (max-width: 640px) {
          .lp-hero {
            min-height: 30vh;
            padding: 24px 20px;
          }
          .lp-headline {
            font-size: 1.75rem;
          }
          .lp-right {
            padding: 24px 20px;
          }
          .lp-card {
            max-width: 100%;
          }
        }
      `}</style>

      <div className="lp">

        {/* ══ LEFT HERO ══ */}
        <aside className="lp-hero" aria-hidden="true">
          <div className="lp-grid"/>
          <div className="lp-hi">

            {/* brand */}
            <div className="lp-brand">
              <div className="lp-brand-logo"><img src={logo} alt=""/></div>
              <div>
                <div className="lp-brand-name">Document Automation</div>
                <div className="lp-brand-sub">Enterprise Platform</div>
              </div>
            </div>

            {/* headline + desc */}
            <div className="lp-centre">
              <h2 className="lp-headline">
                Streamline.<br/><span>Automate.</span><br/>Execute.
              </h2>
              <p className="lp-desc">
                Your intelligent platform for documents&nbsp;&amp;&nbsp;workflows.
                Generate, approve, sign, verify, and deliver — end to end.
              </p>

              {/* animated SVG illustration */}
              <div className="lp-illus">
                <DocAutomationIllustration/>
              </div>
            </div>

            {/* footer pills */}
            <div className="lp-pills">
              {['Enterprise security','Role-based access','Full audit trail','Digital signatures'].map(t=>(
                <span key={t} className="lp-pill">{t}</span>
              ))}
            </div>

          </div>
        </aside>

        {/* ══ RIGHT LOGIN PANEL ══ */}
        <main className="lp-right">
          <div className="lp-card">

            <div className="lp-clogo">
              <div className="lp-clogo-icon"><img src={logo} alt="Document Automation"/></div>
              <div className="lp-clogo-name">Document Automation</div>
              <span className="lp-clogo-tag">Secure Portal</span>
            </div>

            <h1>Secure Access</h1>
            <p className="lp-sub">Sign in to your document automation workspace.</p>

            {error && (
              <div className="lp-err" role="alert" id="lp-err">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{flexShrink:0,marginTop:1}} aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate>
              <div className="lp-field">
                <label htmlFor="lp-email" className="lp-lbl">Work Email</label>
                <div className="lp-wrap">
                  <input id="lp-email" type="email" className="lp-inp"
                    value={email}
                    onChange={e=>{ setEmail(e.target.value); setError(null); }}
                    placeholder="you@yourcompany.com"
                    autoComplete="username" autoFocus required
                    aria-describedby={error?'lp-err':undefined}/>
                </div>
              </div>

              <div className="lp-field">
                <label htmlFor="lp-pw" className="lp-lbl">Password</label>
                <div className="lp-wrap">
                  <input id="lp-pw" type={showPw?'text':'password'}
                    className="lp-inp lp-inp-pw"
                    value={password}
                    onChange={e=>{ setPassword(e.target.value); setError(null); }}
                    placeholder="Enter your password"
                    autoComplete="current-password" required
                    aria-describedby={error?'lp-err':undefined}/>
                  <button type="button" className="lp-eye"
                    onClick={()=>setShowPw(v=>!v)}
                    aria-label={showPw?'Hide password':'Show password'}>
                    <EyeIcon off={showPw}/>
                  </button>
                </div>
              </div>

              <div className="lp-opts">
                <label className="lp-rem">
                  <input type="checkbox" className="lp-chk"
                    checked={remember} onChange={e=>setRemember(e.target.checked)}
                    aria-label="Keep me signed in"/>
                  Keep me signed in
                </label>
                <Link to="/forgot-password" className="lp-forgot">Forgot password?</Link>
              </div>

              <button type="submit" className="lp-btn" disabled={submitting} aria-busy={submitting}>
                {submitting
                  ? <><span className="lp-spin" aria-hidden="true"/>Signing in…</>
                  : 'SIGN IN'}
              </button>
            </form>

            <div className="lp-div" aria-hidden="true"/>
            <div className="lp-foot">
              <span className="lp-foot-lbl">Document Verification Portal</span>
              <Link to="/verify">
                Verify a document without signing in
                <span className="lp-vcode">/verify</span>
              </Link>
            </div>

          </div>
        </main>
      </div>
    </>
  );
}
