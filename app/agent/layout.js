import Navbar from '@/components/Navbar';
import ProtectedRoute from '@/components/ProtectedRoute';

export const metadata = {
  title: 'Agent Workspace — Harvesters Call App',
  description: 'Call center agent workspace for making follow-up calls.',
};

export default function AgentLayout({ children }) {
  return (
    <ProtectedRoute requiredRole="agent">
      <Navbar />
      <main style={{ minHeight: 'calc(100vh - var(--navbar-height))' }}>
        {children}
      </main>
    </ProtectedRoute>
  );
}
