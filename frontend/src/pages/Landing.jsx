import { Link } from "react-router-dom";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import EarthMoonHero from "@/components/EarthMoonHero";
import BuildBadge from "@/components/BuildBadge";

const MANIFESTO_LINES = [
  "TERRA",
  "↓",
  "ESPAÇO CISLUNAR",
  "↓",
  "LUA",
];

const PHASES_PREVIEW = [
  { code: "T+00:00:00", name: "LIFTOFF", detail: "Cabo Canaveral · 28.5°N" },
  { code: "T+00:11:30", name: "LEO INSERTION", detail: "185 km · 7.79 km/s" },
  { code: "T+02:44:00", name: "TRANS-LUNAR INJECTION", detail: "Δv 3.14 km/s" },
  { code: "T+03:00:00", name: "CISLUNAR CRUISE", detail: "72 horas balísticas" },
  { code: "T+75:56:00", name: "LUNAR ORBIT INSERTION", detail: "Δv 0.91 km/s" },
  { code: "T+80:00:00", name: "LUNAR ORBIT", detail: "100 km circular" },
  { code: "T+140:00:00", name: "TRANS-EARTH INJECTION", detail: "Δv 1.07 km/s" },
  { code: "T+195:00:00", name: "REENTRY", detail: "10.9 km/s · Pacífico" },
];

export default function Landing() {
  return (
    <main data-testid="landing-page" className="relative bg-[#050505] text-white safe-px">
      {/* HERO */}
      <section className="relative h-screen short:h-auto short:min-h-screen w-full overflow-hidden" data-testid="hero">
        <EarthMoonHero />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-[#050505]" />

        {/* corner markers */}
        <div className="absolute inset-8 border border-white/10 pointer-events-none" />

        <div className="relative z-10 h-full max-w-[1600px] mx-auto px-6 md:px-12 flex flex-col justify-between pt-24 pb-16 short:pt-16 short:pb-6 short:gap-5">
          {/* Top bar */}
          <div className="flex items-start justify-between fade-in">
            <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-400 max-w-xs">
              <div>MISSION LV-001 / ROAD-TO-MOON</div>
              <div className="text-zinc-600 mt-1">
                LAT 28.5°N · LON −80.6°W · WINDOW OPEN
              </div>
              <BuildBadge className="!text-zinc-400" />
            </div>
            <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-400 text-right">
              <div>SYSTEMS · NOMINAL</div>
              <div className="text-[#FF3B00] mt-1 blink">● T-00:00:10</div>
            </div>
          </div>

          {/* Center — title */}
          <div className="max-w-3xl">
            <div className="font-mono text-[10px] tracking-[0.4em] text-zinc-400 mb-6 short:mb-2 scan-in">
              LUNAVIA · FASE 0
            </div>
            <h1
              className="font-display font-black text-6xl sm:text-7xl md:text-8xl short:text-5xl tracking-tight leading-[0.9]"
              data-testid="hero-title"
            >
              THE ROAD<br />
              <span className="text-[#FF3B00]">TO THE MOON</span>
            </h1>
            <p className="mt-8 short:mt-3 text-zinc-300 text-lg short:text-sm max-w-xl leading-relaxed">
              Um simulador realista da viagem entre a Terra e a Lua.
              Não é sobre voar para cima — é sobre entrar em órbita, partir no
              instante correto, atravessar o vazio e voltar para casa.
            </p>
            <div className="mt-10 short:mt-4 flex flex-wrap gap-4">
              <Link
                to="/mission"
                data-testid="hero-cta-mission"
                className="btn-hud btn-hud-primary"
              >
                INICIAR MISSÃO <ArrowUpRight size={14} />
              </Link>
              <Link
                to="/training"
                data-testid="hero-cta-training"
                className="btn-hud"
              >
                FLIGHT TRAINING <ChevronRight size={14} />
              </Link>
              <Link
                to="/manifesto"
                data-testid="hero-cta-manifesto"
                className="btn-hud"
              >
                LER MANIFESTO
              </Link>
            </div>
          </div>

          {/* Bottom coord strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 font-mono text-[10px] tracking-widest text-zinc-500 border-t border-white/10 pt-4">
            <div><span className="text-zinc-700">Δv total</span> <span className="text-white ml-2 tabular">15,100 m/s</span></div>
            <div><span className="text-zinc-700">Distância</span> <span className="text-white ml-2 tabular">384,400 km</span></div>
            <div><span className="text-zinc-700">Duração</span> <span className="text-white ml-2 tabular">195 h</span></div>
            <div><span className="text-zinc-700">Escala</span> <span className="text-white ml-2 tabular">1:1 REAL</span></div>
          </div>
        </div>
      </section>

      {/* NORTH STAR */}
      <section
        data-testid="north-star"
        className="relative border-t border-white/10 py-32 px-6 md:px-12"
      >
        <div className="max-w-[1600px] mx-auto grid grid-cols-12 gap-8">
          <div className="col-span-12 md:col-span-3">
            <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500">
              §01 · NORTH STAR
            </div>
          </div>
          <div className="col-span-12 md:col-span-9">
            <h2 className="font-display text-4xl md:text-5xl leading-tight tracking-tight max-w-4xl">
              Ao olhar para a Lua depois de jogar LUNAVIA,{" "}
              <span className="text-zinc-500">
                o jogador deve compreender que chegar até ela não significa
                simplesmente "voar para cima".
              </span>
            </h2>
            <div className="mt-10 grid md:grid-cols-3 gap-6">
              {[
                { n: "01", t: "Entrar em órbita", d: "A velocidade orbital vem antes da direção. Você não sobe — você acelera lateralmente até cair sem parar." },
                { n: "02", t: "Partir no instante correto", d: "A Lua se move a 1 km/s. Um erro de 30 minutos na queima translunar significa 1 800 km de erro na chegada." },
                { n: "03", t: "Voltar para casa", d: "A reentrada é uma bomba de 10.9 km/s convertendo-se em calor. Cada partícula da atmosfera importa." },
              ].map((item) => (
                <div
                  key={item.n}
                  className="corners relative border border-white/10 p-6 bg-black/30"
                >
                  <div className="font-mono text-[10px] tracking-[0.3em] text-[#FF3B00]">
                    {item.n}
                  </div>
                  <div className="font-display font-semibold text-xl mt-3">
                    {item.t}
                  </div>
                  <div className="text-sm text-zinc-400 mt-3 leading-relaxed">
                    {item.d}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FLIGHT PLAN */}
      <section
        data-testid="flight-plan"
        className="border-t border-white/10 py-32 px-6 md:px-12 grid-bg"
      >
        <div className="max-w-[1600px] mx-auto grid grid-cols-12 gap-8">
          <div className="col-span-12 md:col-span-3">
            <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500">
              §02 · FLIGHT PLAN
            </div>
            <h2 className="font-display text-3xl md:text-4xl tracking-tight mt-4">
              Nove fases.<br />
              Um caminho.
            </h2>
            <p className="text-sm text-zinc-400 mt-4 leading-relaxed max-w-xs">
              Cada fase é um problema físico distinto. LUNAVIA simula todas com
              números baseados em missões Apollo-class.
            </p>
          </div>
          <div className="col-span-12 md:col-span-9">
            <div className="divide-y divide-white/10 border-y border-white/10">
              {PHASES_PREVIEW.map((p, idx) => (
                <div
                  key={p.code}
                  className="grid grid-cols-12 gap-4 py-5 items-center hover:bg-white/[0.02] transition-colors duration-200"
                  data-testid={`phase-row-${idx}`}
                >
                  <div className="col-span-2 md:col-span-1 font-mono text-[10px] tabular text-zinc-500">
                    {String(idx + 1).padStart(2, "0")}
                  </div>
                  <div className="col-span-4 md:col-span-3 font-mono text-[11px] tracking-widest text-zinc-300 tabular">
                    {p.code}
                  </div>
                  <div className="col-span-6 md:col-span-4 font-display font-semibold text-lg">
                    {p.name}
                  </div>
                  <div className="col-span-12 md:col-span-4 font-mono text-[11px] text-zinc-500 tracking-wider">
                    {p.detail}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-8">
              <Link
                to="/mission"
                data-testid="flight-plan-cta"
                className="btn-hud"
              >
                EXECUTAR MISSÃO <ChevronRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* IDENTITY */}
      <section
        data-testid="identity"
        className="border-t border-white/10 py-32 px-6 md:px-12"
      >
        <div className="max-w-[1600px] mx-auto grid grid-cols-12 gap-8 items-start">
          <div className="col-span-12 md:col-span-6 order-2 md:order-1">
            <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500 mb-6">
              §03 · IDENTITY
            </div>
            <h2 className="font-display text-4xl md:text-5xl tracking-tight leading-tight">
              O universo inicial é <br />
              <span className="text-zinc-500">deliberadamente pequeno.</span>
            </h2>
            <div className="mt-8 text-zinc-300 leading-relaxed space-y-4">
              <p>
                LUNAVIA não representa todo o Sistema Solar. Representa o
                caminho entre a Terra e a Lua com uma profundidade impossível
                em qualquer jogo que tente cobrir todos os planetas.
              </p>
              <p>
                Essa limitação é uma força. Cada quilômetro entre nós e a Lua
                merece ser vivido em tempo real, escala real, gravidade real.
              </p>
            </div>
          </div>
          <div className="col-span-12 md:col-span-6 order-1 md:order-2">
            <div className="hud-panel corners relative p-10 bg-black/60">
              <div className="font-mono text-[10px] tracking-[0.3em] text-[#FF3B00] mb-6">
                MISSION ARCHITECTURE
              </div>
              <div className="space-y-2 font-mono text-2xl md:text-3xl font-light tracking-widest text-white">
                {MANIFESTO_LINES.map((l, i) => (
                  <div
                    key={i}
                    className={l === "↓" ? "text-[#FF3B00] text-lg" : "font-display font-bold"}
                  >
                    {l}
                  </div>
                ))}
              </div>
              <div className="mt-10 border-t border-white/10 pt-4 font-mono text-[10px] text-zinc-500 tracking-widest">
                FASE · 00 / EARTH · MOON / RETURN
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer
        data-testid="footer"
        className="border-t border-white/10 py-12 px-6 md:px-12"
      >
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <div className="font-display font-bold text-2xl">LUNAVIA</div>
            <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500 mt-1">
              THE ROAD TO THE MOON · FASE 0
            </div>
            <BuildBadge />
          </div>
          <div className="font-mono text-[10px] tracking-widest text-zinc-600 max-w-md">
            "A viagem é o jogo."
          </div>
        </div>
      </footer>
    </main>
  );
}
