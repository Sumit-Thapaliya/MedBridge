import clsx from "clsx";
import "./Skeleton.css";

export default function Skeleton({ className, ...props }) {
  return <div className={clsx("skeleton", className)} {...props} />;
}
