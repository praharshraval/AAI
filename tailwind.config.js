/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#2563EB",
        accent:  "#10B981",
        danger:  "#EF4444",
        surface: "#111827",
        card:    "#1F2937",
      },
    },
  },
  plugins: [],
};
