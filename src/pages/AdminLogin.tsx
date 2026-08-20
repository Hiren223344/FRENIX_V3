import React, { useState } from 'react';
import { Shield, KeyRound, ArrowRight, Lock } from 'lucide-react';
import { useToasts } from '../components/ui/toast';
import './AdminLogin.css';

interface AdminLoginProps {
  onNavigateDashboard: () => void;
  onNavigateHome: () => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({
  onNavigateDashboard,
  onNavigateHome,
}) => {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const toasts = useToasts();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      toasts.warning('Please enter the administrator password.');
      return;
    }

    try {
      setLoading(true);
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();
      if (res.ok && data.token) {
        sessionStorage.setItem('frenix_admin_token', data.token);
        toasts.success('Admin Authentication Successful');
        onNavigateDashboard();
      } else {
        toasts.error(data.message || 'Invalid administrator password.');
      }
    } catch {
      toasts.error('Server connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-wrapper">
      <div className="admin-login-card">
        <div className="admin-login-header">
          <div className="admin-login-badge">
            <Shield size={20} className="text-white" />
          </div>
          <h1 className="admin-login-title">Control Gateway</h1>
          <p className="admin-login-subtitle">
            Restricted administrative portal for tier management and key rotation.
          </p>
        </div>

        <form onSubmit={handleLogin} className="admin-login-form">
          <div className="admin-input-group">
            <label htmlFor="admin-pass" className="admin-input-label">
              <Lock size={13} />
              <span>Master Admin Password</span>
            </label>
            <div className="admin-input-wrap">
              <input
                id="admin-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password..."
                className="admin-password-input"
                autoFocus
              />
              <KeyRound size={16} className="admin-input-icon" />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="admin-submit-btn"
          >
            <span>{loading ? 'Verifying...' : 'Access Admin Dashboard'}</span>
            <ArrowRight size={16} />
          </button>
        </form>

        <div className="admin-login-footer">
          <button
            type="button"
            onClick={onNavigateHome}
            className="admin-back-link"
          >
            ← Return to Main Gateway
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
