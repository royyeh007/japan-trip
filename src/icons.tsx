import type { Mode } from "./data";

const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

const car = (
  <svg {...base}><path d="M3 16V8a2 2 0 0 1 2-2h11l5 5v5H3z" /><path d="M3 11h18" /><circle cx="7" cy="17" r="1.6" /><circle cx="17" cy="17" r="1.6" /></svg>
);

export const ModeIcon = ({ mode }: { mode: Mode }) => {
  switch (mode) {
    case "taxi":
      return <svg {...base}><path d="M5 17h14v-5l-2-5H7l-2 5v5z" /><path d="M3 12h18" /><circle cx="7.5" cy="17.5" r="1.5" /><circle cx="16.5" cy="17.5" r="1.5" /></svg>;
    case "walk":
      return <svg {...base}><circle cx="13" cy="4" r="2" /><path d="M10 21l2-6 3 3v3M9 12l2-4 4 2 2 3M11 8l-2 5" /></svg>;
    case "train":
      return <svg {...base}><rect x="5" y="3" width="14" height="13" rx="3" /><path d="M5 10h14M9 20l-2 2M15 20l2 2" /><circle cx="9" cy="13" r=".8" /><circle cx="15" cy="13" r=".8" /></svg>;
    case "bus":
      return <svg {...base}><rect x="4" y="3" width="16" height="15" rx="2" /><path d="M4 11h16M8 18v2M16 18v2" /></svg>;
    case "flight":
      return <svg {...base}><path d="M2 16l20-6-3-2-6 1-6-5H5l3 6-4 1-2-2H1z" /></svg>;
    default:
      return car;
  }
};

export const PinIcon = () => (
  <svg {...base}><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></svg>
);

export const RouteIcon = () => (
  <svg {...base}><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h8a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h8" /></svg>
);

export const DownloadIcon = () => (
  <svg {...base}><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 19h16" /></svg>
);
