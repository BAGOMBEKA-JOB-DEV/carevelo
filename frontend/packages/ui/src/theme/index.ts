/**
 * The theme layer.
 *
 * Two halves that must agree and are deliberately kept in sight of each other: this
 * component, and apps/patient-portal/public/theme-init.js. Both write the same
 * localStorage key and the same `data-theme` attribute on the root element; the init
 * script applies it before the first paint, the toggle changes it afterwards.
 *
 * There is no ThemeProvider and no context, because there is no state to provide. The
 * theme lives on the root element where CSS can already see it, and CSS does the whole
 * job from there — see packages/ui/src/tokens/colors.css. A provider would add a client
 * boundary around the tree, and a second copy of the truth, to hold a value the platform
 * is already holding.
 */
export { ThemeToggle } from './ThemeToggle'
