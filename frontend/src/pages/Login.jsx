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

/* ── Animated doc-automation SVG illustration ── */
function DocAutomationIllustration() {
  return (
    <svg viewBox="0 0 420 260" fill="none" xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true" style={{ width:'100%', maxWidth:420 }}>

      {/* ── node A: Template / Generate ── */}
      <rect x="12" y="90" width="84" height="80" rx="10"
        fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
      {/* doc icon */}
      <rect x="30" y="102" width="28" height="36" rx="3"
        fill="rgba(39,184,186,0.18)" stroke="rgba(39,184,186,0.5)" strokeWidth="1"/>
      <path d="M50 102 v8 h8" fill="none" stroke="rgba(39,184,186,0.6)" strokeWidth="1"/>
      <rect x="33" y="116" width="16" height="2" rx="1" fill="rgba(255,255,255,0.4)"/>
      <rect x="33" y="121" width="20" height="2" rx="1" fill="rgba(255,255,255,0.3)"/>
      <rect x="33" y="126" width="12" height="2" rx="1" fill="rgba(255,255,255,0.25)"/>
      {/* label */}
      <text x="54" y="141" textAnchor="middle" fill="rgba(232,238,247,0.6)"
        fontSize="7.5" fontFamily="'Plus Jakarta Sans',system-ui" fontWeight="600">Generate</text>

      {/* ── arrow A→B ── */}
      <path d="M96 130 L126 130" stroke="rgba(39,184,186,0.5)" strokeWidth="1.5"
        strokeDasharray="4 3" markerEnd="url(#arr)"/>
      <circle cx="111" cy="130" r="3" fill="rgba(39,184,186,0.4)">
        <animate attributeName="cx" from="96" to="126" dur="2s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0;1;0" dur="2s" repeatCount="indefinite"/>
      </circle>

      {/* ── node B: Approve ── */}
      <rect x="126" y="90" width="84" height="80" rx="10"
        fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
      {/* checkmark circle */}
      <circle cx="168" cy="120" r="18" fill="rgba(74,222,128,0.12)"
        stroke="rgba(74,222,128,0.4)" strokeWidth="1.2"/>
      <path d="M158 120 l7 7 13-13" stroke="#4ADE80" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round">
        <animate attributeName="stroke-dashoffset" from="30" to="0" dur="1.8s"
          repeatCount="indefinite"/>
        <animate attributeName="stroke-dasharray" values="0 30;30 0" dur="1.8s"
          repeatCount="indefinite"/>
      </path>
      <text x="168" y="155" textAnchor="middle" fill="rgba(232,238,247,0.6)"
        fontSize="7.5" fontFamily="'Plus Jakarta Sans',system-ui" fontWeight="600">Approve</text>

      {/* ── arrow B→C ── */}
      <path d="M210 130 L240 130" stroke="rgba(39,184,186,0.5)" strokeWidth="1.5"
        strokeDasharray="4 3" markerEnd="url(#arr)"/>
      <circle cx="210" cy="130" r="3" fill="rgba(39,184,186,0.4)">
        <animate attributeName="cx" from="210" to="240" dur="2s" begin="0.5s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0;1;0" dur="2s" begin="0.5s" repeatCount="indefinite"/>
      </circle>

      {/* ── node C: Sign ── */}
      <rect x="240" y="90" width="84" height="80" rx="10"
        fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
      {/* pen icon */}
      <path d="M270 135 L282 118 L290 125 L278 142 L268 144 Z"
        fill="rgba(251,191,36,0.15)" stroke="rgba(251,191,36,0.55)" strokeWidth="1.2"/>
      <line x1="279" y1="120" x2="288" y2="128" stroke="rgba(251,191,36,0.6)" strokeWidth="1.2"/>
      <line x1="268" y1="144" x2="296" y2="144" stroke="rgba(251,191,36,0.5)" strokeWidth="1.2"
        strokeDasharray="3 2"/>
      <text x="282" y="155" textAnchor="middle" fill="rgba(232,238,247,0.6)"
        fontSize="7.5" fontFamily="'Plus Jakarta Sans',system-ui" fontWeight="600">Sign</text>

      {/* ── arrow C→D ── */}
      <path d="M324 130 L354 130" stroke="rgba(39,184,186,0.5)" strokeWidth="1.5"
        strokeDasharray="4 3" markerEnd="url(#arr)"/>
      <circle cx="324" cy="130" r="3" fill="rgba(39,184,186,0.4)">
        <animate attributeName="cx" from="324" to="354" dur="2s" begin="1s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0;1;0" dur="2s" begin="1s" repeatCount="indefinite"/>
      </circle>

      {/* ── node D: Deliver ── */}
      <rect x="354" y="90" width="52" height="80" rx="10"
        fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
      {/* envelope */}
      <rect x="364" y="114" width="32" height="22" rx="3"
        fill="rgba(79,140,201,0.12)" stroke="rgba(79,140,201,0.5)" strokeWidth="1"/>
      <path d="M364 116 l16 11 16-11" stroke="rgba(79,140,201,0.7)"
        strokeWidth="1.2" fill="none"/>
      <text x="380" y="155" textAnchor="middle" fill="rgba(232,238,247,0.6)"
        fontSize="7.5" fontFamily="'Plus Jakarta Sans',system-ui" fontWeight="600">Deliver</text>

      {/* ── secure verify badge (centre, floating) ── */}
      <g>
        <animateTransform attributeName="transform" type="translate"
          values="0,0;0,-6;0,0" dur="4s" repeatCount="indefinite"/>
        <circle cx="210" cy="46" r="26"
          fill="rgba(21,154,156,0.14)" stroke="rgba(21,154,156,0.4)" strokeWidth="1.5">
          <animate attributeName="r" values="26;28;26" dur="3s" repeatCount="indefinite"/>
          <animate attributeName="stroke-opacity" values="0.4;0.7;0.4" dur="3s" repeatCount="indefinite"/>
        </circle>
        <path d="M210 26 L196 32 v12 c0 8 6.4 15.4 14 17.4 7.6-2 14-9.4 14-17.4 V32 Z"
          fill="rgba(21,154,156,0.3)" stroke="rgba(21,154,156,0.7)" strokeWidth="1.2"/>
        <path d="M203 46 l4.5 4.5 8.5-8.5" stroke="white" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"/>
        <text x="210" y="72" textAnchor="middle" fill="rgba(39,184,186,0.8)"
          fontSize="7" fontFamily="'Plus Jakarta Sans',system-ui" fontWeight="700"
          letterSpacing="0.08em">VERIFIED</text>
      </g>

      {/* ── connector lines from nodes up to verify badge ── */}
      <path d="M168 90 Q168 65 185 52" stroke="rgba(39,184,186,0.2)"
        strokeWidth="1" strokeDasharray="3 3" fill="none"/>
      <path d="M282 90 Q282 65 235 52" stroke="rgba(39,184,186,0.2)"
        strokeWidth="1" strokeDasharray="3 3" fill="none"/>

      {/* ── floating small doc snippets ── */}
      <g opacity="0.55">
        <animateTransform attributeName="transform" type="translate"
          values="0,0;0,-4;0,0" dur="5.5s" repeatCount="indefinite"/>
        <rect x="18" y="195" width="52" height="40" rx="6"
          fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" strokeWidth="0.8"/>
        <rect x="24" y="201" width="28" height="2" rx="1" fill="rgba(39,184,186,0.5)"/>
        <rect x="24" y="207" width="36" height="2" rx="1" fill="rgba(255,255,255,0.2)"/>
        <rect x="24" y="213" width="24" height="2" rx="1" fill="rgba(255,255,255,0.15)"/>
        <rect x="24" y="225" width="36" height="6" rx="3"
          fill="rgba(74,222,128,0.12)" stroke="rgba(74,222,128,0.35)" strokeWidth="0.8"/>
        <text x="42" y="230" textAnchor="middle" fill="rgba(74,222,128,0.8)"
          fontSize="5.5" fontFamily="'Plus Jakarta Sans',system-ui" fontWeight="700">✓ SIGNED</text>
      </g>

      <g opacity="0.5">
        <animateTransform attributeName="transform" type="translate"
          values="0,0;0,-5;0,0" dur="6.5s" begin="1s" repeatCount="indefinite"/>
        <rect x="348" y="192" width="52" height="40" rx="6"
          fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" strokeWidth="0.8"/>
        <rect x="354" y="198" width="32" height="2" rx="1" fill="rgba(79,140,201,0.5)"/>
        <rect x="354" y="204" width="24" height="2" rx="1" fill="rgba(255,255,255,0.2)"/>
        <rect x="354" y="210" width="36" height="2" rx="1" fill="rgba(255,255,255,0.15)"/>
        <rect x="354" y="222" width="36" height="6" rx="3"
          fill="rgba(79,140,201,0.12)" stroke="rgba(79,140,201,0.35)" strokeWidth="0.8"/>
        <text x="372" y="227" textAnchor="middle" fill="rgba(79,140,201,0.8)"
          fontSize="5.5" fontFamily="'Plus Jakarta Sans',system-ui" fontWeight="700">DELIVERED</text>
      </g>

      {/* ── QR snippet bottom center ── */}
      <g opacity="0.45">
        <animateTransform attributeName="transform" type="translate"
          values="0,0;0,-3;0,0" dur="7s" begin="2s" repeatCount="indefinite"/>
        <rect x="174" y="198" width="72" height="52" rx="6"
          fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" strokeWidth="0.8"/>
        {/* tiny QR pattern */}
        {[0,1,2,3,4,5].map(i => (
          [0,1,2,3,4,5].map(j => (
            Math.random() > 0.45 ? (
              <rect key={`${i}-${j}`}
                x={180 + j*9} y={204 + i*7} width="7" height="5" rx="1"
                fill={`rgba(39,184,186,${0.3 + Math.random()*0.3})`}/>
            ) : null
          ))
        ))}
        <text x="210" y="256" textAnchor="middle" fill="rgba(39,184,186,0.6)"
          fontSize="5.5" fontFamily="'Plus Jakarta Sans',system-ui" fontWeight="700"
          letterSpacing="0.06em">SCAN TO VERIFY</text>
      </g>

      {/* arrow marker */}
      <defs>
        <marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6Z" fill="rgba(39,184,186,0.6)"/>
        </marker>
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
           PAGE SHELL — fixed 100vh, no scroll
        ───────────────────────────────────────*/
        .lp {
          display: flex;
          width: 100vw;
          height: 100vh;
          overflow: hidden;          /* ← the ONE rule that kills all scroll */
          font-family: 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif;
          background: #0F2747;
        }

        /* ─────────────────────────────────────
           LEFT HERO — 55 %
        ───────────────────────────────────────*/
        .lp-hero {
          flex: 0 0 55%;
          position: relative;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 28px 40px 24px 40px;
          overflow: hidden;
          background: linear-gradient(148deg, #0A1E38 0%, #0F2747 50%, #0C2040 100%);
        }

        /* animated radial orbs */
        .lp-hero::before {
          content:'';
          position:absolute;
          width:520px; height:520px; border-radius:50%;
          background:radial-gradient(circle,rgba(21,154,156,0.16) 0%,transparent 70%);
          top:-110px; left:-70px;
          animation:orb 14s ease-in-out infinite alternate;
          pointer-events:none;
        }
        .lp-hero::after {
          content:'';
          position:absolute;
          width:380px; height:380px; border-radius:50%;
          background:radial-gradient(circle,rgba(79,140,201,0.13) 0%,transparent 70%);
          bottom:-90px; right:-50px;
          animation:orb 18s ease-in-out infinite alternate-reverse;
          pointer-events:none;
        }
        @keyframes orb {
          from { transform:translate(0,0) scale(1); }
          to   { transform:translate(28px,18px) scale(1.07); }
        }
        @media (prefers-reduced-motion:reduce) {
          .lp-hero::before,.lp-hero::after { animation:none; }
        }

        /* grid */
        .lp-grid {
          position:absolute; inset:0;
          background-image:
            linear-gradient(rgba(255,255,255,0.022) 1px,transparent 1px),
            linear-gradient(90deg,rgba(255,255,255,0.022) 1px,transparent 1px);
          background-size:40px 40px;
          pointer-events:none;
        }

        .lp-hi { position:relative; z-index:1; display:flex; flex-direction:column; height:100%; }

        /* brand */
        .lp-brand {
          display:flex; align-items:center; gap:11px; margin-bottom:0;
          flex-shrink:0;
        }
        .lp-brand-logo {
          width:36px; height:36px; border-radius:9px; overflow:hidden;
          flex-shrink:0; box-shadow:0 2px 10px rgba(0,0,0,0.35);
        }
        .lp-brand-logo img { width:100%; height:100%; object-fit:cover; }
        .lp-brand-name {
          font-size:0.88rem; font-weight:800; letter-spacing:0.1em;
          text-transform:uppercase; color:#fff;
        }
        .lp-brand-sub {
          font-size:0.58rem; font-weight:600; letter-spacing:0.18em;
          text-transform:uppercase; color:#27B8BA; margin-top:2px;
        }

        /* centre block — takes available space */
        .lp-centre {
          flex:1;
          display:flex; flex-direction:column; justify-content:center;
          padding:12px 0 8px;
          min-height:0;
        }

        .lp-headline {
          font-size:clamp(1.45rem,2.4vw,2.1rem);
          font-weight:800; letter-spacing:-0.03em;
          color:#fff; line-height:1.15; margin-bottom:10px;
        }
        .lp-headline span {
          background:linear-gradient(90deg,#27B8BA,#6EE7E5);
          -webkit-background-clip:text; -webkit-text-fill-color:transparent;
          background-clip:text;
        }
        .lp-desc {
          font-size:0.82rem; color:rgba(232,238,247,0.58);
          line-height:1.6; max-width:340px; margin-bottom:14px;
        }

        /* illustration wrapper — fills remaining vertical space */
        .lp-illus {
          flex:1; min-height:0;
          display:flex; align-items:center; justify-content:flex-start;
          overflow:hidden;
        }

        /* footer pills */
        .lp-pills { display:flex; flex-wrap:wrap; gap:7px; flex-shrink:0; }
        .lp-pill {
          padding:3px 11px; border-radius:20px;
          font-size:0.63rem; font-weight:500;
          color:rgba(232,238,247,0.45);
          background:rgba(255,255,255,0.05);
          border:1px solid rgba(255,255,255,0.07);
        }

        /* ─────────────────────────────────────
           RIGHT PANEL — 45 %
        ───────────────────────────────────────*/
        .lp-right {
          flex:1; display:flex; align-items:center; justify-content:center;
          padding:20px 28px;
          background:#F4F6FA;
          overflow:hidden;           /* no scroll on right either */
        }
        @media (prefers-color-scheme:dark) { .lp-right { background:#07111F; } }

        /* card — compact */
        .lp-card {
          width:100%; max-width:360px;
          background:#fff; border-radius:18px;
          padding:28px 28px 24px;
          box-shadow:
            0 0 0 1px rgba(0,0,0,0.06),
            0 4px 12px rgba(0,0,0,0.07),
            0 18px 44px rgba(0,0,0,0.10);
          animation:card-in .45s cubic-bezier(0.22,1,0.36,1) both;
        }
        @keyframes card-in {
          from{opacity:0;transform:translateY(14px) scale(0.98);}
          to  {opacity:1;transform:translateY(0) scale(1);}
        }
        @media (prefers-color-scheme:dark) {
          .lp-card {
            background:#111C2E;
            box-shadow:0 0 0 1px rgba(255,255,255,0.06),0 4px 12px rgba(0,0,0,0.4),0 18px 44px rgba(0,0,0,0.55);
          }
        }

        /* card logo */
        .lp-clogo {
          display:flex; flex-direction:column; align-items:center; gap:7px; margin-bottom:18px;
        }
        .lp-clogo-icon {
          width:44px; height:44px; border-radius:12px; overflow:hidden;
          box-shadow:0 3px 12px rgba(15,39,71,0.22);
        }
        .lp-clogo-icon img { width:100%; height:100%; object-fit:cover; }
        .lp-clogo-name {
          font-size:0.75rem; font-weight:800; letter-spacing:0.1em;
          text-transform:uppercase; color:#0F2747;
        }
        @media (prefers-color-scheme:dark) { .lp-clogo-name { color:#E8EEF7; } }
        .lp-clogo-tag {
          font-size:0.58rem; font-weight:700; letter-spacing:0.14em;
          text-transform:uppercase; color:#159A9C;
          background:rgba(21,154,156,0.09); padding:2px 9px;
          border-radius:20px; margin-top:-3px;
        }

        /* heading */
        .lp-card h1 {
          font-family:'Plus Jakarta Sans','Inter',system-ui,sans-serif;
          font-size:1.35rem; font-weight:800; letter-spacing:-0.025em;
          color:#0F2747; margin-bottom:2px; line-height:1.2;
        }
        @media (prefers-color-scheme:dark) { .lp-card h1 { color:#F0F6FF; } }
        .lp-sub {
          font-size:0.8rem; color:#64748B; margin-bottom:18px; line-height:1.45;
        }
        @media (prefers-color-scheme:dark) { .lp-sub { color:#9BAAC0; } }

        /* error */
        .lp-err {
          display:flex; align-items:flex-start; gap:8px;
          padding:9px 11px; background:#FEF2F2;
          border:1px solid #FECACA; border-radius:8px;
          font-size:0.78rem; color:#DC2626; margin-bottom:12px;
          animation:shake .3s ease;
        }
        @keyframes shake {
          0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)}
        }
        @media (prefers-color-scheme:dark) {
          .lp-err{background:rgba(220,38,38,.12);border-color:rgba(248,113,113,.3);color:#F87171;}
        }

        /* fields */
        .lp-field { display:flex; flex-direction:column; gap:4px; margin-bottom:11px; }
        .lp-lbl { font-size:0.73rem; font-weight:600; color:#374151; letter-spacing:0.01em; }
        @media (prefers-color-scheme:dark) { .lp-lbl { color:#9BAAC0; } }

        .lp-wrap { position:relative; }
        .lp-inp {
          width:100%; padding:9px 12px;
          border:1.5px solid #E2E8F0; border-radius:8px;
          font-size:0.88rem; font-family:inherit; color:#172033;
          background:#F8FAFC; outline:none;
          transition:border-color .18s,box-shadow .18s,background .18s;
        }
        .lp-inp:focus {
          border-color:#159A9C; background:#fff;
          box-shadow:0 0 0 3px rgba(21,154,156,0.14);
        }
        .lp-inp::placeholder { color:#9CA3AF; }
        @media (prefers-color-scheme:dark) {
          .lp-inp{background:#17243A;border-color:#26364D;color:#E8EEF7;}
          .lp-inp:focus{border-color:#27B8BA;background:#1A2E4A;box-shadow:0 0 0 3px rgba(39,184,186,.14);}
          .lp-inp::placeholder{color:#3D546E;}
        }
        .lp-inp-pw { padding-right:40px; }

        .lp-eye {
          position:absolute; right:10px; top:50%; transform:translateY(-50%);
          background:none; border:none; cursor:pointer; color:#9CA3AF;
          display:flex; align-items:center; padding:4px; border-radius:5px;
          transition:color .15s; line-height:0;
        }
        .lp-eye:hover { color:#159A9C; }
        @media (prefers-color-scheme:dark) {
          .lp-eye{color:#3D546E;} .lp-eye:hover{color:#27B8BA;}
        }

        /* options row */
        .lp-opts {
          display:flex; align-items:center; justify-content:space-between;
          margin-bottom:16px; gap:6px; flex-wrap:wrap;
        }
        .lp-rem {
          display:flex; align-items:center; gap:6px;
          cursor:pointer; font-size:0.76rem; color:#374151; user-select:none;
        }
        @media (prefers-color-scheme:dark) { .lp-rem { color:#9BAAC0; } }
        .lp-chk { width:13px; height:13px; border-radius:3px; cursor:pointer; accent-color:#159A9C; flex-shrink:0; }
        .lp-forgot {
          font-size:0.76rem; font-weight:600; color:#159A9C;
          text-decoration:none; transition:color .15s;
        }
        .lp-forgot:hover { color:#0E7E80; text-decoration:underline; }
        @media (prefers-color-scheme:dark) {
          .lp-forgot{color:#27B8BA;} .lp-forgot:hover{color:#6EE7E5;}
        }

        /* submit */
        .lp-btn {
          width:100%; padding:10px;
          background:linear-gradient(135deg,#159A9C 0%,#0E7E80 100%);
          color:#fff; border:none; border-radius:9px;
          font-size:0.8rem; font-weight:700; font-family:inherit;
          letter-spacing:0.08em; text-transform:uppercase;
          cursor:pointer; transition:opacity .2s,transform .15s,box-shadow .2s;
          box-shadow:0 4px 14px rgba(21,154,156,0.36);
        }
        .lp-btn:hover:not(:disabled){opacity:.9;transform:translateY(-1px);box-shadow:0 6px 18px rgba(21,154,156,.46);}
        .lp-btn:active:not(:disabled){transform:translateY(0);}
        .lp-btn:disabled{opacity:.6;cursor:not-allowed;transform:none;}
        .lp-spin {
          display:inline-block; width:12px; height:12px;
          border:2px solid rgba(255,255,255,.3); border-top-color:#fff;
          border-radius:50%; animation:spin .6s linear infinite;
          vertical-align:middle; margin-right:6px;
        }
        @keyframes spin{to{transform:rotate(360deg)}}

        /* divider */
        .lp-div {
          height:1px;
          background:linear-gradient(90deg,transparent,#E2E8F0 30%,#E2E8F0 70%,transparent);
          margin:16px 0 13px;
        }
        @media (prefers-color-scheme:dark) {
          .lp-div{background:linear-gradient(90deg,transparent,#26364D 30%,#26364D 70%,transparent);}
        }

        /* footer */
        .lp-foot { text-align:center; font-size:0.73rem; color:#9CA3AF; line-height:1.45; }
        .lp-foot a { color:#159A9C; font-weight:600; text-decoration:none; }
        .lp-foot a:hover { text-decoration:underline; }
        @media (prefers-color-scheme:dark) { .lp-foot{color:#3D546E;} .lp-foot a{color:#27B8BA;} }
        .lp-foot-lbl {
          display:block; font-size:0.64rem; text-transform:uppercase;
          letter-spacing:0.07em; color:#CBD5E1; margin-bottom:2px;
        }
        @media (prefers-color-scheme:dark) { .lp-foot-lbl{color:#26364D;} }
        .lp-vcode {
          font-family:'SFMono-Regular',Consolas,monospace;
          font-size:0.68rem; opacity:.6; margin-left:2px;
        }

        /* ─────────────────────────────────────
           RESPONSIVE — tablet / mobile
           Layout stacks but stays scroll-free
        ───────────────────────────────────────*/
        @media (max-width:900px) {
          .lp { flex-direction:column; }
          .lp-hero { flex:0 0 auto; padding:20px 24px 18px; }
          .lp-illus { display:none; }
          .lp-desc  { margin-bottom:8px; }
          .lp-pills { display:none; }
          .lp-centre { padding:8px 0 4px; }
          .lp-right { flex:1; padding:16px 20px; }
          .lp-card  { max-width:420px; }
        }
        @media (max-width:540px) {
          .lp-hero  { padding:16px 16px 14px; }
          .lp-headline { font-size:1.25rem; }
          .lp-right { padding:14px 12px; }
          .lp-card  { padding:22px 18px 18px; border-radius:14px; }
          .lp-card h1 { font-size:1.2rem; }
        }
        @media (max-width:380px) {
          .lp-card { padding:18px 14px 16px; }
          .lp-card h1 { font-size:1.1rem; }
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
