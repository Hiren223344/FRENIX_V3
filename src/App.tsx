import React, { useState, useEffect } from 'react';
import { LandingPage } from './pages/LandingPage';
import { SignIn } from './pages/SignIn';
import { Dashboard } from './pages/Dashboard';
import { Toaster } from './components/Toaster';

export const App: React.FC = () => {
  const [currentPath, setCurrentPath] = useState<string>(() => {
    const p = window.location.pathname;
    if (p === '/signin' || p === '/dashboard') return p;
    return '/';
  });

  useEffect(() => {
    const handlePopState = () => {
      const p = window.location.pathname;
      if (p === '/signin' || p === '/dashboard') {
        setCurrentPath(p);
      } else {
        setCurrentPath('/');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      {currentPath === '/signin' && (
        <SignIn
          onNavigateHome={() => navigateTo('/')}
          onNavigateDashboard={() => navigateTo('/dashboard')}
        />
      )}

      {currentPath === '/dashboard' && (
        <Dashboard
          onNavigateHome={() => navigateTo('/')}
          onNavigateSignIn={() => navigateTo('/signin')}
        />
      )}

      {currentPath === '/' && (
        <LandingPage
          onNavigateSignIn={() => navigateTo('/signin')}
          onNavigateDashboard={() => navigateTo('/dashboard')}
        />
      )}

      <Toaster />
    </>
  );
};

export default App;
