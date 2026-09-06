import { useState, useEffect } from 'react';
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

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  // Detect mobile keyboard using visualViewport API
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const handleResize = () => {
      const viewport = window.visualViewport;
      const windowHeight = window.innerHeight;
      const viewportHeight = viewport.height;
      
      // If viewport height is significantly smaller than window height, keyboard is likely open
      const heightDiff = windowHeight - viewportHeight;
      setKeyboardOpen(heightDiff > 150);
    };

    window.visualViewport.addEventListener('resize', handleResize);
    window.visualViewport.addEventListener('scroll', handleResize);
    
    return () => {
      window.visualViewport.removeEventListener('resize', handleResize);
      window.visualViewport.removeEventListener('scroll', handleResize);
    };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim()) { setError('Please enter your work email.'); return; }
    if (!password) { setError('Please enter your password.'); return; }
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
        /* ═══════════════════════════════════════════════════════════
           MOBILE-FIRST RESPONSIVE LOGIN - KEYBOARD AWARE
        ═══════════════════════════════════════════════════════════ */
        
        /* Reset */
        *, *::before, *::after { 
          box-sizing: border-box; 
          margin: 0; 
          padding: 0; 
        }
        
        html {
          /* Modern viewport units with fallbacks */
          height: 100dvh; /* Dynamic viewport height - adjusts with keyboard */
          height: 100svh; /* Small viewport height - fallback */
          height: 100vh;  /* Legacy fallback */
        }
        
        body {
          margin: 0;
          padding: 0;
          overflow: hidden;
        }

        /* ─────────────────────────────────────
           PAGE CONTAINER - MOBILE FIRST
        ───────────────────────────────────── */
        .login-page {
          /* Use modern viewport units that respect mobile keyboards */
          min-height: 100dvh;
          min-height: 100svh;
          min-height: 100vh;
          
          width: 100%;
          display: flex;
          flex-direction: column;
          
          /* Allow vertical scrolling when keyboard opens */
          overflow-y: auto;
          overflow-x: hidden;
          
          /* Smooth scrolling on iOS */
          -webkit-overflow-scrolling: touch;
          
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 
                       'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          
          background: #FAFAFA;
          
          /* Safe area support for notches */
          padding-bottom: env(safe-area-inset-bottom);
        }
        
        @media (prefers-color-scheme: dark) {
          .login-page {
            background: #1A2332;
          }
        }

        /* ─────────────────────────────────────
           HERO SECTION (LEFT SIDE ON DESKTOP)
        ───────────────────────────────────── */
        .login-hero {
          display: none; /* Hidden on mobile by default */
          position: relative;
          background: linear-gradient(135deg, #0A1E38 0%, #0F2747 50%, #27B8BA 100%);
          overflow: hidden;
        }
        
        .login-hero::before {
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
        
        @keyframes orb-float {
          from { transform: translate(0,0) scale(1); }
          to { transform: translate(20px,15px) scale(1.06); }
        }
        
        .login-hero-content {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          height: 100%;
          padding: 40px;
          justify-content: flex-start;
        }
        
        /* Title at top middle */
        .login-brand {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          margin-bottom: 0;
          padding-top: 30px;
        }
        
        .login-brand-logo {
          width: 60px;
          height: 60px;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        }
        
        .login-brand-logo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        
        .login-brand-name {
          font-size: 1.6rem;
          font-weight: 800;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #FFFFFF;
          text-align: center;
          text-shadow: 0 2px 12px rgba(39,184,186,0.4);
          margin-bottom: 10px;
        }
        
        /* Large centered animation container */
        .login-hero-animation {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 20px;
        }
        
        .login-animation-graphic {
          width: 100%;
          max-width: 480px;
          aspect-ratio: 1;
          position: relative;
        }
        
        /* Document automation visual representation */
        .doc-flow {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 30px;
          opacity: 0;
          animation: fadeInUp 1s ease 0.3s forwards;
        }
        
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .doc-icon-group {
          display: flex;
          gap: 24px;
          align-items: center;
        }
        
        .doc-icon {
          width: 80px;
          height: 80px;
          background: rgba(255, 255, 255, 0.1);
          border: 2px solid rgba(39, 184, 186, 0.3);
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(10px);
          animation: docPulse 3s ease-in-out infinite;
        }
        
        .doc-icon:nth-child(2) {
          animation-delay: 0.5s;
        }
        
        .doc-icon:nth-child(3) {
          animation-delay: 1s;
        }
        
        @keyframes docPulse {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(39, 184, 186, 0.4);
          }
          50% {
            transform: scale(1.05);
            box-shadow: 0 0 20px 10px rgba(39, 184, 186, 0);
          }
        }
        
        .doc-icon svg {
          width: 40px;
          height: 40px;
          color: #27B8BA;
        }
        
        .doc-flow-arrow {
          width: 100%;
          max-width: 300px;
          height: 2px;
          background: linear-gradient(90deg, transparent, #27B8BA, transparent);
          position: relative;
          animation: flowMove 2s ease-in-out infinite;
        }
        
        @keyframes flowMove {
          0% {
            opacity: 0.5;
          }
          50% {
            opacity: 1;
          }
          100% {
            opacity: 0.5;
          }
        }
        
        .doc-flow-arrow::after {
          content: '';
          position: absolute;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 0;
          height: 0;
          border-left: 8px solid #27B8BA;
          border-top: 5px solid transparent;
          border-bottom: 5px solid transparent;
        }
        
        .doc-feature-label {
          font-size: 0.95rem;
          color: rgba(255, 255, 255, 0.9);
          text-align: center;
          font-weight: 600;
          letter-spacing: 0.03em;
        }

        /* ─────────────────────────────────────
           FORM CONTAINER - MOBILE OPTIMIZED
        ───────────────────────────────────── */
        .login-container {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          
          /* Flexible padding that works with keyboard */
          padding: 20px 16px;
          padding-bottom: calc(20px + env(safe-area-inset-bottom));
          
          width: 100%;
          max-width: 100%;
        }
        
        .login-form-wrapper {
          width: 100%;
          max-width: 420px;
          
          /* No fixed height - let content determine size */
          /* Allow form to shrink when keyboard opens */
        }
        
        /* Mobile header (logo shown on mobile only) */
        .login-mobile-header {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-bottom: 32px;
        }
        
        .login-mobile-logo {
          width: 56px;
          height: 56px;
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        .login-mobile-logo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        
        .login-mobile-title {
          font-size: 1.25rem;
          font-weight: 700;
          color: #1A1A1A;
          text-align: center;
          margin-bottom: 4px;
        }
        
        .login-mobile-subtitle {
          font-size: 0.875rem;
          color: #6B7280;
          text-align: center;
        }
        
        @media (prefers-color-scheme: dark) {
          .login-mobile-title {
            color: #FFFFFF;
          }
          .login-mobile-subtitle {
            color: #9CA3AF;
          }
        }

        /* ─────────────────────────────────────
           FORM ELEMENTS - TOUCH OPTIMIZED
        ───────────────────────────────────── */
        .login-form {
          width: 100%;
        }
        
        /* Error message */
        .login-error {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px 14px;
          margin-bottom: 20px;
          background: #FEE2E2;
          border: 1px solid #FCA5A5;
          border-radius: 8px;
          font-size: 0.875rem;
          color: #DC2626;
          line-height: 1.4;
        }
        
        @media (prefers-color-scheme: dark) {
          .login-error {
            background: rgba(220, 38, 38, 0.15);
            border-color: rgba(248, 113, 113, 0.3);
            color: #FCA5A5;
          }
        }
        
        .login-error svg {
          flex-shrink: 0;
          margin-top: 2px;
        }
        
        /* Form field */
        .login-field {
          margin-bottom: 20px;
        }
        
        .login-label {
          display: block;
          margin-bottom: 8px;
          font-size: 0.9375rem;
          font-weight: 500;
          color: #1A1A1A;
        }
        
        @media (prefers-color-scheme: dark) {
          .login-label {
            color: #E5E7EB;
          }
        }
        
        .login-input-wrapper {
          position: relative;
        }
        
        .login-input {
          width: 100%;
          
          /* Touch-friendly sizing - minimum 44px touch target */
          padding: 14px 16px;
          min-height: 48px;
          
          font-size: 16px; /* Prevents iOS zoom on focus */
          font-family: inherit;
          line-height: 1.5;
          
          color: #1A1A1A;
          background: #FFFFFF;
          
          border: 1.5px solid #D1D5DB;
          border-radius: 8px;
          
          outline: none;
          transition: all 0.2s ease;
          
          /* Better touch experience */
          -webkit-appearance: none;
          appearance: none;
        }
        
        .login-input:focus {
          border-color: #14B8A6;
          box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.1);
        }
        
        .login-input::placeholder {
          color: #9CA3AF;
        }
        
        @media (prefers-color-scheme: dark) {
          .login-input {
            color: #FFFFFF;
            background: #2C3E50;
            border-color: #4B5563;
          }
          .login-input:focus {
            border-color: #14B8A6;
            box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.2);
          }
          .login-input::placeholder {
            color: #6B7280;
          }
        }
        
        .login-input-password {
          padding-right: 50px;
        }
        
        /* Password visibility toggle */
        .login-password-toggle {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          
          /* Touch-friendly button */
          min-width: 44px;
          min-height: 44px;
          
          display: flex;
          align-items: center;
          justify-content: center;
          
          background: none;
          border: none;
          color: #6B7280;
          cursor: pointer;
          
          border-radius: 6px;
          transition: all 0.2s;
        }
        
        .login-password-toggle:hover,
        .login-password-toggle:focus {
          color: #14B8A6;
          background: rgba(20, 184, 166, 0.1);
        }
        
        .login-password-toggle:active {
          transform: translateY(-50%) scale(0.95);
        }
        
        @media (prefers-color-scheme: dark) {
          .login-password-toggle {
            color: #9CA3AF;
          }
          .login-password-toggle:hover,
          .login-password-toggle:focus {
            color: #14B8A6;
          }
        }
        
        /* Forgot password link */
        .login-forgot-container {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 24px;
        }
        
        .login-forgot-link {
          /* Touch-friendly link */
          display: inline-block;
          padding: 8px 4px;
          
          font-size: 0.875rem;
          font-weight: 500;
          color: #14B8A6;
          text-decoration: none;
          
          transition: color 0.2s;
        }
        
        .login-forgot-link:hover,
        .login-forgot-link:focus {
          color: #0D9488;
          text-decoration: underline;
        }
        
        @media (prefers-color-scheme: dark) {
          .login-forgot-link {
            color: #2DD4BF;
          }
          .login-forgot-link:hover {
            color: #14B8A6;
          }
        }
        
        /* Submit button - Touch optimized */
        .login-button {
          width: 100%;
          
          /* Touch-friendly sizing */
          padding: 14px 20px;
          min-height: 48px;
          
          font-size: 1rem;
          font-weight: 600;
          font-family: inherit;
          
          color: #FFFFFF;
          background: #14B8A6;
          
          border: none;
          border-radius: 8px;
          
          cursor: pointer;
          transition: all 0.2s ease;
          
          box-shadow: 0 2px 8px rgba(20, 184, 166, 0.25);
          
          /* Better touch experience */
          -webkit-tap-highlight-color: transparent;
        }
        
        .login-button:hover:not(:disabled) {
          background: #0D9488;
          box-shadow: 0 4px 12px rgba(20, 184, 166, 0.35);
          transform: translateY(-1px);
        }
        
        .login-button:active:not(:disabled) {
          transform: translateY(0);
        }
        
        .login-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }
        
        @media (prefers-color-scheme: dark) {
          .login-button {
            background: #14B8A6;
            box-shadow: 0 2px 8px rgba(20, 184, 166, 0.3);
          }
          .login-button:hover:not(:disabled) {
            background: #0D9488;
            box-shadow: 0 4px 12px rgba(20, 184, 166, 0.4);
          }
        }
        
        .login-button-spinner {
          display: inline-block;
          width: 16px;
          height: 16px;
          margin-right: 8px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: #FFFFFF;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        
        /* Divider */
        .login-divider {
          margin: 24px 0;
          height: 1px;
          background: #E5E7EB;
        }
        
        @media (prefers-color-scheme: dark) {
          .login-divider {
            background: #374151;
          }
        }
        
        /* Footer links */
        .login-footer {
          text-align: center;
          padding: 8px 0;
        }
        
        .login-footer-link {
          /* Touch-friendly link */
          display: inline-block;
          padding: 8px 4px;
          
          font-size: 0.875rem;
          font-weight: 500;
          color: #14B8A6;
          text-decoration: none;
          
          transition: color 0.2s;
        }
        
        .login-footer-link:hover,
        .login-footer-link:focus {
          color: #0D9488;
          text-decoration: underline;
        }
        
        @media (prefers-color-scheme: dark) {
          .login-footer-link {
            color: #2DD4BF;
          }
          .login-footer-link:hover {
            color: #14B8A6;
          }
        }

        /* ═══════════════════════════════════════════════════════════
           RESPONSIVE BREAKPOINTS
        ═══════════════════════════════════════════════════════════ */
        
        /* ─────────────────────────────────────
           TABLET PORTRAIT (601px+)
        ───────────────────────────────────── */
        @media (min-width: 601px) {
          .login-page {
            padding: 30px 24px;
          }
          
          .login-container {
            padding: 40px 30px;
          }
          
          .login-mobile-header {
            margin-bottom: 40px;
          }
          
          .login-mobile-logo {
            width: 64px;
            height: 64px;
          }
          
          .login-mobile-title {
            font-size: 1.5rem;
          }
          
          .login-field {
            margin-bottom: 24px;
          }
        }
        
        /* ─────────────────────────────────────
           DESKTOP (1025px+) - SPLIT LAYOUT
        ───────────────────────────────────── */
        @media (min-width: 1025px) {
          .login-page {
            flex-direction: row;
            padding: 0;
            overflow: hidden;
          }
          
          /* Show hero section on desktop */
          .login-hero {
            display: flex;
            flex: 0 0 50%;
            min-height: 100vh;
            min-height: 100dvh;
          }
          
          /* Hide mobile header on desktop */
          .login-mobile-header {
            display: none;
          }
          
          .login-container {
            flex: 1;
            padding: 60px;
            
            /* Desktop can use fixed viewport */
            min-height: 100vh;
            overflow-y: auto;
          }
          
          .login-form-wrapper {
            max-width: 420px;
          }
        }
        
        /* ─────────────────────────────────────
           LARGE DESKTOP (1441px+)
        ───────────────────────────────────── */
        @media (min-width: 1441px) {
          .login-hero-content {
            padding: 60px 80px;
          }
          
          .login-brand-logo {
            width: 72px;
            height: 72px;
          }
          
          .login-brand-name {
            font-size: 1.75rem;
          }
          
          .login-container {
            padding: 80px 100px;
          }
          
          .login-form-wrapper {
            max-width: 460px;
          }
        }
        
        /* ─────────────────────────────────────
           LANDSCAPE ORIENTATION - MOBILE
        ───────────────────────────────────── */
        @media (max-width: 1024px) and (max-height: 500px) and (orientation: landscape) {
          .login-page {
            padding: 12px;
          }
          
          .login-container {
            padding: 16px 20px;
          }
          
          .login-mobile-header {
            margin-bottom: 16px;
          }
          
          .login-mobile-logo {
            width: 40px;
            height: 40px;
            margin-bottom: 8px;
          }
          
          .login-mobile-title {
            font-size: 1rem;
            margin-bottom: 2px;
          }
          
          .login-mobile-subtitle {
            font-size: 0.75rem;
          }
          
          .login-field {
            margin-bottom: 12px;
          }
          
          .login-label {
            font-size: 0.875rem;
            margin-bottom: 6px;
          }
          
          .login-input {
            padding: 10px 14px;
            min-height: 42px;
          }
          
          .login-forgot-container {
            margin-bottom: 16px;
          }
          
          .login-button {
            padding: 11px 18px;
            min-height: 42px;
          }
          
          .login-divider {
            margin: 16px 0;
          }
        }
        
        /* ─────────────────────────────────────
           KEYBOARD OPEN STATE - MOBILE
        ───────────────────────────────────── */
        @media (max-width: 1024px) {
          /* When keyboard is open, ensure everything is still accessible */
          .login-page.keyboard-open {
            /* Allow full scrolling */
            overflow-y: auto;
          }
          
          .login-page.keyboard-open .login-container {
            /* Reduce padding to maximize space */
            padding: 12px 16px;
            
            /* Remove centering */
            align-items: flex-start;
            justify-content: flex-start;
          }
          
          .login-page.keyboard-open .login-mobile-header {
            /* Compact header when keyboard is open */
            margin-bottom: 16px;
          }
          
          .login-page.keyboard-open .login-mobile-logo {
            width: 40px;
            height: 40px;
          }
          
          .login-page.keyboard-open .login-field {
            margin-bottom: 14px;
          }
        }
        
        /* ─────────────────────────────────────
           ACCESSIBILITY ENHANCEMENTS
        ───────────────────────────────────── */
        
        /* Focus visible for keyboard navigation */
        .login-input:focus-visible,
        .login-button:focus-visible,
        .login-password-toggle:focus-visible,
        .login-forgot-link:focus-visible,
        .login-footer-link:focus-visible {
          outline: 2px solid #14B8A6;
          outline-offset: 2px;
        }
        
        /* High contrast mode support */
        @media (prefers-contrast: high) {
          .login-input {
            border-width: 2px;
          }
          
          .login-button {
            border: 2px solid currentColor;
          }
        }
        
        /* Reduced motion */
        @media (prefers-reduced-motion: reduce) {
          *,
          *::before,
          *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
        
        /* Print styles */
        @media print {
          .login-hero {
            display: none;
          }
          
          .login-page {
            height: auto;
            overflow: visible;
          }
        }
      `}</style>

      <div className={`login-page ${keyboardOpen ? 'keyboard-open' : ''}`}>
        {/* HERO SECTION - Desktop only */}
        <aside className="login-hero" aria-hidden="true">
          <div className="login-hero-content">
            {/* Title at top */}
            <div className="login-brand">
              <div className="login-brand-logo">
                <img src={logo} alt="" />
              </div>
              <div className="login-brand-name">Document Automation</div>
            </div>
            
            {/* Large animation in center */}
            <div className="login-hero-animation">
              <div className="login-animation-graphic">
                <div className="doc-flow">
                  {/* Document creation flow */}
                  <div className="doc-icon-group">
                    <div className="doc-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                    </div>
                  </div>
                  
                  <div className="doc-flow-arrow"></div>
                  
                  {/* Processing */}
                  <div className="doc-icon-group">
                    <div className="doc-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <line x1="9" y1="9" x2="15" y2="9"/>
                        <line x1="9" y1="13" x2="15" y2="13"/>
                        <line x1="9" y1="17" x2="13" y2="17"/>
                      </svg>
                    </div>
                    <div className="doc-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M12 1v6m0 6v6m7.07-13.93l-4.24 4.24m-5.66 5.66-4.24 4.24m13.93 0l-4.24-4.24M7.76 7.76L3.52 3.52"/>
                      </svg>
                    </div>
                    <div className="doc-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 11 12 14 22 4"/>
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                      </svg>
                    </div>
                  </div>
                  
                  <div className="doc-flow-arrow"></div>
                  
                  {/* Delivery */}
                  <div className="doc-icon-group">
                    <div className="doc-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.5 12H16c-.5 2.5-2 4.9-4 6.5-2-1.6-3.5-4-4-6.5H2.5"/>
                        <path d="M5.5 7v4.5c0 2.9 2.3 5.3 5.2 5.5 2.9-.2 5.2-2.6 5.2-5.5V7"/>
                        <path d="M12 2v5"/>
                      </svg>
                    </div>
                  </div>
                  
                  <div className="doc-feature-label">
                    Create · Process · Approve · Deliver
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* FORM SECTION */}
        <main className="login-container">
          <div className="login-form-wrapper">
            {/* Mobile header */}
            <div className="login-mobile-header">
              <div className="login-mobile-logo">
                <img src={logo} alt="Document Automation" />
              </div>
              <h1 className="login-mobile-title">Document Automation</h1>
              <p className="login-mobile-subtitle">Sign in to your account</p>
            </div>

            {/* Error message */}
            {error && (
              <div className="login-error" role="alert" aria-live="polite">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {/* Login form */}
            <form className="login-form" onSubmit={handleSubmit} noValidate>
              {/* Email field */}
              <div className="login-field">
                <label htmlFor="email" className="login-label">
                  Email
                </label>
                <div className="login-input-wrapper">
                  <input
                    id="email"
                    type="email"
                    className="login-input"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(null); }}
                    placeholder="john.doe@company.com"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck="false"
                    required
                    aria-required="true"
                    aria-invalid={error ? 'true' : 'false'}
                  />
                </div>
              </div>

              {/* Password field */}
              <div className="login-field">
                <label htmlFor="password" className="login-label">
                  Password
                </label>
                <div className="login-input-wrapper">
                  <input
                    id="password"
                    type={showPw ? 'text' : 'password'}
                    className="login-input login-input-password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(null); }}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                    aria-required="true"
                    aria-invalid={error ? 'true' : 'false'}
                  />
                  <button
                    type="button"
                    className="login-password-toggle"
                    onClick={() => setShowPw(v => !v)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    tabIndex={0}
                  >
                    <EyeIcon off={showPw} />
                  </button>
                </div>
              </div>

              {/* Forgot password */}
              <div className="login-forgot-container">
                <Link to="/forgot-password" className="login-forgot-link">
                  Forgot password?
                </Link>
              </div>

              {/* Submit button */}
              <button
                type="submit"
                className="login-button"
                disabled={submitting}
                aria-busy={submitting}
              >
                {submitting ? (
                  <>
                    <span className="login-button-spinner" aria-hidden="true" />
                    Signing in...
                  </>
                ) : (
                  'Login'
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="login-divider" aria-hidden="true" />

            {/* Footer */}
            <div className="login-footer">
              <Link to="/verify" className="login-footer-link">
                Verify a document
              </Link>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
