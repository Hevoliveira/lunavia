import "@/App.css";
import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "@/pages/Landing";
import Mission from "@/pages/Mission";
import Training from "@/pages/Training";
import ApolloLegacy from "@/pages/ApolloLegacy";
import Manifesto from "@/pages/Manifesto";
import Records from "@/pages/Records";
import Navbar from "@/components/Navbar";
import CommsSubtitles from "@/components/CommsSubtitles";
import { Toaster } from "sonner";
import { useCompact } from "@/hooks/useMediaQuery";

// Development only (stripped from production builds): the lunar EVA on its own, for checking the
// astronaut and the scene without flying a mission to it.
const EvaPreview = process.env.NODE_ENV === "development" ? lazy(() => import("@/pages/EvaPreview")) : null;

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
          <Route path="/legacy" element={<ApolloLegacy />} />
          <Route path="/manifesto" element={<Manifesto />} />
          <Route path="/records" element={<Records />} />
          {EvaPreview && (
            <Route
              path="/dev/eva"
              element={
                <Suspense fallback={null}>
                  <EvaPreview />
                </Suspense>
              }
            />
          )}
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
