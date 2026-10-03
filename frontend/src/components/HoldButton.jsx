import { useEffect, useRef, useState } from "react";

/**
 * HoldButton — a flight control that is "on" while held.
 *
 * Pointer events cover mouse, touch and pen with one code path. Each finger is
 * tracked by pointerId, so several HoldButtons can be held at once (throttle +
 * RCS, roll + trim). The control is released on pointerup, pointercancel (iOS
 * system gestures, incoming calls), lost capture, window blur and unmount, so
 * an input can never stay stuck on.
 */
export default function HoldButton({ onHold, className = "", children, ...rest }) {
  const [pressed, setPressed] = useState(false);
  const pointers = useRef(new Set());
  const onHoldRef = useRef(onHold);
  onHoldRef.current = onHold;

  const release = () => {
    if (pointers.current.size === 0) return;
    pointers.current.clear();
    setPressed(false);
    onHoldRef.current(false);
  };

  const down = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {}
    if (pointers.current.size === 0) {
      setPressed(true);
      onHoldRef.current(true);
    }
    pointers.current.add(e.pointerId);
  };

  const up = (e) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size === 0) {
      setPressed(false);
      onHoldRef.current(false);
    }
  };

  useEffect(() => {
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("blur", release);
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      type="button"
      className={`touch-ctrl ${className}`}
      data-pressed={pressed}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onContextMenu={(e) => e.preventDefault()}
      {...rest}
    >
      {children}
    </button>
  );
}
