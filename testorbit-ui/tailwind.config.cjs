/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#1e40af", light: "#3b82f6", dark: "#1e3a8a" },
        surface: { DEFAULT: "#ffffff", muted: "#f8fafc", border: "#e2e8f0" },
        status: { pass: "#16a34a", fail: "#dc2626", pending: "#d97706" }
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] }
    }
  },
  plugins: []
};
