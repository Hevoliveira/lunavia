import { useEffect, useState } from "react";
import { buildLabelParts, bundleName, IS_NATIVE } from "@/lib/buildInfo";
import { useCompact } from "@/hooks/useMediaQuery";

/**
 * Build identity of the running web bundle. Tap to show layout diagnostics
 * (viewport, phone layout on/off, bundle fingerprint) for install checks.
 */
export default function BuildBadge({ className = "" }) {
  const compact = useCompact();
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState(() => `${window.innerWidth}×${window.innerHeight}`);
  useEffect(() => {
    const onResize = () => setSize(`${window.innerWidth}×${window.innerHeight}`);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <button
      type="button"
      data-testid="build-badge"
      onClick={() => setOpen((o) => !o)}
      className={`block text-left font-mono text-[10px] tracking-[0.2em] text-zinc-500 py-2 touch:min-h-[44px] ${className}`}
    >
      <span data-testid="build-label">
        {buildLabelParts().map((part, i) => (
          <span key={part} className="inline-block whitespace-nowrap">
            {i > 0 && <span className="px-[0.6em]">·</span>}
            {part}
          </span>
        ))}
      </span>
      {open && (
        <span data-testid="build-diagnostics" className="block mt-1 text-zinc-600 normal-case tracking-[0.1em]">
          {bundleName()} · VIEW {size} · PHONE LAYOUT {compact ? "ON" : "OFF"} · {IS_NATIVE ? "NATIVE" : "BROWSER"}
        </span>
      )}
    </button>
  );
}
