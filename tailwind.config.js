/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Buglasan Festival color palette - vibrant Philippine fiesta aesthetic
        fiesta: {
          red: '#E53E3E',
          'red-dark': '#C53030',
          'red-light': '#FC8181',
          orange: '#DD6B20',
          'orange-dark': '#C05621',
          'orange-light': '#FBD38D',
          yellow: '#D69E2E',
          'yellow-dark': '#B7791F',
          'yellow-light': '#FAF089',
          green: '#38A169',
          'green-dark': '#2F855A',
          'green-light': '#9AE6B4',
          blue: '#3182CE',
          'blue-dark': '#2C5282',
          'blue-light': '#90CDF4',
          purple: '#805AD5',
          'purple-dark': '#6B46C1',
          'purple-light': '#D6BCFA',
          pink: '#D53F8C',
          'pink-dark': '#B83280',
          'pink-light': '#FBB6CE',
        },
        // Neutral tones for text and backgrounds
        neutral: {
          50: '#FAFAFA',
          100: '#F5F5F5',
          200: '#E5E5E5',
          300: '#D4D4D4',
          400: '#A3A3A3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Poppins', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
    },
  },
  plugins: [],
}