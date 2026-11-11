import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Inject Midtrans client key ke script tag yang sudah ada di index.html
// dan ganti URL sandbox vs production sesuai env.
const midtransScript = document.getElementById("midtrans-snap-script") as HTMLScriptElement | null;
if (midtransScript) {
  const clientKey = import.meta.env["VITE_MIDTRANS_CLIENT_KEY"] as string | undefined;
  const isProd = import.meta.env["VITE_MIDTRANS_IS_PRODUCTION"] === "true";
  if (clientKey) midtransScript.setAttribute("data-client-key", clientKey);
  midtransScript.src = isProd
    ? "https://app.midtrans.com/snap/snap.js"
    : "https://app.sandbox.midtrans.com/snap/snap.js";
}

createRoot(document.getElementById("root")!).render(<App />);
