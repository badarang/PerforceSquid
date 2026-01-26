/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'p4-dark': '#1e1e1e',
        'p4-darker': '#141414',
        'p4-border': '#3c3c3c',
        'p4-blue': '#0078d4',
        'p4-green': '#2ea043',
        'p4-red': '#f85149',
        'p4-yellow': '#d29922',
      },
      keyframes: {
        'doom-chit': {
          '0%, 100%': { transform: 'scale(1, 1) rotate(0deg)' },
          '25%': { transform: 'scale(1.3, 0.7) rotate(-15deg)' },
          '50%': { transform: 'scale(0.7, 1.3) rotate(0deg)' },
          '75%': { transform: 'scale(1.3, 0.7) rotate(15deg)' },
        }
      },
      animation: {
        'doom-chit': 'doom-chit 1s ease-in-out infinite',
      }
    },
  },
  plugins: [],
}
