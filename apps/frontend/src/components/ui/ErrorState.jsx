import { AlertTriangle } from "lucide-react";
import Button from "./Button";
import "./ErrorState.css";

export default function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
}) {
  return (
    <div className="error-state">
      <div className="error-state-icon-wrap">
        <AlertTriangle className="error-state-icon" size={20} strokeWidth={1.75} />
      </div>
      <h3 className="error-state-title">{title}</h3>
      {description && <p className="error-state-description">{description}</p>}
      {onRetry && (
        <div className="error-state-action">
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
