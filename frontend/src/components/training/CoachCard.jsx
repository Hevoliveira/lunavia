/*
 * Training Center instructor line, shown inside a game's telemetry column so it
 * never covers the vehicle, the landing zone or the entry guidance.
 */
export default function CoachCard({ tip, className = "" }) {
  if (!tip) return null;
  const tone = { warn: ["border-[#FF3B00]", "text-[#FF3B00]"], good: ["border-emerald-400", "text-emerald-400"] }[tip.tone] || ["border-sky-300/70", "text-sky-300"];
  return (
    <div
      data-testid="training-coach"
      data-tone={tip.tone}
      className={`border-l-2 ${tone[0]} bg-black/55 px-2 py-1 ${className}`}
    >
      <div className={`font-mono text-[8px] tracking-[0.2em] truncate ${tone[1]}`}>
        <span className="short:hidden">INSTRUCTOR · </span>
        {tip.title}
      </div>
      <div className="font-mono text-[9px] leading-snug text-zinc-100 mt-0.5 line-clamp-4" data-testid="training-coach-text">
        {tip.text}
      </div>
    </div>
  );
}
