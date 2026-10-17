import React from "react";
import ReactDOM from "react-dom/client";
import "../styles/tokens.css";
import "./launcher.css";
import { Launcher } from "./Launcher";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Launcher />
  </React.StrictMode>,
);
