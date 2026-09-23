import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import Button from "../components/ui/Button";
import "./NotFound.css";

export default function NotFound() {
  return (
    <div className="nf-wrap">
      <div className="nf-inner">
        <div className="nf-icon-wrap">
          <Compass size={24} color="#546E97" strokeWidth={1.75} />
        </div>
        <div className="nf-code">Error 404</div>
        <h1 className="nf-title">This page isn't in the system</h1>
        <p className="nf-desc">
          The route you're looking for doesn't exist. It may have moved, or the link may be
          out of date.
        </p>
        <Button as={Link} to="/" variant="primary">
          Back to Dashboard
        </Button>
      </div>
    </div>
  );
}
