import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ActionSourceView } from "./components/ActionSourceView";
import "./index.css";
import "./index.dark.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {new URL(window.location.href).searchParams.get("view") === "action-source" ? <ActionSourceView /> : <App />}
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const base = new URL(import.meta.env.BASE_URL, window.location.href);
    void navigator.serviceWorker.register(new URL("sw.js", base).pathname, { scope: base.pathname });
  });
}
