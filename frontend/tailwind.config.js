/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
        "./features/**/*.{js,ts,jsx,tsx,mdx}",
        "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                // Brand - Primary app color
                brand: {
                    DEFAULT: '#fca200',
                    hover: '#e69200',
                    light: '#fcb84d',
                    dark: '#d48c00'
                },
                // External Services
                spotify: '#1DB954',
                deezer: '#A855F7',
                lastfm: '#D51007',
                // AI/Discovery features (same as deezer for now)
                ai: {
                    DEFAULT: '#A855F7',
                    hover: '#9333EA',
                },
            },
            screens: {
                '3xl': '1920px',  // TV/Large Desktop
                '4xl': '2560px',  // 4K TV/Large TV
            },
        },
    },
    plugins: [],
}