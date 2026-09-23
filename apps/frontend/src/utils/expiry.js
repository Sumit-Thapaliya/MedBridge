export function urgencyFromDays(daysLeft) {
  if (daysLeft <= 7) return "critical";
  if (daysLeft <= 20) return "warning";
  return "safe";
}

// Maps an urgency level to a Badge `tone`.
export const urgencyTone = {
  critical: "coral",
  warning: "amber",
  safe: "teal",
};

// Maps a medicine/exchange status string to a Badge `tone`.
export function statusTone(status) {
  const map = {
    "In Stock": "teal",
    "Low Stock": "coral",
    "Medium Stock": "amber",
    Critical: "coralStrong",
    Expired: "coralStrong",
    Pending: "amber",
    Approved: "teal",
    "In Transit": "navy",
    Completed: "neutral",
    Declined: "coral",
  };
  return map[status] || "neutral";
}