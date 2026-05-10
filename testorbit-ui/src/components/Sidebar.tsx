import React, { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import LogoMark from "./LogoMark";

const navItems = [
  {
    path: "/", label: "Dashboard",
    color: "#0052CC", activeBg: "#DEEBFF",
    icon: (active: boolean) => (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke={active ? "#0052CC" : "#5E6C84"} strokeWidth={1.8}>
        <rect x="3" y="3" width="7" height="7" rx="1.5"/>
        <rect x="14" y="3" width="7" height="7" rx="1.5"/>
        <rect x="3" y="14" width="7" height="7" rx="1.5"/>
        <rect x="14" y="14" width="7" height="7" rx="1.5"/>
      </svg>
    ),
  },
  {
    path: "/generator", label: "Test Generator",
    color: "#FF991F", activeBg: "#FFFAE6",
    icon: (active: boolean) => (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke={active ? "#FF991F" : "#5E6C84"} strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>
      </svg>
    ),
  },
  {
    path: "/execution", label: "Test Execution",
    color: "#36B37E", activeBg: "#E3FCEF",
    icon: (active: boolean) => (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke={active ? "#36B37E" : "#5E6C84"} strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    ),
  },
  {
    path: "/repository", label: "Repository",
    color: "#6554C0", activeBg: "#EAE6FF",
    icon: (active: boolean) => (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke={active ? "#6554C0" : "#5E6C84"} strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
      </svg>
    ),
  },
  {
    path: "/coverage", label: "Test Coverage",
    color: "#00B8D9", activeBg: "#E6FCFF",
    icon: (active: boolean) => (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke={active ? "#00B8D9" : "#5E6C84"} strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
      </svg>
    ),
  },
  {
    path: "/settings", label: "Settings",
    color: "#97A0AF", activeBg: "#F4F5F7",
    icon: (active: boolean) => (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke={active ? "#42526E" : "#5E6C84"} strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
      </svg>
    ),
  },
];

// Deep space logo SVG — reused in both expanded + collapsed states
// LogoMark is imported from ./LogoMark

const BORDER_COLOR = "#DFE1E6";
const TEXT_MUTED   = "#97A0AF";
const TEXT_ACTIVE  = "#172B4D";

const Sidebar: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [creds, setCreds] = useState(() => { try { return JSON.parse(localStorage.getItem("testorbit_jira") || ""); } catch { return null; } });
  const [projectName, setProjectName] = useState(() => localStorage.getItem("testorbit_project_name") || "");

  useEffect(() => {
    const refresh = () => {
      try { setCreds(JSON.parse(localStorage.getItem("testorbit_jira") || "")); } catch { setCreds(null); }
      setProjectName(localStorage.getItem("testorbit_project_name") || "");
    };
    window.addEventListener("testorbit:credentials-saved", refresh);
    return () => window.removeEventListener("testorbit:credentials-saved", refresh);
  }, []);

  return (
    <aside
      className="min-h-screen flex flex-col flex-shrink-0 transition-all duration-200"
      style={{ width: collapsed ? "56px" : "224px", backgroundColor: "#FFFFFF", borderRight: `1px solid ${BORDER_COLOR}` }}
    >
      {/* ── Logo ── */}
      <div
        className="flex items-center flex-shrink-0"
        style={{ height: "56px", padding: collapsed ? "0 12px" : "0 14px", borderBottom: `1px solid ${BORDER_COLOR}` }}
      >
        {!collapsed ? (
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="flex-shrink-0"><LogoMark size={40} /></div>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-sm leading-none tracking-tight" style={{ color: "#172B4D" }}>TestOrbit</div>
              <div className="text-[10px] mt-0.5 font-semibold tracking-widest uppercase" style={{ color: "#97A0AF" }}>AI Agent</div>
            </div>
            <button
              onClick={() => setCollapsed(true)}
              className="w-6 h-6 flex items-center justify-center rounded flex-shrink-0 transition-colors"
              style={{ color: TEXT_MUTED }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = "#F4F5F7"; e.currentTarget.style.color = TEXT_ACTIVE; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = TEXT_MUTED; }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7"/>
              </svg>
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCollapsed(false)}
            className="mx-auto flex-shrink-0 transition-all"
            title="Expand sidebar"
          >
            <LogoMark size={40} />
          </button>
        )}
      </div>

      {/* ── Project badge ── */}
      {!collapsed && creds?.projectKey && (
        <div
          className="mx-3 mt-3 mb-1 px-3 py-2 rounded"
          style={{ backgroundColor: "#F4F5F7", border: `1px solid ${BORDER_COLOR}` }}
        >
          <div className="text-[10px] font-semibold uppercase tracking-widest mb-0.5" style={{ color: TEXT_MUTED }}>Project</div>
          <div className="text-sm font-bold truncate" style={{ color: TEXT_ACTIVE }}>{projectName || creds.projectKey}</div>
        </div>
      )}

      {/* ── Nav ── */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {!collapsed && (
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: TEXT_MUTED }}>
            Navigation
          </div>
        )}
        {navItems.map(({ path, label, color, activeBg, icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === "/"}
            title={collapsed ? label : undefined}
            className="flex items-center rounded text-sm transition-all duration-150"
            style={({ isActive }) => ({
              gap: collapsed ? 0 : "10px",
              padding: collapsed ? "9px 0" : "8px 10px",
              justifyContent: collapsed ? "center" : "flex-start",
              backgroundColor: isActive ? activeBg : "transparent",
              color: isActive ? color : "#5E6C84",
              fontWeight: isActive ? 600 : 400,
              borderLeft: isActive ? `3px solid ${color}` : "3px solid transparent",
            })}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement;
              if (el.style.fontWeight !== "600") {
                el.style.backgroundColor = "#F4F5F7";
                el.style.color = TEXT_ACTIVE;
              }
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement;
              if (el.style.fontWeight !== "600") {
                el.style.backgroundColor = "transparent";
                el.style.color = "#5E6C84";
              }
            }}
          >
            {({ isActive }) => (
              <>
                <span className="flex-shrink-0">{icon(isActive)}</span>
                {!collapsed && <span className="truncate">{label}</span>}
              </>
            )}
          </NavLink>
        ))
        }
      </nav>

      {/* ── User footer ── */}
      <div
        className="flex-shrink-0"
        style={{ borderTop: `1px solid ${BORDER_COLOR}`, padding: collapsed ? "12px 8px" : "12px 16px" }}
      >
        {collapsed ? (
          <div
            className="w-8 h-8 rounded flex items-center justify-center mx-auto text-xs font-bold"
            style={{ backgroundColor: "#EBECF0", color: "#42526E" }}
            title={creds?.email || "Not connected"}
          >
            {creds?.email ? creds.email.charAt(0).toUpperCase() : "?"}
          </div>
        ) : creds?.email ? (
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0 text-xs font-bold"
              style={{ backgroundColor: "#EBECF0", color: "#42526E" }}
            >
              {creds.email.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold truncate" style={{ color: TEXT_ACTIVE }}>{creds.email.split("@")[0]}</div>
              <div className="text-[11px] truncate" style={{ color: TEXT_MUTED }}>{creds.projectKey}</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: "#FF991F" }} />
            <span className="text-xs" style={{ color: TEXT_MUTED }}>Not connected</span>
          </div>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
