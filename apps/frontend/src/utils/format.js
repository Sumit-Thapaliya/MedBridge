export function formatCurrency(value) {
  return new Intl.NumberFormat("en-NP", {
    style: "currency",
    currency: "NPR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatDate(dateStr, options = { day: "2-digit", month: "short", year: "numeric" }) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", options);
}

// Nepali number system: full digits with Nepali comma placement
// (right-most 3 digits, then groups of 2): 1000000 -> 10,00,000,
// 12345678 -> 1,23,45,678. No "Thousand / Lakh / Crore" words.
export function formatNepaliCurrency(value) {
  const v = Number(value) || 0;
  return `NPR ${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
