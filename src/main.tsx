import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Bar from "./Bar";
import "./index.css";

// The Electron overlay loads the same bundle with ?overlay — one build serves
// both the summoned bar and the full window.
const overlay = new URLSearchParams(location.search).has("overlay");
if (overlay) document.documentElement.classList.add("overlay-mode");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{overlay ? <Bar /> : <App />}</StrictMode>,
);
