import clsx from "clsx";
import "./Button.css";

export default function Button({
  children,
  variant = "primary",
  size = "md",
  className,
  as: Tag = "button",
  ...props
}) {
  return (
    <Tag
      className={clsx("btn", `btn-${variant}`, `btn-${size}`, className)}
      {...props}
    >
      {children}
    </Tag>
  );
}
