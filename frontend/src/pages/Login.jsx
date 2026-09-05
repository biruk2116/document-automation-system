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
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

/* ── Document automation illustration matching the image exactly ── */
function DocAutomationIllustration() {
  return (
    <svg viewBox="0 0 220 200" fill="none" xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true" style={{ width: '100%', maxWidth: 220 }}>
      
      {/* Back document */}
      <g opacity="0.6">
        <rect x="90" y="50" width="80" height="105" rx="6"
          fill="var(--doc-bg)" stroke="var(--doc-stroke)" strokeWidth="2"/>
        <rect x="100" y="65" width="45" height="3" rx="1.5" fill="var(--doc-line)"/>
        <rect x="100" y="73" width="55" height="3" rx="1.5" fill="var(--doc-line)"/>
        <rect x="100" y="81" width="40" height="3" rx="1.5" fill="var(--doc-line)"/>
      </g>

      {/* Middle document */}
      <g opacity="0.8">
        <animateTransform attributeName="transform" type="translate"
          values="0,0;-1,-1;0,0" dur="3s" repeatCount="indefinite"/>
        <rect x="70" y="35" width="80" height="105" rx="6"
          fill="var(--doc-bg)" stroke="var(--doc-stroke)" strokeWidth="2"/>
        <rect x="80" y="50" width="45" height="3" rx="1.5" fill="var(--doc-line)"/>
        <rect x="80" y="58" width="55" height="3" rx="1.5" fill="var(--doc-line)"/>
        <rect x="80" y="66" width="40" height="3" rx="1.5" fill="var(--doc-line)"/>
        <rect x="80" y="78" width="50" height="3" rx="1.5" fill="var(--doc-line)"/>
        <rect x="80" y="86" width="45" height="3" rx="1.5" fill="var(--doc-line)"/>
      </g>

      {/* Front document with checkmark */}
      <g>
        <animateTransform attributeName="transform" type="translate"
          values="0,0;-2,-2;0,0" dur="4s" repeatCount="indefinite"/>
        <rect x="50" y="20" width="80" height="105" rx="6"
          fill="var(--doc-bg-front)" stroke="var(--doc-stroke-front)" strokeWidth="2.5"/>
        <rect x="60" y="35" width="45" height="3" rx="1.5" fill="var(--doc-line)"/>
        <rect x="60" y="43" width="55" height="3" rx="1.5" fill="var(--doc-line)"/>
        <rect x="60" y="51" width="40" height="3" rx="1.5" fill="var(--doc-line)"/>
        <rect x="60" y="63" width="50" height="3" rx="1.5" fill="var(--doc-line)"/>
        <rect x="60" y="71" width="45" height="3" rx="1.5" fill="var(--doc-line)"/>
        <rect x="60" y="79" width="38" height="3" rx="1.5" fill="var(--doc-line)"/>
        
        {/* Checkmark circle */}
        <circle cx="90" cy="100" r="18" fill="var(--check-bg)" stroke="var(--check-stroke)" strokeWidth="2.5">
          <animate attributeName="opacity" values="1;0.85;1" dur="2s" repeatCount="indefinite"/>
        </circle>
        <path d="M80 100 l6 6 12-12" stroke="var(--check-mark)" strokeWidth="3"
          strokeLinecap="round" strokeLinejoin="round">
          <animate attributeName="stroke-dashoffset" from="25" to="0" dur="2s" repeatCount="indefinite"/>
          <animate attributeName="stroke-dasharray" values="0 25;25 0" dur="2s" repeatCount="indefinite"/>
        </path>
      </g>

      {/* Left curved arrow */}
      <g>
        <path d="M 55 60 Q 25 60 25 35" stroke="var(--arrow-color)" strokeWidth="3"
          fill="none" strokeLinecap="round" opacity="0.7">
          <animate attributeName="stroke-dashoffset" from="70" to="0" dur="3s" repeatCount="indefinite"/>
          <animate attributeName="stroke-dasharray" values="0 70;70 0" dur="3s" repeatCount="indefinite"/>
        </path>
        <circle cx="25" cy="32" r="2.5" fill="var(--arrow-color)">
          <animate attributeName="opacity" values="0;1;0" dur="3s" repeatCount="indefinite"/>
        </circle>
      </g>

      {/* Right curved arrow */}
      <g>
        <path d="M 125 105 Q 175 105 175 75" stroke="var(--arrow-color)" strokeWidth="3"
          fill="none" strokeLinecap="round" opacity="0.7">
          <animate attributeName="stroke-dashoffset" from="70" to="0" dur="3s" begin="1s" repeatCount="indefinite"/>
          <animate attributeName="stroke-dasharray" values="0 70;70 0" dur="3s" begin="1s" repeatCount="indefinite"/>
        </path>
        <circle cx="175" cy="72" r="2.5" fill="var(--arrow-color)">
          <animate attributeName="opacity" values="0;1;0" dur="3s" begin="1s" repeatCount="indefinite"/>
        </circle>
      </g>

      {/* Gear icon - top right */}
      <g opacity="0.8">
        <animateTransform attributeName="transform" type="rotate"
          values="0 175 45; 360 175 45" dur="8s" repeatCount="indefinite"/>
        <circle cx="175" cy="45" r="16" fill="var(--gear-bg)" stroke="var(--gear-stroke)" strokeWidth="2.5"/>
        <circle cx="175" cy="45" r="6" fill="var(--gear-center)"/>
        {[0, 60, 120, 180, 240, 300].map((angle, i) => (
          <rect key={i}
            x="173" y="29" width="4" height="7" rx="2"
            fill="var(--gear-stroke)"
            transform={`rotate(${angle} 175 45)`}/>
        ))}
      </g>

      {/* Water drop - bottom left */}
      <g opacity="0.7">
        <animateTransform attributeName="transform" type="translate"
          values="0,0;0,-2;0,0" dur="2.5s" repeatCount="indefinite"/>
        <ellipse cx="35" cy="110" rx="10" ry="13" fill="var(--drop-color)" opacity="0.4"/>
        <ellipse cx="35" cy="108" rx="8" ry="11" fill="var(--drop-color)"/>
        <circle cx="35" cy="104" r="2.5" fill="var(--drop-highlight)" opacity="0.7"/>
      </g>

      {/* Define CSS variables for theming */}
      <defs>
        <style>{`
          :root {
            --doc-bg: rgba(230, 240, 250, 0.8);
            --doc-bg-front: #E6F0FA;
            --doc-stroke: #4A9FD8;
            --doc-stroke-front: #3B8FC7;
            --doc-line: #7FBCE6;
            --check-bg: #2DD4BF;
            --check-stroke: #14B8A6;
            --check-mark: #FFFFFF;
            --arrow-color: #3B8FC7;
            --gear-bg: #4A9FD8;
            --gear-stroke: #2D7DB5;
            --gear-center: #E6F0FA;
            --drop-color: #3B8FC7;
            --drop-highlight: rgba(255, 255, 255, 0.8);
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --doc-bg: rgba(60, 80, 100, 0.5);
              --doc-bg-front: #3C5064;
              --doc-stroke: #5BA3D0;
              --doc-stroke-front: #4A9FD8;
              --doc-line: #5BA3D0;
              --check-bg: #2DD4BF;
              --check-stroke: #14B8A6;
              --check-mark: #FFFFFF;
              --arrow-color: #5BA3D0;
              --gear-bg: #5BA3D0;
              --gear-stroke: #3B8FC7;
              --gear-center: #2C3E50;
              --drop-color: #5BA3D0;
              --drop-highlight: rgba(255, 255, 255, 0.5);
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
        /* Reset */
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        /* Page container */
        .lp {
          display: flex;
          width: 100vw;
          height: 100vh;
          overflow: hidden;
          font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Roboto', 'Arial', sans-serif;
          background: #FFFFFF;
        }
        @media (prefers-color-scheme: dark) {
          .lp { background: #1A2332; }
        }

        /* LEFT SIDE */
        .lp-hero {
          flex: 0 0 50%;
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
          padding: 60px 50px;
          background: linear-gradient(150deg, #0A1E38 0%, #0F2747 45%, #0C2244 100%);
          overflow: hidden;
        }
        @media (prefers-color-scheme: dark) {
          .lp-hero { background: linear-gradient(150deg, #0A1E38 0%, #0F2747 45%, #0C2244 100%); }
        }

        /* Animated orbs */
        .lp-hero::before {
          content: '';
          position: absolute;
          width: 500px;
          height: 500px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(21,154,156,0.15) 0%, transparent 70%);
          top: -80px;
          left: -60px;
          animation: orb-float 16s ease-in-out infinite alternate;
          pointer-events: none;
        }
        .lp-hero::after {
          content: '';
          position: absolute;
          width: 360px;
          height: 360px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(79,140,201,0.12) 0%, transparent 70%);
          bottom: -80px;
          right: -40px;
          animation: orb-float 20s ease-in-out infinite alternate-reverse;
          pointer-events: none;
        }
        @keyframes orb-float {
          from { transform: translate(0,0) scale(1); }
          to { transform: translate(20px,15px) scale(1.06); }
        }

        /* Grid pattern */
        .lp-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
          background-size: 44px 44px;
          pointer-events: none;
        }

        .lp-hi {
          position: relative;
          z-index: 1;
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          flex: 1;
          justify-content: center;
        }

        .lp-brand {
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
        .lp-brand-logo {
          width: 56px;
          height: 56px;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 2px 10px rgba(0,0,0,0.35);
        }
        .lp-brand-logo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .lp-brand-name {
          font-size: 0.95rem;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #FFFFFF;
          text-align: center;
          animation: title-glow 3s ease-in-out infinite;
        }
        @keyframes title-glow {
          0%, 100% { opacity: 1; text-shadow: 0 0 10px rgba(39,184,186,0.3); }
          50% { opacity: 0.9; text-shadow: 0 0 20px rgba(39,184,186,0.5); }
        }

        .lp-illus {
          display: flex;
          justify-content: center;
          width: 100%;
          margin-bottom: 40px;
        }

        /* Animated descriptive section */
        .lp-headline {
          display: block;
          text-align: center;
          max-width: 420px;
          margin: 0 auto;
        }
        .lp-headline-title {
          font-size: 2.2rem;
          font-weight: 800;
          color: #FFFFFF;
          letter-spacing: -0.02em;
          line-height: 1.2;
          margin-bottom: 16px;
          animation: fade-in-up 1s ease-out;
        }
        .lp-headline-title span {
          background: linear-gradient(90deg, #27B8BA, #6EE7E5);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: gradient-shift 3s ease-in-out infinite;
        }
        @keyframes gradient-shift {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(1.3); }
        }
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .lp-headline-desc {
          font-size: 0.95rem;
          color: rgba(232,238,247,0.65);
          line-height: 1.7;
          animation: fade-in-up 1s ease-out 0.2s both;
        }
        .lp-headline-desc strong {
          color: rgba(232,238,247,0.9);
          font-weight: 600;
        }

        /* Feature highlights */
        .lp-features {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          margin-top: 32px;
          max-width: 420px;
          margin-left: auto;
          margin-right: auto;
          animation: fade-in-up 1s ease-out 0.4s both;
        }
        .lp-feature {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 14px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          transition: all 0.3s ease;
        }
        .lp-feature:hover {
          background: rgba(39,184,186,0.08);
          border-color: rgba(39,184,186,0.3);
          transform: translateY(-2px);
        }
        .lp-feature-icon {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: rgba(39,184,186,0.15);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .lp-feature-text {
          font-size: 0.8rem;
          color: rgba(232,238,247,0.7);
          font-weight: 500;
        }

        /* RIGHT SIDE */
        .lp-right {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 60px 50px;
          background: #FAFAFA;
        }
        @media (prefers-color-scheme: dark) {
          .lp-right { background: #1A2332; }
        }

        .lp-card {
          width: 100%;
          max-width: 380px;
        }

        /* Error */
        .lp-err {
          display: flex;
          gap: 10px;
          padding: 12px 16px;
          background: #FEE2E2;
          border: 1px solid #FCA5A5;
          border-radius: 8px;
          font-size: 0.875rem;
          color: #DC2626;
          margin-bottom: 20px;
        }
        @media (prefers-color-scheme: dark) {
          .lp-err {
            background: rgba(220, 38, 38, 0.15);
            border-color: rgba(248, 113, 113, 0.3);
            color: #FCA5A5;
          }
        }

        /* Form fields */
        .lp-field {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 20px;
        }
        .lp-lbl {
          font-size: 0.9375rem;
          font-weight: 500;
          color: #1A1A1A;
        }
        @media (prefers-color-scheme: dark) {
          .lp-lbl { color: #E5E7EB; }
        }

        .lp-wrap {
          position: relative;
        }
        .lp-inp {
          width: 100%;
          padding: 12px 16px;
          border: 1px solid #D1D5DB;
          border-radius: 6px;
          font-size: 0.9375rem;
          font-family: inherit;
          color: #1A1A1A;
          background: #FFFFFF;
          outline: none;
          transition: all 0.2s;
        }
        .lp-inp:focus {
          border-color: #14B8A6;
          box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.1);
        }
        .lp-inp::placeholder {
          color: #9CA3AF;
        }
        @media (prefers-color-scheme: dark) {
          .lp-inp {
            background: #2C3E50;
            border-color: #4B5563;
            color: #FFFFFF;
          }
          .lp-inp:focus {
            border-color: #14B8A6;
            box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.2);
          }
          .lp-inp::placeholder {
            color: #6B7280;
          }
        }
        .lp-inp-pw {
          padding-right: 48px;
        }

        /* Password toggle */
        .lp-eye {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          color: #6B7280;
          padding: 4px;
          transition: color 0.2s;
        }
        .lp-eye:hover {
          color: #14B8A6;
        }
        @media (prefers-color-scheme: dark) {
          .lp-eye { color: #9CA3AF; }
          .lp-eye:hover { color: #14B8A6; }
        }

        /* OR divider */
        .lp-or {
          display: flex;
          align-items: center;
          margin: 24px 0;
          color: #6B7280;
          font-size: 0.875rem;
          font-weight: 500;
        }
        .lp-or::before,
        .lp-or::after {
          content: '';
          flex: 1;
          border-bottom: 1px solid #D1D5DB;
        }
        @media (prefers-color-scheme: dark) {
          .lp-or { color: #9CA3AF; }
          .lp-or::before,
          .lp-or::after { border-color: #4B5563; }
        }
        .lp-or span {
          padding: 0 16px;
        }

        /* Forgot password */
        .lp-opts {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 24px;
        }
        .lp-forgot {
          font-size: 0.875rem;
          font-weight: 500;
          color: #6B7280;
          text-decoration: none;
          transition: color 0.2s;
        }
        .lp-forgot:hover {
          color: #14B8A6;
        }
        @media (prefers-color-scheme: dark) {
          .lp-forgot { color: #9CA3AF; }
          .lp-forgot:hover { color: #14B8A6; }
        }

        /* Submit button */
        .lp-btn {
          width: 100%;
          padding: 13px 20px;
          background: #14B8A6;
          color: #FFFFFF;
          border: none;
          border-radius: 6px;
          font-size: 0.9375rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 2px 8px rgba(20, 184, 166, 0.25);
        }
        .lp-btn:hover:not(:disabled) {
          background: #0D9488;
          box-shadow: 0 4px 12px rgba(20, 184, 166, 0.35);
        }
        .lp-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        @media (prefers-color-scheme: dark) {
          .lp-btn {
            background: #14B8A6;
            box-shadow: 0 2px 8px rgba(20, 184, 166, 0.3);
          }
          .lp-btn:hover:not(:disabled) {
            background: #0D9488;
            box-shadow: 0 4px 12px rgba(20, 184, 166, 0.4);
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
          margin-right: 8px;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* Verify link */
        .lp-div {
          height: 1px;
          background: #E5E7EB;
          margin: 28px 0;
        }
        @media (prefers-color-scheme: dark) {
          .lp-div { background: #374151; }
        }

        .lp-foot {
          text-align: center;
          font-size: 0.875rem;
          color: #6B7280;
        }
        .lp-foot a {
          color: #14B8A6;
          font-weight: 500;
          text-decoration: none;
        }
        .lp-foot a:hover {
          text-decoration: underline;
        }
        @media (prefers-color-scheme: dark) {
          .lp-foot { color: #9CA3AF; }
          .lp-foot a { color: #14B8A6; }
        }

        /* Responsive */
        @media (max-width: 1024px) {
          .lp {
            flex-direction: column;
          }
          .lp-hero {
            min-height: 40vh;
            padding: 40px 30px;
          }
          .lp-brand {
            position: static;
            transform: none;
            margin-bottom: 30px;
          }
          .lp-illus {
            margin-bottom: 25px;
          }
          .lp-headline-title {
            font-size: 1.8rem;
          }
          .lp-headline-desc {
            font-size: 0.88rem;
          }
          .lp-features {
            gap: 10px;
            margin-top: 24px;
          }
          .lp-right {
            padding: 40px 30px;
          }
        }
        @media (max-width: 640px) {
          .lp-hero {
            min-height: 35vh;
            padding: 30px 24px;
          }
          .lp-headline-title {
            font-size: 1.5rem;
          }
          .lp-headline-desc {
            font-size: 0.85rem;
          }
          .lp-features {
            grid-template-columns: 1fr;
            gap: 8px;
            margin-top: 20px;
          }
          .lp-right {
            padding: 30px 24px;
          }
        }
      `}</style>

      <div className="lp">
        {/* LEFT SIDE */}
        <aside className="lp-hero">
          <div className="lp-grid"/>
          <div className="lp-hi">
            <div className="lp-brand">
              <div className="lp-brand-logo">
                <img src={logo} alt=""/>
              </div>
              <div className="lp-brand-name">Document Automation</div>
            </div>

            <div className="lp-illus">
              <DocAutomationIllustration/>
            </div>

            <div className="lp-headline">
              <h2 className="lp-headline-title">
                Streamline Your <span>Document Workflow</span>
              </h2>
              <p className="lp-headline-desc">
                A complete enterprise platform for <strong>generating</strong>, <strong>approving</strong>, and <strong>delivering</strong> documents with full audit trails, digital signatures, and secure distribution.
              </p>
              
              <div className="lp-features">
                <div className="lp-feature">
                  <div className="lp-feature-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#27B8BA" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="16" y1="13" x2="8" y2="13"/>
                      <line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                  </div>
                  <span className="lp-feature-text">Auto Generation</span>
                </div>
                <div className="lp-feature">
                  <div className="lp-feature-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#27B8BA" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 11 12 14 22 4"/>
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                    </svg>
                  </div>
                  <span className="lp-feature-text">Approval Workflow</span>
                </div>
                <div className="lp-feature">
                  <div className="lp-feature-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#27B8BA" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                  </div>
                  <span className="lp-feature-text">Secure Delivery</span>
                </div>
                <div className="lp-feature">
                  <div className="lp-feature-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#27B8BA" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <path d="M10 18l2 2 4-4"/>
                    </svg>
                  </div>
                  <span className="lp-feature-text">Digital Signatures</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* RIGHT SIDE */}
        <main className="lp-right">
          <div className="lp-card">
            {error && (
              <div className="lp-err" role="alert">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate>
              <div className="lp-field">
                <label htmlFor="email" className="lp-lbl">Email</label>
                <input
                  id="email"
                  type="email"
                  className="lp-inp"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(null); }}
                  placeholder="john.doe@company.com"
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>

              <div className="lp-field">
                <label htmlFor="password" className="lp-lbl">Password</label>
                <div className="lp-wrap">
                  <input
                    id="password"
                    type={showPw ? 'text' : 'password'}
                    className="lp-inp lp-inp-pw"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(null); }}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="lp-eye"
                    onClick={() => setShowPw(v => !v)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                  >
                    <EyeIcon off={showPw}/>
                  </button>
                </div>
              </div>

              <div className="lp-or"><span>OR</span></div>

              <div className="lp-opts">
                <Link to="/forgot-password" className="lp-forgot">Forgot Password?</Link>
              </div>

              <button type="submit" className="lp-btn" disabled={submitting}>
                {submitting ? (
                  <><span className="lp-spin"/>Signing in…</>
                ) : (
                  'Login'
                )}
              </button>
            </form>

            <div className="lp-div"/>
            <div className="lp-foot">
              <Link to="/verify">Verify</Link>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
