import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "@/pages/Landing";
import Mission from "@/pages/Mission";
import Training from "@/pages/Training";
import Manifesto from "@/pages/Manifesto";
import Navbar from "@/components/Navbar";
import CommsSubtitles from "@/components/CommsSubtitles";
import { Toaster } from "sonner";
import { useCompact } from "@/hooks/useMediaQuery";

function App() {
  // Landscape phones: mission toasts go bottom-left and narrow, clear of the
  // vehicle, the mission clock and abort.
  const compact = useCompact();
  return (
    <div className="App grain" data-testid="lunavia-app">
      <BrowserRouter>
        <Navbar />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/mission" element={<Mission />} />
          <Route path="/training" element={<Training />} />
          <Route path="/manifesto" element={<Manifesto />} />
        </Routes>
        <CommsSubtitles />
        <Toaster
          theme="dark"
          position={compact ? "bottom-left" : "bottom-right"}
          offset={compact ? { bottom: "calc(var(--sab) + 10px)", left: "calc(var(--sal) + 12px)" } : undefined}
          toastOptions={compact ? { style: { width: 230, padding: "8px 12px", fontSize: 11 } } : undefined}
        />
      </BrowserRouter>
    </div>
  );
}

export default App;
