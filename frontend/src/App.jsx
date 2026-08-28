import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth.jsx';
import { AppRoutes } from './router/index.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
