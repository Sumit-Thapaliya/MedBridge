import clsx from "clsx";
import "./Badge.css";

export default function Badge({ children, tone = "neutral", className, hideOnMobile, dot = false }) {
  return (
    <span
      className={clsx(
        "badge",
        `badge-${tone}`,
        hideOnMobile && "badge-hide-mobile",
        className
      )}
    >
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}
