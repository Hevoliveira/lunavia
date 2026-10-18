import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "@/pages/Landing";
import Mission from "@/pages/Mission";
import Training from "@/pages/Training";
import Manifesto from "@/pages/Manifesto";
import Records from "@/pages/Records";
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
          {/* Opening LUNAVIA plays the expedition first (launch → lunar orbit → title →
              START MISSIONS), then MISSIONS / TRAINING. Each entry has its own key so that
              moving between them always starts that entry fresh. */}
          <Route path="/" element={<Mission key="opening" entry="opening" />} />
          <Route path="/mission" element={<Mission key="opening" entry="opening" />} />
          <Route path="/menu" element={<Mission key="menu" entry="menu" />} />
          <Route path="/missions" element={<Mission key="missions" entry="missions" />} />
          <Route path="/home" element={<Landing />} />
          <Route path="/training" element={<Training />} />
          <Route path="/manifesto" element={<Manifesto />} />
          <Route path="/records" element={<Records />} />
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
