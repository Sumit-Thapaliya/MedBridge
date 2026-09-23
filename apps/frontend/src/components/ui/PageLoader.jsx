// Lightweight full-screen loader used as the Suspense fallback while lazy
// page chunks are fetched. Kept dependency-free so it can never fail to load.
export default function PageLoader() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--canvas, #f5f7fa)",
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          border: "3px solid var(--line, #e5e7eb)",
          borderTopColor: "#0E8C82",
          borderRadius: "50%",
          animation: "medbridge-spin 0.8s linear infinite",
        }}
      />
      <style>{`@keyframes medbridge-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
