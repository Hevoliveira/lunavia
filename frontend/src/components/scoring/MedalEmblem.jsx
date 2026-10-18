/*
 * A LUNAVIA mission medal: a machined ring in the tier's metal around a dark
 * disc with the Moon's crescent and an orbit, the tier's initial at the
 * bottom. `medal` null draws the empty outline (no medal yet).
 */
export const MEDAL_TONE = {
  BRONZE: { a: "#E3A472", b: "#8A5530", c: "#4A2A14", text: "#E8B48A" },
  SILVER: { a: "#F1F4F7", b: "#9AA4AF", c: "#4C5560", text: "#DCE2E8" },
  GOLD: { a: "#FFE38A", b: "#C99A2E", c: "#6B4E0F", text: "#F5D06A" },
  PLATINUM: { a: "#FFFFFF", b: "#A9C8E0", c: "#46657E", text: "#CFE6F7" },
};

export default function MedalEmblem({ medal = null, label = null, size = 96, className = "", glow = false, testId }) {
  const t = MEDAL_TONE[medal];
  const id = `md-${medal || "none"}`;
  if (!t) {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-label="No medal" data-testid={testId} data-medal="none">
        <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="2" strokeDasharray="3 4" />
        <circle cx="50" cy="50" r="30" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.12)" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-label={`${medal} medal`} data-testid={testId} data-medal={medal} style={glow ? { filter: `drop-shadow(0 0 ${size / 7}px ${t.b}88)` } : undefined}>
      <defs>
        <linearGradient id={`${id}-ring`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={t.a} />
          <stop offset="0.5" stopColor={t.b} />
          <stop offset="1" stopColor={t.c} />
        </linearGradient>
        <radialGradient id={`${id}-disc`} cx="0.38" cy="0.32" r="0.8">
          <stop offset="0" stopColor="#1a1c20" />
          <stop offset="1" stopColor="#060607" />
        </radialGradient>
        <clipPath id={`${id}-moon`}>
          <circle cx="50" cy="46" r="15" />
        </clipPath>
      </defs>
      <circle cx="50" cy="50" r="46" fill={`url(#${id}-ring)`} />
      <circle cx="50" cy="50" r="46" fill="none" stroke={t.c} strokeWidth="1" opacity="0.8" />
      {/* knurled edge */}
      {Array.from({ length: 36 }, (_, k) => {
        const a = (k * Math.PI) / 18;
        return <line key={k} x1={50 + 42.5 * Math.cos(a)} y1={50 + 42.5 * Math.sin(a)} x2={50 + 45.5 * Math.cos(a)} y2={50 + 45.5 * Math.sin(a)} stroke={t.c} strokeWidth="0.8" opacity="0.55" />;
      })}
      <circle cx="50" cy="50" r="35" fill={`url(#${id}-disc)`} stroke={t.a} strokeWidth="0.8" opacity="0.98" />
      {/* the Moon, lit from the right */}
      <circle cx="50" cy="46" r="15" fill="#2a2b2f" />
      <g clipPath={`url(#${id}-moon)`}>
        <circle cx="57" cy="44" r="15" fill={t.a} opacity="0.92" />
        <circle cx="55" cy="40" r="2.2" fill={t.b} opacity="0.55" />
        <circle cx="60" cy="50" r="1.6" fill={t.b} opacity="0.5" />
      </g>
      {/* the orbit and the spacecraft on it */}
      <ellipse cx="50" cy="46" rx="25" ry="7" fill="none" stroke={t.a} strokeWidth="0.9" opacity="0.75" transform="rotate(-16 50 46)" />
      <circle cx="72.5" cy="39" r="1.7" fill="#FF3B00" />
      <text x="50" y="74" textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize={(label || medal).length > 6 ? 6.6 : 8} letterSpacing={(label || medal).length > 6 ? 0.8 : 1.6} fill={t.text}>
        {label || medal}
      </text>
    </svg>
  );
}
