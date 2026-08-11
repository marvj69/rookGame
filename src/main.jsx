import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./App.css";

createRoot(document.getElementById("root")).render(<App />);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`, {
      scope: import.meta.env.BASE_URL,
    }).catch((error) => {
      console.error("Service worker registration failed:", error);
    });
  });
}
