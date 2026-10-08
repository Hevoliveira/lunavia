import { useEffect, useState } from "react";

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
