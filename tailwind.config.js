/** @type {import('tailwindcss').Config} */
module.exports = {
  mode: "jit",
  darkMode: "class",
  content: [
    "./contents/**/*.tsx",
    "./popup/**/*.tsx",
    "./popup.tsx"
  ],
  plugins: [],
  theme: {
    extend: {
      colors: {
        primary: "#38BDF8",
        success: "#22C55E",
        warning: "#F1A02B",
        neutral: "#0F172A",
      },
      fontFamily: {
        sans: ["Inter", "Urbanist", "sans-serif"],
      },
    }
  }
}
