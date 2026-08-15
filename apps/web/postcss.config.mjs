/** Tailwind v4 ruleaza ca plugin PostCSS. Nu exista `tailwind.config`:
 *  configurarea (token-uri, scara tipografica, culori) traieste in CSS, in
 *  `packages/ui/src/tokens.css`, langa componentele care o folosesc. */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
