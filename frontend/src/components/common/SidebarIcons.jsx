/**
 * Compact outline icons for the sidebar nav — one per route. Kept as simple,
 * stroke-based SVGs (currentColor) so they inherit the link's text color and
 * react to hover/active state automatically, same as the notification bell.
 */
const common = {
  width: 17,
  height: 17,
  viewBox: '0 0 24 24',
  fill: 'none',
  'aria-hidden': true,
};

export function IconTemplates() {
  return (
    <svg {...common}>
      <path d="M7 3.5H14L18.5 8V19.5C18.5 20.6 17.6 21.5 16.5 21.5H7C5.9 21.5 5 20.6 5 19.5V5.5C5 4.4 5.9 3.5 7 3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14 3.5V7C14 7.55 14.45 8 15 8H18.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8.5 12.5H15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8.5 16H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconMyDocuments() {
  return (
    <svg {...common}>
      <path d="M3.5 8C3.5 6.9 4.4 6 5.5 6H9.5L11.5 8H18.5C19.6 8 20.5 8.9 20.5 10V17C20.5 18.1 19.6 19 18.5 19H5.5C4.4 19 3.5 18.1 3.5 17V8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function IconDocumentTracking() {
  return (
    <svg {...common}>
      <path d="M4 20V10.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M10 20V4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M16 20V13.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M20 20V7.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function IconApprovals() {
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7.5V12L15 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconUsers() {
  return (
    <svg {...common}>
      <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 19C3.9 15.9 6.2 14 9 14C11.8 14 14.1 15.9 14.5 19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M15.5 5.2C17 5.5 18.1 6.8 18.1 8.3C18.1 9.8 17 11.1 15.5 11.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16.5 14.2C18.7 14.7 20.4 16.5 20.7 19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconSettings() {
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="2.9" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 4.2V6M12 18V19.8M19.8 12H18M6 12H4.2M17.4 6.6L16.1 7.9M7.9 16.1L6.6 17.4M17.4 17.4L16.1 16.1M7.9 7.9L6.6 6.6"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
      />
    </svg>
  );
}

export function IconDatabase() {
  return (
    <svg {...common}>
      <ellipse cx="12" cy="6" rx="7.5" ry="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4.5 6V18C4.5 19.66 7.9 21 12 21C16.1 21 19.5 19.66 19.5 18V6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4.5 12C4.5 13.66 7.9 15 12 15C16.1 15 19.5 13.66 19.5 12" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function IconExternalData() {
  return (
    <svg {...common}>
      <path d="M6.5 19C4.6 19 3 17.4 3 15.5C3 13.8 4.2 12.4 5.8 12.1C6.1 9.3 8.5 7.2 11.3 7.2C13.6 7.2 15.6 8.6 16.4 10.6C18.5 10.8 20 12.5 20 14.6C20 16.9 18.1 18.8 15.8 18.8L6.5 19Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function IconAudit() {
  return (
    <svg {...common}>
      <path d="M12 3.5L19 6.3V11C19 15.4 16.1 19.3 12 20.5C7.9 19.3 5 15.4 5 11V6.3L12 3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 11.5L11.2 13.7L15.3 9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
