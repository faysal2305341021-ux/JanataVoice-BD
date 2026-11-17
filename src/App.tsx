import { AuthPortal } from './components/AuthPortal.tsx';
import { Stage1Workspace } from './components/Stage1Workspace.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';

function AppShell() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f4f9f6] flex items-center justify-center">
        <div className="text-sm font-medium text-[#006a4e]">Loading JanataVoice BD portal...</div>
      </div>
    );
  }

  return user ? <Stage1Workspace /> : <AuthPortal />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
