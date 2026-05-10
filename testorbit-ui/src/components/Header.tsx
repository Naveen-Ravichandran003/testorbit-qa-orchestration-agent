import React from "react";

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

const Header: React.FC<HeaderProps> = ({ title, subtitle, actions }) => (
  <div
    className="flex items-center justify-between flex-shrink-0"
    style={{
      padding: "0 24px",
      height: "56px",
      backgroundColor: "#fff",
      borderBottom: "1px solid #e2e8f0",
    }}
  >
    <div className="flex items-center gap-3 min-w-0">
      {/* Teal accent bar */}
      <div
        className="flex-shrink-0 rounded-full"
        style={{ width: "3px", height: "22px", background: "linear-gradient(180deg, #0e7490 0%, #0891b2 100%)" }}
      />
      <div className="min-w-0">
        <h1
          className="font-semibold leading-none truncate"
          style={{ fontSize: "18px", color: "#0f2d3d", letterSpacing: "-0.01em" }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs mt-0.5 truncate" style={{ color: "#64748b" }}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
    {actions && (
      <div className="flex items-center gap-2 flex-shrink-0 ml-4">{actions}</div>
    )}
  </div>
);

export default Header;
