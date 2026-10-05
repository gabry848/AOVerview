import type { CSSProperties } from "react";

const paths = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  activity: <path d="M3 12h4l3-7 4 14 3-7h4"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  clock: <><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></>,
  branch: <><circle cx="7" cy="5" r="2"/><circle cx="17" cy="7" r="2"/><circle cx="7" cy="19" r="2"/><path d="M7 7v10m10-8a8 8 0 0 1-8 8H7"/></>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
  alert: <><path d="m12 3 10 17H2L12 3z"/><path d="M12 9v4m0 3v.1"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
  layers: <><path d="m12 3 10 6-10 6L2 9l10-6zM2 13l10 6 10-6M2 17l10 6 10-6"/></>,
} as const;

export function Icon({ name, size = 18, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties | undefined }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={style}>{paths[name]}</svg>;
}
