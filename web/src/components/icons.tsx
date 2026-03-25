import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

function defaultProps(props: IconProps, defaultSize = 24) {
  const { size = defaultSize, ...rest } = props;
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true as const,
    ...rest,
  };
}

/** Water damage / water drop icon — used as brand mark */
export function WaterDamage(props: IconProps) {
  return (
    <svg {...defaultProps(props)}>
      <path
        d="M12 2.69l.66.72C13.52 4.35 16.5 7.7 16.5 11.5a4.5 4.5 0 0 1-9 0c0-3.8 2.98-7.15 3.84-8.09L12 2.69Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 12a2.5 2.5 0 0 0 2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M4 20h16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M6 22h12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Google "G" logo for sign-in buttons */
export function Google(props: IconProps) {
  const { size = 20, ...rest } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...rest}
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09A6.97 6.97 0 0 1 5.48 12c0-.72.13-1.43.36-2.09V7.07H2.18A11.96 11.96 0 0 0 .96 12c0 1.94.46 3.77 1.22 5.33l3.66-2.84v-.4Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.99 14.97.96 12 .96 7.7.96 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z"
        fill="#EA4335"
      />
    </svg>
  );
}

/** Clipboard icon for Jobs nav */
export function Clipboard(props: IconProps) {
  return (
    <svg {...defaultProps(props)}>
      <rect
        x="7"
        y="3"
        width="10"
        height="4"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="5"
        y="5"
        width="14"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <line
        x1="9"
        y1="11"
        x2="15"
        y2="11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="9"
        y1="15"
        x2="13"
        y2="15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Waves icon for Readings nav */
export function Waves(props: IconProps) {
  return (
    <svg {...defaultProps(props)}>
      <path
        d="M2 8c2-2 4-2 6 0s4 2 6 0 4-2 6 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** People icon for Team nav */
export function People(props: IconProps) {
  return (
    <svg {...defaultProps(props)}>
      <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3 20c0-3.31 2.69-6 6-6s6 2.69 6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="17" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M17 14.5c2.49 0 4.5 2.01 4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Gear icon for Settings nav */
export function Gear(props: IconProps) {
  return (
    <svg {...defaultProps(props)}>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Plus icon for adding new items */
export function Plus(props: IconProps) {
  return (
    <svg {...defaultProps(props)}>
      <line
        x1="12"
        y1="5"
        x2="12"
        y2="19"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="5"
        y1="12"
        x2="19"
        y2="12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Arrow forward icon for navigation */
export function ArrowForward(props: IconProps) {
  return (
    <svg {...defaultProps(props)}>
      <path
        d="M5 12h14m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Shield icon for security/compliance */
export function Shield(props: IconProps) {
  return (
    <svg {...defaultProps(props)}>
      <path
        d="M12 2l8 4v6c0 5.25-3.4 9.74-8 11-4.6-1.26-8-5.75-8-11V6l8-4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9 12l2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Help circle icon for info/help */
export function HelpCircle(props: IconProps) {
  return (
    <svg {...defaultProps(props)}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </svg>
  );
}
