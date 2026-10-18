import React from "react";
import ReactDOM from "react-dom/client";
import "../styles/tokens.css";
import "../components/controls.css";
import "./launcher.css";
import { initNativeWindow } from "../lib/native";
import { Launcher } from "./Launcher";

initNativeWindow();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Launcher />
  </React.StrictMode>,
);
