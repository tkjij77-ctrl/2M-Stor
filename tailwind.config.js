/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "var(--primary)",
        "primary-dark": "var(--primary-dark)",
        "primary-light": "var(--primary-light)",
      },
      borderRadius: { DEFAULT: "var(--radius)" },
      fontFamily: { tajawal: ["Tajawal", "sans-serif"] },
    },
  },
  plugins: [],
};
