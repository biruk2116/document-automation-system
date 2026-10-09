/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0856C3', // Royal Blue
          dark: '#06449E',    // Deep Royal Blue
          light: '#EFF6FF',   // Royal Blue 50
          sidebar: '#FFFFFF', // Full White Sidebar in light mode
        },
        navy: {
          base: '#0B1118',    // Dark background (Meditech dark)
          surface: '#151E2B', // Dark primary surface
          raised: '#1A2536',  // Dark secondary surface
          border: '#1E293B',  // Dark border
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        handwriting: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        edu: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
