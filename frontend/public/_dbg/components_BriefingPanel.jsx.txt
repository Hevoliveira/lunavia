import { useState, useRef, useEffect } from "react";
import { Radio, Loader2 } from "lucide-react";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function BriefingPanel({ phase }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    // Clear when phase changes
    setText("");
  }, [phase?.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text]);

  const generate = async () => {
    if (!phase) return;
    setLoading(true);
    setText("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const resp = await fetch(`${API}/mission/briefing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase_id: phase.id, detail_level: "standard" }),
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const chunk of parts) {
          const lines = chunk.split("\n");
          let eventType = "message";
          const dataLines = [];
          for (const line of lines) {
            if (line.startsWith("event:")) eventType = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5));
          }
          const data = dataLines.join("\n");
          if (eventType === "done") continue;
          if (eventType === "error") {
            throw new Error(data || "stream error");
          }
          if (data && data !== "[DONE]") {
            // Restore leading spaces
            acc += data.replace(/^ /, "");
            setText(acc);
          }
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        console.error(e);
        toast.error("Briefing unavailable. Please retry.");
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    if (abortRef.current) abortRef.current.abort();
  };

  return (
    <div
      className="hud-panel p-4 corners relative flex flex-col"
      data-testid="briefing-panel"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Radio size={12} className="text-[#FF3B00]" />
          <span className="font-mono text-[9px] tracking-[0.3em] text-zinc-500">
            FLIGHT DIRECTOR BRIEFING
          </span>
        </div>
        <span className="font-mono text-[9px] tracking-[0.2em] text-zinc-600">
          CLAUDE / SONNET·5
        </span>
      </div>

      <div className="font-display text-lg font-semibold text-white mb-1">
        {phase?.name || "—"}
      </div>
      <div className="font-mono text-[10px] tracking-widest text-zinc-500 mb-3">
        {phase?.code} · {phase?.location}
      </div>

      <div
        ref={scrollRef}
        data-testid="briefing-text"
        className="font-mono text-[12px] leading-relaxed text-zinc-200 whitespace-pre-wrap min-h-[140px] max-h-[240px] overflow-y-auto border border-white/5 bg-black/40 p-3"
      >
        {text || (
          <span className="text-zinc-600 italic">
            Briefing não solicitado. Pressione TRANSMIT para receber a análise
            gerada em tempo real.
          </span>
        )}
        {loading && <span className="blink text-[#FF3B00]">▊</span>}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={generate}
          disabled={loading || !phase}
          data-testid="briefing-transmit-btn"
          className="btn-hud btn-hud-primary flex-1 justify-center disabled:opacity-40"
        >
          {loading ? (
            <>
              <Loader2 size={12} className="animate-spin" /> RECEIVING…
            </>
          ) : (
            <>TRANSMIT</>
          )}
        </button>
        {loading && (
          <button
            onClick={stop}
            data-testid="briefing-stop-btn"
            className="btn-hud"
          >
            ABORT
          </button>
        )}
      </div>
    </div>
  );
}
