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
          DEFAULT: '#2563EB', // Blue 600
          dark: '#1D4ED8',    // Blue 700
          light: '#EFF6FF',   // Blue 50
        },
        navy: {
          base: '#0b1121',
          surface: '#141b2d',
          raised: '#182238',
          border: '#1e293b',
        },
      },
    },
  },
  plugins: [],
}
