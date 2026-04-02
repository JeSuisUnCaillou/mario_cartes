export const RANK_ICONS = ["/1st.svg", "/2nd.svg", "/3rd.svg"];

export function ordinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function rankBadge(n, iconClass) {
  const src = RANK_ICONS[n - 1];
  const icon = src ? `<img src="${src}" class="${iconClass}" />` : "";
  return icon + ordinalSuffix(n);
}
