import React from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import App from "./App";
import Today from "./views/Today";
import Planner from "./views/Planner";
import Tasks from "./views/Tasks";
import Focus from "./views/Focus";
import Log from "./views/Log";
import Projects from "./views/Projects";
import Stats from "./views/Stats";
import Settings from "./views/Settings";
import Overlay from "./views/Overlay";
import "@fontsource/press-start-2p";
import "@fontsource/silkscreen";
import "@fontsource/silkscreen/700.css";
import "@fontsource/vt323";
import "./index.css";

const router = createHashRouter([
  { path: "/overlay", element: <Overlay /> },
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Today /> },
      { path: "planner", element: <Planner /> },
      { path: "projects", element: <Projects /> },
      { path: "tasks", element: <Tasks /> },
      { path: "focus", element: <Focus /> },
      { path: "log", element: <Log /> },
      { path: "stats", element: <Stats /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
