import { Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { AppProvider } from "./context/AppContext";
import { ProtectedRoute, GuestRoute } from "./components/auth/ProtectedRoute";
import AppLayout from "./layouts/AppLayout";
import Login from "./pages/auth/Login";
import RegisterHospital from "./pages/auth/RegisterHospital";
import JoinHospital from "./pages/auth/JoinHospital";
import { routes } from "./routes";
import NotFound from "./pages/NotFound";
import { ThemeProvider } from "./context/ThemeContext";
import { AIChatProvider } from "./context/AIChatContext";
import ErrorBoundary from "./components/ErrorBoundary";
import PageLoader from "./components/ui/PageLoader";

export default function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <AuthProvider>
          <AIChatProvider>
            <BrowserRouter>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route element={<GuestRoute />}>
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<RegisterHospital />} />
                    <Route path="/join" element={<JoinHospital />} />
                  </Route>

                  <Route element={<ProtectedRoute />}>
                    <Route
                      element={
                        <AppProvider>
                          <AppLayout />
                        </AppProvider>
                      }
                    >
                      {routes.map(({ path, element: Element }) => (
                        <Route key={path} path={path} element={<Element />} />
                      ))}
                    </Route>
                  </Route>

                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </AIChatProvider>
        </AuthProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
