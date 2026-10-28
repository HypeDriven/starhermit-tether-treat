// The look of the header, the HUD, the rails and the screens: the browser
// build's css/style.css, rewritten class-based in tools/ui-style.css and
// converted once with `starhermit css` into assets/ui-style.json (`npm run
// css`), registered at start with the theme the runtime's own widgets
// (scroll bars, focus rings, selects) take. The runtime's high contrast
// option is the old .tt-high-contrast tokens.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

type Tokens = Record<string, string>;
const BASE: Tokens = {
  bg: "#1a1230", panel: "#241a3a", panel2: "#2f2450", ink: "#f6ecff", dim: "#c9b8e8",
  accent: "#ff7eb6", accent2: "#7ef0d4", star: "#ffd94a", danger: "#ff4d5e", "focus-ring": "#ffd94a",
};
/** .tt-high-contrast. */
const CONTRAST: Tokens = { bg: "#000000", panel: "#0d0d0d", panel2: "#1c1c1c", ink: "#ffffff", dim: "#e5e5e5", accent: "#ff9ac8", accent2: "#9df2dd", "focus-ring": "#ffe45e" };

let current: Tokens = { ...BASE };
let key = "";
export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setFont({ family: "system-ui" });
  ui.setTheme({
    fontSize: 16, smallSize: 13.6, headingSize: 32, padding: 8, spacing: 8, radius: 14,
    text: BASE.ink!, muted: BASE.dim!, panel: BASE.panel!, control: BASE.panel2!, hovered: "#3a2d5e",
    pressed: "#463870", field: BASE.panel2!, accent: BASE.accent!, focus: BASE["focus-ring"]!, outline: BASE.dim!,
  });
  ui.setTokens(css.tokens);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$ink" } },
    paragraph: { text: { color: "$ink" } },
    heading: { text: { color: "$accent" } },
    widget: { focusRing: { color: "$focus-ring", width: 3, offset: 2 } },
    scrollArea: { parts: { bar: { background: "$dim", radius: 4 } } },
    tooltip: { background: "$panel", text: { color: "$ink" }, radius: 6, padding: 6 },
    // .tt-screens: #120c20cc over everything (its 6 px backdrop blur is not drawn: costly, and the panel is opaque)
    dialog: { background: "#00000000", padding: 0, parts: { backdrop: { background: "#120c20cc" } } },
  });
  key = "";
  applyTokens(false);
}

/** The base or high-contrast tokens (cheap when unchanged). */
export function applyTokens(highContrast: boolean): void {
  const k = String(highContrast);
  if (k === key) return;
  key = k;
  current = { ...BASE, ...(highContrast ? CONTRAST : {}) };
  ui.setTokens(current);
  ui.setTheme({
    text: current.ink!, muted: current.dim!, panel: current.panel!, control: current.panel2!, field: current.panel2!,
    accent: current.accent!, focus: current["focus-ring"]!, outline: current.dim!,
  });
}
/** A token's current colour (for draw calls, which take real colours). */
export function token(name: string): string { return current[name] ?? "#000000"; }
