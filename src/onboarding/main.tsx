import React from "react";
import ReactDOM from "react-dom/client";
import "../styles/tokens.css";
import "../components/controls.css";
import "./onboarding.css";
import { initNativeWindow } from "../lib/native";
import { Onboarding } from "./Onboarding";

initNativeWindow();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Onboarding />
  </React.StrictMode>,
);
