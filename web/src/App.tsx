import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import { createContext, useContext, useState, useCallback } from "react";
import Chat from "./pages/Chat";
import Dashboard from "./pages/Dashboard";
import Traces from "./pages/Traces";
import Settings from "./pages/Settings";

export type Theme = "default" | "amber" | "matrix";

interface AppState {
  verboseLogs: string[];
  addLog: (text: string) => void;
  clearLogs: () => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
}

export const AppContext = createContext<AppState>({
  verboseLogs: [], addLog: () => {}, clearLogs: () => {},
  theme: "default", setTheme: () => {},
});

export function useAppContext() { return useContext(AppContext); }

function Nav() {
  const cls = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-2 rounded text-sm font-medium transition-colors ${isActive ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"}`;
  return (
    <nav className="flex items-center gap-1 px-4 py-3 bg-slate-900 border-b border-slate-800">
      <span className="text-white font-bold mr-4">⚡ AgentSchitzo</span>
      <NavLink to="/chat" className={cls}>Chat</NavLink>
      <NavLink to="/dashboard" className={cls}>Dashboard</NavLink>
      <NavLink to="/traces" className={cls}>Traces</NavLink>
      <NavLink to="/settings" className={cls}>Settings</NavLink>
    </nav>
  );
}

export default function App() {
  const [verboseLogs, setVerboseLogs] = useState<string[]>([]);
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem("theme") as Theme) ?? "default");
  const setTheme = useCallback((t: Theme) => { localStorage.setItem("theme", t); setThemeState(t); }, []);
  const addLog = useCallback((text: string) => {
    setVerboseLogs((prev) => [...prev.slice(-99), text]);
  }, []);
  const clearLogs = useCallback(() => setVerboseLogs([]), []);

  return (
    <AppContext.Provider value={{ verboseLogs, addLog, clearLogs, theme, setTheme }}>
      <BrowserRouter>
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
          <Nav />
          <main className="flex-1 overflow-hidden">
            <Routes>
              <Route path="/" element={<Navigate to="/chat" replace />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/traces" element={<Traces />} />
              <Route path="/traces/:id" element={<Traces />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </AppContext.Provider>
  );
}
