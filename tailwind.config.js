/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#06B6D4',
        accent: '#FF7A59',
      },
    },
  },
  plugins: [],
}
