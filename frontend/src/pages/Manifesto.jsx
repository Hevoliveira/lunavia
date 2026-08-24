import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";

const SECTIONS = [
  {
    tag: "§01",
    title: "IDENTIDADE",
    body: [
      "LUNAVIA é um jogo de exploração espacial e simulação de missões lunares.",
      "Seu universo inicial é deliberadamente pequeno: Terra → Espaço Cislunar → Lua.",
      "Essa limitação é uma força. O objetivo não é representar todo o Sistema Solar. O objetivo é representar o caminho entre a Terra e a Lua com uma profundidade, escala e fidelidade que seriam impossíveis num jogo que tentasse representar todos os planetas.",
    ],
  },
  {
    tag: "§02",
    title: "FANTASIA CENTRAL",
    body: [
      "O jogador não escolhe simplesmente 'ir à Lua'.",
      "Ele acompanha e conduz a viagem.",
      "Da superfície terrestre, à órbita, à injeção translunar, ao espaço profundo, à chegada à Lua, e eventualmente ao retorno à Terra.",
      "A viagem é o jogo.",
    ],
  },
  {
    tag: "§03",
    title: "NORTH STAR",
    body: [
      "Ao olhar para a Lua depois de jogar LUNAVIA, o jogador deve compreender que chegar até ela não significa simplesmente 'voar para cima'.",
      "Significa entrar em órbita, partir no instante correto, atravessar o espaço Terra–Lua, encontrar um mundo que também está se movendo, e voltar para casa.",
    ],
  },
];

export default function Manifesto() {
  return (
    <main
      data-testid="manifesto-page"
      className="min-h-screen bg-[#050505] text-white pt-32 pb-24 px-6 md:px-12"
    >
      <div className="max-w-[1200px] mx-auto">
        <div className="font-mono text-[10px] tracking-[0.4em] text-zinc-500">
          LUNAVIA · FASE 0 · VISÃO, REALISMO E ARQUITETURA
        </div>
        <h1
          data-testid="manifesto-title"
          className="mt-6 font-display text-6xl md:text-8xl font-black tracking-tight"
        >
          THE ROAD<br />
          <span className="text-[#FF3B00]">TO THE MOON</span>
        </h1>

        <div className="mt-20 space-y-24">
          {SECTIONS.map((s) => (
            <section
              key={s.tag}
              className="grid grid-cols-12 gap-6 border-t border-white/10 pt-10"
              data-testid={`manifesto-${s.tag.replace("§", "sec-")}`}
            >
              <div className="col-span-12 md:col-span-3">
                <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500">
                  {s.tag}
                </div>
                <div className="font-display text-xl mt-2 font-bold tracking-tight">
                  {s.title}
                </div>
              </div>
              <div className="col-span-12 md:col-span-9 space-y-4 text-zinc-300 leading-relaxed text-lg">
                {s.body.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-24 border-t border-white/10 pt-10 flex flex-wrap gap-4">
          <Link
            to="/mission"
            data-testid="manifesto-cta"
            className="btn-hud btn-hud-primary"
          >
            EXECUTAR MISSÃO <ArrowUpRight size={14} />
          </Link>
          <Link to="/" data-testid="manifesto-back" className="btn-hud">
            VOLTAR AO CENTRO DE CONTROLE
          </Link>
        </div>
      </div>
    </main>
  );
}
