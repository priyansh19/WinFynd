import React from "react";
import ReactDOM from "react-dom/client";
import "../styles/tokens.css";
import "../components/controls.css";
import "./control.css";
import { initNativeWindow } from "../lib/native";
import { ControlCenter } from "./ControlCenter";

initNativeWindow();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ControlCenter />
  </React.StrictMode>,
);
