import type { ComponentChildren } from 'preact';

function Svg({ children, size = 18 }: { children: ComponentChildren; size?: number }) {
  return (
    <svg class="tp-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

type P = { size?: number };

export const IconFiles = (p: P) => (
  <Svg {...p}>
    <path d="M15 3H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7z" />
    <path d="M15 3v4h4" />
    <path d="M6 7H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2" />
  </Svg>
);
export const IconPalette = (p: P) => (
  <Svg {...p}>
    <path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.9 2-2 0-.6-.2-1-.5-1.400-.3-.4-.5-.8-.5-1.300 0-1.100.9-2 2-2h2.200A3.800 3.800 0 0 0 21 10.500C21 6.400 17 3 12 3z" />
    <circle cx="7.500" cy="11" r="1" />
    <circle cx="10.500" cy="7.500" r="1" />
    <circle cx="15" cy="7.500" r="1" />
  </Svg>
);
export const IconHelp = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.500 9.300a2.600 2.600 0 0 1 5 .900c0 1.700-2.500 2.200-2.500 3.800" />
    <path d="M12 17.200v.100" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const IconFolder = (p: P) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.500h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
);
export const IconSave = (p: P) => (
  <Svg {...p}>
    <path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M8 3v5h7V3M7 21v-7h10v7" />
  </Svg>
);
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.500" />
    <path d="M20 20l-4.200-4.200" />
  </Svg>
);
export const IconUp = (p: P) => (
  <Svg {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);
export const IconDown = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
);
export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="M5 12.500l4.500 4.500L19 7.500" />
  </Svg>
);
export const IconFlask = (p: P) => (
  <Svg {...p}>
    <path d="M9 3h6M10 3v6l-5.500 9.500A1.700 1.700 0 0 0 6 21h12a1.700 1.700 0 0 0 1.500-2.500L14 9V3" />
    <path d="M7.500 15h9" />
  </Svg>
);
export const IconCommand = (p: P) => (
  <Svg {...p}>
    <path d="M5 8l4 4-4 4M12 17h7" />
  </Svg>
);
export const IconSelectAll = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </Svg>
);
export const IconLock = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="var(--tp-accent)" />
      <rect x="13" y="16" width="24" height="6" rx="3" fill="var(--tp-on-accent)" opacity=".95" />
      <rect x="13" y="29" width="38" height="6" rx="3" fill="var(--tp-on-accent)" opacity=".6" />
      <rect x="13" y="42" width="16" height="6" rx="3" fill="var(--tp-on-accent)" opacity=".95" />
      <rect x="34" y="40" width="5" height="10" rx="2" fill="var(--tp-on-accent)" />
    </svg>
  );
}

export const IconMore = (p: P) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="19" cy="12" r="1.2" />
  </Svg>
);
export const IconUnlock = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 7.5-2" />
  </Svg>
);

export const IconPulse = (p: P) => (
  <Svg {...p}>
    <path d="M3 12h4l2.5-7 4 14 2.5-7h5" />
  </Svg>
);
export const IconMarker = (p: P) => (
  <Svg {...p}>
    <path d="M14.5 4.5l5 5L10 19H5v-5z" />
    <path d="M12 7l5 5M4 21h16" />
  </Svg>
);
