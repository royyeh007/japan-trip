import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { TripProvider } from "./trip";
import { captureInvite } from "./supabase";
import "./styles.css";

captureInvite();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TripProvider>
      <App />
    </TripProvider>
  </StrictMode>,
);
