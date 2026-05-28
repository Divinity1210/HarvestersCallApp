import Navbar from '@/components/Navbar';
import ProtectedRoute from '@/components/ProtectedRoute';

export const metadata = {
  title: 'Admin Dashboard — Harvesters Call App',
  description: 'QA command center for monitoring agent performance and call quality.',
};

export default function AdminLayout({ children }) {
  return (
    <ProtectedRoute requiredRole="admin">
      <Navbar />
      <main style={{ minHeight: 'calc(100vh - var(--navbar-height))' }}>
        {children}
      </main>
    </ProtectedRoute>
  );
}
