import React from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import App from "./App";
import Today from "./views/Today";
import "@fontsource/press-start-2p";
import "@fontsource/silkscreen";
import "@fontsource/silkscreen/700.css";
import "@fontsource/vt323";
import "./index.css";
import { initTheme } from "./lib/theme";

initTheme();

const Planner = React.lazy(() => import("./views/Planner"));
const Tasks = React.lazy(() => import("./views/Tasks"));
const Focus = React.lazy(() => import("./views/Focus"));
const Log = React.lazy(() => import("./views/Log"));
const Projects = React.lazy(() => import("./views/Projects"));
const Stats = React.lazy(() => import("./views/Stats"));
const Settings = React.lazy(() => import("./views/Settings"));
const TeamHome = React.lazy(() => import("./team/views/TeamHome"));
const Workspace = React.lazy(() => import("./team/views/Workspace"));

const router = createHashRouter([
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
      { path: "team", element: <TeamHome /> },
      { path: "team/:ws/:tab?", element: <Workspace /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
