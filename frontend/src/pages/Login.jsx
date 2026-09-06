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

/* ── Document automation illustration - larger and more descriptive ── */
function DocAutomationIllustration() {
  return (
    <svg viewBox="0 0 400 350" fill="none" xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true" style={{ width: '100%', maxWidth: 400 }}>
      
      {/* Back document - largest */}
      <g opacity="0.5">
        <rect x="160" y="80" width="140" height="180" rx="8"
          fill="var(--doc-bg)" stroke="var(--doc-stroke)" strokeWidth="2.5"/>
        <rect x="175" y="100" width="80" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="175" y="110" width="100" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="175" y="120" width="70" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="175" y="135" width="90" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="175" y="145" width="85" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="175" y="155" width="75" height="4" rx="2" fill="var(--doc-line)"/>
      </g>

      {/* Middle document */}
      <g opacity="0.7">
        <animateTransform attributeName="transform" type="translate"
          values="0,0;-2,-2;0,0" dur="3.5s" repeatCount="indefinite"/>
        <rect x="130" y="60" width="140" height="180" rx="8"
          fill="var(--doc-bg)" stroke="var(--doc-stroke)" strokeWidth="2.5"/>
        <rect x="145" y="80" width="80" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="145" y="90" width="100" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="145" y="100" width="70" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="145" y="115" width="90" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="145" y="125" width="85" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="145" y="135" width="75" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="145" y="150" width="95" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="145" y="160" width="80" height="4" rx="2" fill="var(--doc-line)"/>
      </g>

      {/* Front document with checkmark - largest and most prominent */}
      <g>
        <animateTransform attributeName="transform" type="translate"
          values="0,0;-3,-3;0,0" dur="4.5s" repeatCount="indefinite"/>
        <rect x="100" y="40" width="140" height="180" rx="8"
          fill="var(--doc-bg-front)" stroke="var(--doc-stroke-front)" strokeWidth="3"/>
        <rect x="115" y="60" width="80" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="115" y="70" width="100" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="115" y="80" width="70" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="115" y="95" width="90" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="115" y="105" width="85" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="115" y="115" width="75" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="115" y="130" width="95" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="115" y="140" width="80" height="4" rx="2" fill="var(--doc-line)"/>
        <rect x="115" y="150" width="70" height="4" rx="2" fill="var(--doc-line)"/>
        
        {/* Large checkmark circle */}
        <circle cx="170" cy="180" r="28" fill="var(--check-bg)" stroke="var(--check-stroke)" strokeWidth="3">
          <animate attributeName="opacity" values="1;0.85;1" dur="2s" repeatCount="indefinite"/>
        </circle>
        <path d="M155 180 l10 10 20-20" stroke="var(--check-mark)" strokeWidth="4"
          strokeLinecap="round" strokeLinejoin="round">
          <animate attributeName="stroke-dashoffset" from="40" to="0" dur="2s" repeatCount="indefinite"/>
          <animate attributeName="stroke-dasharray" values="0 40;40 0" dur="2s" repeatCount="indefinite"/>
        </path>
      </g>

      {/* Left curved arrow - workflow indication */}
      <g>
        <path d="M 105 100 Q 50 100 50 55" stroke="var(--arrow-color)" strokeWidth="4"
          fill="none" strokeLinecap="round" opacity="0.7">
          <animate attributeName="stroke-dashoffset" from="100" to="0" dur="3s" repeatCount="indefinite"/>
          <animate attributeName="stroke-dasharray" values="0 100;100 0" dur="3s" repeatCount="indefinite"/>
        </path>
        <circle cx="50" cy="50" r="4" fill="var(--arrow-color)">
          <animate attributeName="opacity" values="0;1;0" dur="3s" repeatCount="indefinite"/>
        </circle>
      </g>

      {/* Right curved arrow */}
      <g>
        <path d="M 235 200 Q 320 200 320 150" stroke="var(--arrow-color)" strokeWidth="4"
          fill="none" strokeLinecap="round" opacity="0.7">
          <animate attributeName="stroke-dashoffset" from="100" to="0" dur="3s" begin="1s" repeatCount="indefinite"/>
          <animate attributeName="stroke-dasharray" values="0 100;100 0" dur="3s" begin="1s" repeatCount="indefinite"/>
        </path>
        <circle cx="320" cy="145" r="4" fill="var(--arrow-color)">
          <animate attributeName="opacity" values="0;1;0" dur="3s" begin="1s" repeatCount="indefinite"/>
        </circle>
      </g>

      {/* Gear icon - automation symbol (top right) */}
      <g opacity="0.8">
        <animateTransform attributeName="transform" type="rotate"
          values="0 320 80; 360 320 80" dur="8s" repeatCount="indefinite"/>
        <circle cx="320" cy="80" r="24" fill="var(--gear-bg)" stroke="var(--gear-stroke)" strokeWidth="3"/>
        <circle cx="320" cy="80" r="9" fill="var(--gear-center)"/>
        {[0, 60, 120, 180, 240, 300].map((angle, i) => (
          <rect key={i}
            x="317" y="56" width="6" height="11" rx="3"
            fill="var(--gear-stroke)"
            transform={`rotate(${angle} 320 80)`}/>
        ))}
      </g>

      {/* Water drop - refresh/automation icon (bottom left) */}
      <g opacity="0.75">
        <animateTransform attributeName="transform" type="translate"
          values="0,0;0,-4;0,0" dur="2.5s" repeatCount="indefinite"/>
        <ellipse cx="65" cy="210" rx="16" ry="20" fill="var(--drop-color)" opacity="0.4"/>
        <ellipse cx="65" cy="207" rx="13" ry="17" fill="var(--drop-color)"/>
        <circle cx="65" cy="200" r="4" fill="var(--drop-highlight)" opacity="0.7"/>
      </g>

      {/* Signature pen icon - digital signature (bottom right) */}
      <g opacity="0.75">
        <animateTransform attributeName="transform" type="translate"
          values="0,0;2,0;0,0" dur="2s" repeatCount="indefinite"/>
        <path d="M 280 260 L 295 245 L 300 250 L 285 265 Z" 
          fill="var(--arrow-color)" stroke="var(--arrow-color)" strokeWidth="2"/>
        <path d="M 295 245 L 305 235" 
          stroke="var(--arrow-color)" strokeWidth="3" strokeLinecap="round"/>
        <circle cx="307" cy="233" r="3" fill="var(--check-bg)"/>
        <path d="M 275 268 Q 278 265 280 260" 
          stroke="var(--arrow-color)" strokeWidth="2" fill="none"/>
      </g>

      {/* Shield icon - security (top left) */}
      <g opacity="0.7">
        <path d="M 60 60 L 60 90 Q 60 105 75 110 Q 90 105 90 90 L 90 60 L 75 55 Z" 
          fill="var(--gear-bg)" stroke="var(--gear-stroke)" strokeWidth="2.5"/>
        <path d="M 70 75 L 73 78 L 80 70" 
          stroke="var(--check-mark)" strokeWidth="2.5" fill="none" 
          strokeLinecap="round" strokeLinejoin="round"/>
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
          height: 100%;
        }

        .lp-brand {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding-top: 40px;
          margin-bottom: 0;
        }
        .lp-brand-logo {
          width: 64px;
          height: 64px;
          border-radius: 14px;
          overflow: hidden;
          box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        }
        .lp-brand-logo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .lp-brand-name {
          font-size: 1.5rem;
          font-weight: 800;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #FFFFFF;
          text-align: center;
          text-shadow: 0 2px 12px rgba(39,184,186,0.4);
        }
        .lp-brand-subtitle {
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #27B8BA;
          opacity: 0.9;
        }

        .lp-illus {
          display: flex;
          justify-content: center;
          align-items: center;
          flex: 1;
          width: 100%;
        }

        /* Remove all descriptive sections */
        .lp-headline,
        .lp-headline-title,
        .lp-headline-desc,
        .lp-features,
        .lp-feature {
          display: none;
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
        /* Extra large screens (1920px+) */
        @media (min-width: 1920px) {
          .lp-hero {
            padding: 80px 100px;
          }
          .lp-brand-logo {
            width: 80px;
            height: 80px;
          }
          .lp-brand-name {
            font-size: 2rem;
          }
          .lp-brand-subtitle {
            font-size: 0.9rem;
          }
          .lp-illus svg {
            max-width: 500px;
          }
          .lp-right {
            padding: 80px 100px;
          }
          .lp-card {
            max-width: 450px;
          }
        }

        /* Large desktop (1440px - 1920px) */
        @media (min-width: 1440px) and (max-width: 1919px) {
          .lp-hero {
            padding: 70px 60px;
          }
          .lp-illus svg {
            max-width: 420px;
          }
          .lp-right {
            padding: 70px 60px;
          }
          .lp-card {
            max-width: 400px;
          }
        }

        /* Standard desktop (1024px - 1439px) */
        @media (min-width: 1024px) and (max-width: 1439px) {
          .lp-hero {
            padding: 50px 40px;
          }
          .lp-brand-logo {
            width: 58px;
            height: 58px;
          }
          .lp-brand-name {
            font-size: 1.4rem;
          }
          .lp-illus svg {
            max-width: 360px;
          }
          .lp-right {
            padding: 50px 40px;
          }
        }

        /* Tablet landscape (768px - 1023px) */
        @media (min-width: 768px) and (max-width: 1023px) {
          .lp {
            flex-direction: row;
          }
          .lp-hero {
            flex: 0 0 45%;
            padding: 40px 30px;
            min-height: 100vh;
          }
          .lp-brand {
            padding-top: 20px;
          }
          .lp-brand-logo {
            width: 54px;
            height: 54px;
          }
          .lp-brand-name {
            font-size: 1.25rem;
          }
          .lp-brand-subtitle {
            font-size: 0.7rem;
          }
          .lp-illus svg {
            max-width: 300px;
          }
          .lp-right {
            flex: 1;
            padding: 40px 30px;
          }
          .lp-card {
            max-width: 100%;
          }
        }

        /* Tablet portrait (600px - 767px) */
        @media (min-width: 600px) and (max-width: 767px) {
          .lp {
            flex-direction: column;
          }
          .lp-hero {
            min-height: 40vh;
            padding: 30px 25px;
          }
          .lp-brand {
            padding-top: 15px;
          }
          .lp-brand-logo {
            width: 52px;
            height: 52px;
          }
          .lp-brand-name {
            font-size: 1.2rem;
          }
          .lp-brand-subtitle {
            font-size: 0.68rem;
          }
          .lp-illus {
            margin-top: 10px;
          }
          .lp-illus svg {
            max-width: 280px;
          }
          .lp-right {
            flex: 1;
            padding: 35px 25px;
            min-height: 60vh;
          }
          .lp-card {
            max-width: 100%;
          }
          .lp-field {
            margin-bottom: 18px;
          }
        }

        /* Large phone (480px - 599px) */
        @media (min-width: 480px) and (max-width: 599px) {
          .lp {
            flex-direction: column;
          }
          .lp-hero {
            min-height: 35vh;
            padding: 25px 20px;
          }
          .lp-brand {
            padding-top: 10px;
          }
          .lp-brand-logo {
            width: 48px;
            height: 48px;
          }
          .lp-brand-name {
            font-size: 1.1rem;
          }
          .lp-brand-subtitle {
            font-size: 0.65rem;
          }
          .lp-illus {
            margin-top: 10px;
          }
          .lp-illus svg {
            max-width: 240px;
          }
          .lp-right {
            flex: 1;
            padding: 30px 20px;
            min-height: 65vh;
          }
          .lp-inp {
            padding: 11px 14px;
            font-size: 0.9rem;
          }
          .lp-btn {
            padding: 12px 18px;
            font-size: 0.9rem;
          }
        }

        /* Small phone (320px - 479px) */
        @media (max-width: 479px) {
          .lp {
            flex-direction: column;
          }
          .lp-hero {
            min-height: 32vh;
            padding: 20px 16px;
          }
          .lp-brand {
            padding-top: 8px;
            gap: 8px;
          }
          .lp-brand-logo {
            width: 44px;
            height: 44px;
          }
          .lp-brand-name {
            font-size: 0.95rem;
            letter-spacing: 0.03em;
          }
          .lp-brand-subtitle {
            font-size: 0.6rem;
          }
          .lp-illus {
            margin-top: 8px;
          }
          .lp-illus svg {
            max-width: 200px;
          }
          .lp-right {
            flex: 1;
            padding: 24px 16px;
            min-height: 68vh;
          }
          .lp-card {
            max-width: 100%;
          }
          .lp-field {
            margin-bottom: 16px;
          }
          .lp-lbl {
            font-size: 0.875rem;
          }
          .lp-inp {
            padding: 10px 12px;
            font-size: 0.875rem;
          }
          .lp-btn {
            padding: 11px 16px;
            font-size: 0.875rem;
          }
          .lp-or {
            margin: 18px 0;
            font-size: 0.8rem;
          }
          .lp-forgot {
            font-size: 0.8rem;
          }
          .lp-foot {
            font-size: 0.8rem;
          }
        }

        /* Extra small phone (< 320px) */
        @media (max-width: 319px) {
          .lp-hero {
            min-height: 30vh;
            padding: 16px 12px;
          }
          .lp-brand-logo {
            width: 40px;
            height: 40px;
          }
          .lp-brand-name {
            font-size: 0.85rem;
          }
          .lp-illus svg {
            max-width: 180px;
          }
          .lp-right {
            padding: 20px 12px;
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
              <div className="lp-brand-subtitle">Enterprise Platform</div>
            </div>

            <div className="lp-illus">
              <DocAutomationIllustration/>
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
