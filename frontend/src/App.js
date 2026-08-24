import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "@/pages/Landing";
import Mission from "@/pages/Mission";
import Manifesto from "@/pages/Manifesto";
import Navbar from "@/components/Navbar";
import { Toaster } from "sonner";

function App() {
  return (
    <div className="App grain" data-testid="lunavia-app">
      <BrowserRouter>
        <Navbar />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/mission" element={<Mission />} />
          <Route path="/manifesto" element={<Manifesto />} />
        </Routes>
        <Toaster theme="dark" position="bottom-right" />
      </BrowserRouter>
    </div>
  );
}

export default App;
