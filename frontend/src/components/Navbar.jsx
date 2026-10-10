import { Link, useLocation } from "react-router-dom";
import { Circle } from "lucide-react";

export default function Navbar() {
  const { pathname } = useLocation();

  const link = (to, label, testId) => (
    <Link
      to={to}
      data-testid={testId}
      className={`text-[11px] tracking-[0.22em] uppercase font-mono transition-colors duration-200 short:py-3.5 short:px-1 ${
        pathname === to ? "text-white" : "text-zinc-500 hover:text-white"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <header
      data-testid="global-nav"
      className="fixed top-0 left-0 right-0 z-50 hud-panel border-b border-white/10 safe-pt safe-px"
    >
      <div className="max-w-[1600px] mx-auto px-6 md:px-10 h-14 short:h-11 flex items-center justify-between">
        <Link
          to="/"
          data-testid="nav-logo"
          className="flex items-center gap-3 group short:py-2"
        >
          <Circle
            size={10}
            className="text-[#FF3B00] fill-[#FF3B00] blink"
            strokeWidth={0}
          />
          <span className="font-display text-lg font-bold tracking-tight text-white">
            LUNAVIA
          </span>
          <span className="hidden md:inline-block short:hidden text-[10px] font-mono tracking-[0.3em] text-zinc-500 pl-3 border-l border-white/10">
            THE ROAD TO THE MOON
          </span>
        </Link>

        <nav className="flex items-center gap-8 short:gap-5">
          {link("/", "Home", "nav-home")}
          {link("/mission", "Mission", "nav-mission")}
          {link("/training", "Training", "nav-training")}
          {link("/manifesto", "Manifesto", "nav-manifesto")}
          <a
            data-testid="nav-launch-btn"
            href="/mission"
            className="btn-hud !py-2 !px-4 short:!py-3"
          >
            LAUNCH
          </a>
        </nav>
      </div>
    </header>
  );
}
