import { useState } from "react";
import { PinchPanDemo } from "./PinchPanDemo";
import { CarouselDemo } from "./CarouselDemo";
import { ScalableCarouselDemo } from "./ScalableCarouselDemo";

type Tab = "pinch-pan" | "carousel" | "scalable-carousel";

export function App() {
  const [tab, setTab] = useState<Tab>("pinch-pan");

  return (
    <div className="flex flex-col h-screen bg-gray-900">
      <header className="flex items-center px-4 py-3 bg-gray-800 shadow text-white shrink-0 gap-6">
        <h1 className="text-lg font-semibold tracking-wide">Mimosa Demo</h1>
        <nav className="flex gap-2">
          <button
            type="button"
            className={`px-3 py-1 rounded text-sm ${tab === "pinch-pan" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"}`}
            onClick={() => setTab("pinch-pan")}
          >
            Pinch / Pan
          </button>
          <button
            type="button"
            className={`px-3 py-1 rounded text-sm ${tab === "carousel" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"}`}
            onClick={() => setTab("carousel")}
          >
            Carousel
          </button>
          <button
            type="button"
            className={`px-3 py-1 rounded text-sm ${tab === "scalable-carousel" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"}`}
            onClick={() => setTab("scalable-carousel")}
          >
            Scalable Carousel
          </button>
        </nav>
      </header>

      {tab === "pinch-pan" && <PinchPanDemo />}
      {tab === "carousel" && <CarouselDemo />}
      {tab === "scalable-carousel" && <ScalableCarouselDemo />}
    </div>
  );
}
