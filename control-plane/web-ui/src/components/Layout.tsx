import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { useRealtimeStore } from "../stores/realtime";
import { useEffect } from "react";

export function Layout() {
  const { user, token, logout } = useAuthStore();
  const { connected, connect } = useRealtimeStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (token) connect(token);
  }, [token, connect]);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="p-4 border-b border-slate-800">
          <h1 className="text-xl font-bold text-blue-400">OpenerX</h1>
          <p className="text-xs text-slate-500 mt-1">Enterprise AI Dev/Ops</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `block px-3 py-2 rounded-lg text-sm ${isActive ? "bg-blue-500/20 text-blue-400" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"}`
            }
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `block px-3 py-2 rounded-lg text-sm ${isActive ? "bg-blue-500/20 text-blue-400" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"}`
            }
          >
            Settings
          </NavLink>
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-400">{user?.displayName}</span>
            <span
              className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`}
              title={connected ? "Connected" : "Disconnected"}
            />
          </div>
          <button
            onClick={handleLogout}
            className="w-full text-xs text-slate-500 hover:text-slate-300 text-left"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
