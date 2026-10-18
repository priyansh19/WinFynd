import React from "react";
import ReactDOM from "react-dom/client";
import "../styles/tokens.css";
import "../components/controls.css";
import "./onboarding.css";
import { Onboarding } from "./Onboarding";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Onboarding />
  </React.StrictMode>,
);
