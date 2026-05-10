import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";

// Credentials persist across refreshes and tabs.
// Use Settings → Reset Configuration to clear them explicitly.

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(<React.StrictMode><App /></React.StrictMode>);
