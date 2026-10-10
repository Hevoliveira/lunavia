const plugin = require("tailwindcss/plugin");

/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    // Touch screens get no sticky :hover styles after a tap.
    future: { hoverOnlyWhenSupported: true },
    content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      screens: {
        // Touch-first devices: keyboard hints are hidden, touch controls stay.
        touch: { raw: "(hover: none) and (pointer: coarse)" },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))'
        }
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0'
          },
          to: {
            height: 'var(--radix-accordion-content-height)'
          }
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)'
          },
          to: {
            height: '0'
          }
        }
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out'
      }
    }
  },
  plugins: [
    require("tailwindcss-animate"),
    // Phone layout variants. Each matches a short (landscape phone) viewport,
    // and always inside the native iPhone app (html[data-native="1"], set in
    // src/index.js), so the app never falls back to the desktop layout.
    // Both forms carry one extra element of specificity (`html`), so they
    // beat sm/md/lg screens as `short` always did, while hover/focus still win.
    plugin(({ addVariant }) => {
      // Phone in landscape: short viewport. Desktop windows never match.
      addVariant("short", ["@media (max-height: 520px) { html & }", 'html:where([data-native="1"]) &']);
      // Small landscape phones (iPhone SE / mini width): tighter HUD widths.
      addVariant("narrow", [
        "@media (max-height: 520px) and (max-width: 720px) { html & }",
        '@media (max-width: 720px) { html:where([data-native="1"]) & }',
      ]);
    }),
  ],
};