import React from "react";
import ReactDOM from "react-dom/client";
import "../styles/tokens.css";
import "../components/controls.css";
import "./control.css";
import { ControlCenter } from "./ControlCenter";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ControlCenter />
  </React.StrictMode>,
);
