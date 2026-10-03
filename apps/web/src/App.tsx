import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Spinner } from '@heroui/react';
import { AppShell } from './components/AppShell';
import { useMe } from './lib/hooks';
import { AuthPage } from './pages/AuthPage';
import { ProjectPage } from './pages/ProjectPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const me = useMe();
  const loc = useLocation();
  if (me.isLoading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner size="lg" />
      </div>
    );
  }
  const user = me.data?.user ?? null;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: loc.pathname }} />} />
      </Routes>
    );
  }
  return (
    <AppShell user={user}>
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectPage />} />
        <Route path="/settings" element={<Navigate to="/settings/models" replace />} />
        <Route path="/settings/:tab" element={<SettingsPage />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/signup" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
