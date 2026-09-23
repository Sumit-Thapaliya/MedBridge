import clsx from "clsx";
import "./Card.css";

export default function Card({ children, className, as: Tag = "div", ...props }) {
  return (
    <Tag className={clsx("card", className)} {...props}>
      {children}
    </Tag>
  );
}
