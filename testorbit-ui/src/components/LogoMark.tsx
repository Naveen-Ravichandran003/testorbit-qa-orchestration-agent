import React from "react";

const LogoMark = ({ size = 36 }: { size?: number }) => (
  <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: size, height: size }}>
    {/* Deep space background */}
    <rect width="36" height="36" rx="8" fill="#0D1B3E"/>
    {/* Star specks */}
    <circle cx="5"  cy="5"  r="0.6" fill="#FFFFFF" opacity="0.4"/>
    <circle cx="30" cy="6"  r="0.5" fill="#FFFFFF" opacity="0.35"/>
    <circle cx="32" cy="28" r="0.5" fill="#FFFFFF" opacity="0.3"/>
    <circle cx="4"  cy="29" r="0.4" fill="#FFFFFF" opacity="0.3"/>
    <circle cx="22" cy="3"  r="0.4" fill="#4C9AFF" opacity="0.5"/>
    <circle cx="9"  cy="32" r="0.35" fill="#4C9AFF" opacity="0.4"/>
    {/* Outer orbit ring */}
    <circle cx="18" cy="18" r="15" stroke="#2684FF" strokeWidth="0.8" opacity="0.25"/>
    {/* Mid orbit ring */}
    <circle cx="18" cy="18" r="10" stroke="#4C9AFF" strokeWidth="0.8" opacity="0.2"/>
    {/* Core */}
    <circle cx="18" cy="18" r="7" fill="#0052CC"/>
    {/* Inner white ring */}
    <circle cx="18" cy="18" r="4" stroke="#FFFFFF" strokeWidth="1.2" opacity="0.25"/>
    {/* Center white dot */}
    <circle cx="18" cy="18" r="1.8" fill="#FFFFFF"/>
    {/* Satellite top-right on outer ring */}
    <circle cx="27.6" cy="8.4" r="2"   fill="#2684FF"/>
    <circle cx="27.6" cy="8.4" r="0.9" fill="#FFFFFF"/>
    {/* Satellite bottom-left on mid ring */}
    <circle cx="10.5" cy="26.5" r="1.4" fill="#4C9AFF" opacity="0.7"/>
    {/* Connector line */}
    <line x1="18" y1="18" x2="26.5" y2="9.5" stroke="#FFFFFF" strokeWidth="0.7" opacity="0.2" strokeLinecap="round"/>
  </svg>
);

export default LogoMark;
