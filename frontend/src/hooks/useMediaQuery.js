import { useEffect, useState } from "react";
import { IS_NATIVE } from "@/lib/buildInfo";

/** True while the CSS media query matches; follows rotation and resizes. */
export default function useMediaQuery(query) {
  const get = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Landscape phone: the layout breakpoint Tailwind calls `short`. */
export const COMPACT_QUERY = "(max-height: 520px)";

/**
 * Phone layout. Always on inside the native iPhone app (landscape only, so
 * the screen is always short), whatever the web view reports for its height.
 */
export function useCompact() {
  return useMediaQuery(COMPACT_QUERY) || IS_NATIVE;
}
