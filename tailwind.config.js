/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      fontFamily: {
        serif:   ['"DM Serif Display"', 'Georgia', 'serif'],
        sans:    ['"DM Sans"', 'system-ui', 'sans-serif'],
        display: ['"DxGrafik"', 'Georgia', 'serif'],
      },
      colors: {
        bg:      '#FAF8F5',
        'bg-subtle': '#F3F0EA',
        surface: '#EDEBE4',
        border:  '#E5E0D8',
        text:    '#1A1714',
        muted:   '#8C8680',
        accent:  '#F76B15',
        'accent-dim': '#FDE8D8',
      },
    },
  },
  plugins: [],
}
