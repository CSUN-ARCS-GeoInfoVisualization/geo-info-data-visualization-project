
  import { createRoot } from "react-dom/client";
  import App from "./App.tsx";
  import "./index.css";
  import { warmUpApi } from "./services/api";

  // Kick Render's free-tier API awake immediately so the first user-visible
  // request is more likely to hit a warm instance. Best-effort, ignored on
  // failure — actual retries still happen in apiFetch.
  warmUpApi();

  createRoot(document.getElementById("root")!).render(<App />);
