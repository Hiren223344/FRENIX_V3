import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  Users,
  KeyRound,
  RotateCw,
  Plus,
  Trash2,
  Search,
  CheckCircle,
  Copy,
  LogOut,
  Zap,
  Activity,
  Layers,
  DollarSign,
  UserCheck,
} from 'lucide-react';
import { useToasts } from '../components/ui/toast';
import './AdminDashboard.css';

interface AdminDashboardProps {
  onNavigateHome: () => void;
  onNavigateLogin: () => void;
}

interface AdminStats {
  totalUsers: number;
  proUsers: number;
  freeUsers: number;
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
  providerKeysCount: number;
}

interface AdminUserItem {
  id: string;
  email: string;
  apiKey: string;
  maskedKey: string;
  tier: 'free' | 'pro' | 'enterprise';
  createdAt: string;
  rateLimit?: {
    limit: number;
    remaining: number;
    used: number;
  };
  usage?: {
    totalRequests: number;
    totalCostUsd: number;
    tokens: {
      total: number;
      prompt: number;
      completion: number;
    };
  };
}

interface KeyPoolItem {
  key: string;
  maskedKey: string;
  requestsHandled: number;
  errorsCount: number;
  lastUsed: string | null;
  status: 'active' | 'degraded';
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onNavigateHome,
  onNavigateLogin,
}) => {
  const toasts = useToasts();

  const [stats, setStats] = useState<AdminStats>({
    totalUsers: 0,
    proUsers: 0,
    freeUsers: 0,
    totalRequests: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    providerKeysCount: 0,
  });

  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [keyPool, setKeyPool] = useState<{ totalKeys: number; currentIndex: number; keys: KeyPoolItem[] }>({
    totalKeys: 0,
    currentIndex: 0,
    keys: [],
  });

  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [newKeyInput, setNewKeyInput] = useState('');
  const [addingKey, setAddingKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // New user form state
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserTier, setNewUserTier] = useState<'free' | 'pro' | 'enterprise'>('pro');
  const [showAddUserModal, setShowAddUserModal] = useState(false);

  const getAdminToken = () => sessionStorage.getItem('frenix_admin_token') || '';

  const loadAdminData = useCallback(async () => {
    const token = getAdminToken();
    if (!token) {
      onNavigateLogin();
      return;
    }

    try {
      setLoading(true);
      const headers = {
        'Content-Type': 'application/json',
        'x-admin-token': token,
      };

      // 1. Fetch Stats
      const statsRes = await fetch('/api/admin/stats', { headers });
      if (statsRes.status === 401) {
        onNavigateLogin();
        return;
      }
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        if (statsData.stats) setStats(statsData.stats);
      }

      // 2. Fetch Users
      const usersRes = await fetch('/api/admin/users', { headers });
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        if (usersData.users) setUsers(usersData.users);
      }

      // 3. Fetch Keys
      const keysRes = await fetch('/api/admin/keys', { headers });
      if (keysRes.ok) {
        const keysData = await keysRes.json();
        if (keysData.keyPool) setKeyPool(keysData.keyPool);
      }
    } catch {
      toasts.error('Failed to load admin telemetry.');
    } finally {
      setLoading(false);
    }
  }, [onNavigateLogin, toasts]);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  // Handle Tier Change (One-click)
  const handleChangeTier = async (emailOrKey: string, newTier: 'free' | 'pro' | 'enterprise') => {
    const token = getAdminToken();
    try {
      const res = await fetch('/api/admin/users/tier', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token,
        },
        body: JSON.stringify({ emailOrKey, tier: newTier }),
      });

      const data = await res.json();
      if (res.ok) {
        toasts.success(data.message || `User tier updated to ${newTier.toUpperCase()}`);
        setUsers((prev) =>
          prev.map((u) =>
            u.email === emailOrKey || u.apiKey === emailOrKey ? { ...u, tier: newTier } : u
          )
        );
        // Refresh counts
        loadAdminData();
      } else {
        toasts.error(data.error || 'Failed to update tier');
      }
    } catch {
      toasts.error('Network error updating user tier.');
    }
  };

  // Add Key to Rotation Pool
  const handleAddKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyInput.trim().startsWith('sk-')) {
      toasts.warning("Key must start with 'sk-'.");
      return;
    }

    const token = getAdminToken();
    try {
      setAddingKey(true);
      const res = await fetch('/api/admin/keys/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token,
        },
        body: JSON.stringify({ key: newKeyInput.trim() }),
      });

      const data = await res.json();
      if (res.ok) {
        toasts.success('Provider Key added to active rotation pool!');
        setNewKeyInput('');
        if (data.keyPool) setKeyPool(data.keyPool);
      } else {
        toasts.error(data.error || 'Failed to add key.');
      }
    } catch {
      toasts.error('Network error adding key.');
    } finally {
      setAddingKey(false);
    }
  };

  // Remove Key
  const handleRemoveKey = async (key: string) => {
    const token = getAdminToken();
    try {
      const res = await fetch('/api/admin/keys', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token,
        },
        body: JSON.stringify({ key }),
      });

      const data = await res.json();
      if (res.ok) {
        toasts.success('Key removed from rotation pool.');
        if (data.keyPool) setKeyPool(data.keyPool);
      } else {
        toasts.error(data.error || 'Cannot remove key.');
      }
    } catch {
      toasts.error('Network error removing key.');
    }
  };

  // Create User
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserEmail.includes('@')) {
      toasts.warning('Valid email address required.');
      return;
    }

    const token = getAdminToken();
    try {
      const res = await fetch('/api/admin/users/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token,
        },
        body: JSON.stringify({ email: newUserEmail, tier: newUserTier }),
      });

      const data = await res.json();
      if (res.ok) {
        toasts.success(`User '${newUserEmail}' created with ${newUserTier.toUpperCase()} tier.`);
        setNewUserEmail('');
        setShowAddUserModal(false);
        loadAdminData();
      } else {
        toasts.error(data.error || 'Failed to create user.');
      }
    } catch {
      toasts.error('Network error creating user.');
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    toasts.success('Copied to clipboard');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('frenix_admin_token');
    toasts.message('Admin session ended.');
    onNavigateHome();
  };

  const filteredUsers = users.filter(
    (u) =>
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.apiKey.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.tier.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="adm-page-wrapper">
      <div className="adm-bg-glow" />
      <div className="adm-container">
        {/* Top Navbar */}
        <header className="adm-topbar">
          <div className="adm-brand">
            <div className="adm-brand-icon">
              <Shield size={18} className="text-white" />
            </div>
            <div>
              <div className="adm-brand-title">GATEWAY ADMIN PORTAL</div>
              <div className="adm-brand-sub">Root Controller &amp; Tier Authority</div>
            </div>
          </div>

          <div className="adm-actions">
            <button
              type="button"
              onClick={loadAdminData}
              disabled={loading}
              className="adm-btn adm-btn-secondary"
              title="Refresh telemetry"
            >
              <RotateCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="adm-btn adm-btn-danger"
              title="Exit Admin"
            >
              <LogOut size={14} />
              <span>Logout</span>
            </button>
          </div>
        </header>

        {/* Operational Telemetry Cards */}
        <section className="adm-kpi-grid">
          <div className="adm-kpi-card">
            <div className="adm-kpi-header">
              <span className="adm-kpi-label">Registered Users</span>
              <Users size={16} className="text-white/70" />
            </div>
            <div className="adm-kpi-value">{stats.totalUsers}</div>
            <div className="adm-kpi-sub">
              <span className="text-white font-medium">{stats.proUsers} Pro</span> ·{' '}
              <span>{stats.freeUsers} Free</span>
            </div>
          </div>

          <div className="adm-kpi-card">
            <div className="adm-kpi-header">
              <span className="adm-kpi-label">Total Requests</span>
              <Activity size={16} className="text-white/70" />
            </div>
            <div className="adm-kpi-value">{stats.totalRequests.toLocaleString()}</div>
            <div className="adm-kpi-sub">Live across all API keys</div>
          </div>

          <div className="adm-kpi-card">
            <div className="adm-kpi-header">
              <span className="adm-kpi-label">Total Tokens Processed</span>
              <Layers size={16} className="text-white/70" />
            </div>
            <div className="adm-kpi-value">{stats.totalTokens.toLocaleString()}</div>
            <div className="adm-kpi-sub">{(stats.totalTokens / 1000).toFixed(1)}k tokens aggregate</div>
          </div>

          <div className="adm-kpi-card">
            <div className="adm-kpi-header">
              <span className="adm-kpi-label">Key Rotation Pool</span>
              <KeyRound size={16} className="text-white/70" />
            </div>
            <div className="adm-kpi-value">{keyPool.totalKeys} Keys</div>
            <div className="adm-kpi-sub">Round-Robin Failover Active</div>
          </div>
        </section>

        {/* Main Deck: Users Management & Key Pool */}
        <div className="adm-deck-grid">
          {/* 1. User Management & Tier Upgrade Section */}
          <section className="adm-deck-card adm-users-card">
            <div className="adm-deck-header">
              <div>
                <h2 className="adm-deck-title">User Accounts &amp; Tier Authority</h2>
                <p className="adm-deck-sub">
                  Change user tiers instantly to grant or restrict access to Pro models (e.g. <code>claude-opus-5</code>).
                </p>
              </div>

              <div className="adm-users-toolbar">
                <div className="adm-search-wrap">
                  <Search size={14} className="adm-search-icon" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search email or key..."
                    className="adm-search-input"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setShowAddUserModal(true)}
                  className="adm-btn adm-btn-primary"
                >
                  <Plus size={14} />
                  <span>New User</span>
                </button>
              </div>
            </div>

            {/* Users Table */}
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>User / Email</th>
                    <th>API Key</th>
                    <th>Current Tier</th>
                    <th>Requests</th>
                    <th>Tokens</th>
                    <th style={{ textAlign: 'right' }}>Manage Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="adm-empty-td">
                        No users found matching your search.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => (
                      <tr key={u.apiKey}>
                        <td>
                          <div className="adm-user-email">{u.email}</div>
                          <div className="adm-user-id">{u.id}</div>
                        </td>
                        <td>
                          <div className="adm-key-snippet">
                            <code>{u.maskedKey}</code>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(u.apiKey, u.apiKey)}
                              className="adm-copy-key-btn"
                              title="Copy Full API Key"
                            >
                              {copiedKey === u.apiKey ? <CheckCircle size={12} /> : <Copy size={12} />}
                            </button>
                          </div>
                        </td>
                        <td>
                          <span className={`adm-tier-badge adm-tier-${u.tier}`}>
                            {u.tier.toUpperCase()}
                          </span>
                        </td>
                        <td>{u.usage?.totalRequests || 0}</td>
                        <td>{(u.usage?.tokens?.total || 0).toLocaleString()}</td>
                        <td>
                          <div className="adm-tier-btn-group">
                            <button
                              type="button"
                              onClick={() => handleChangeTier(u.email, 'pro')}
                              className={`adm-tier-btn ${u.tier === 'pro' ? 'active-pro' : ''}`}
                              title="Promote to Pro tier (Access to claude-opus-5)"
                            >
                              Make PRO
                            </button>
                            <button
                              type="button"
                              onClick={() => handleChangeTier(u.email, 'free')}
                              className={`adm-tier-btn ${u.tier === 'free' ? 'active-free' : ''}`}
                              title="Set to Free tier"
                            >
                              Make FREE
                            </button>
                            <button
                              type="button"
                              onClick={() => handleChangeTier(u.email, 'enterprise')}
                              className={`adm-tier-btn ${u.tier === 'enterprise' ? 'active-ent' : ''}`}
                              title="Set to Enterprise tier"
                            >
                              ENTERPRISE
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* 2. Provider Key Rotation Pool Monitor */}
          <section className="adm-deck-card adm-keys-card">
            <div className="adm-deck-header">
              <div>
                <h2 className="adm-deck-title">Upstream Key Rotation Pool</h2>
                <p className="adm-deck-sub">
                  Provider-1 (OpenCode Zen) keys cycled in round-robin with automatic failover on HTTP 429.
                </p>
              </div>
            </div>

            {/* Add Key Form */}
            <form onSubmit={handleAddKey} className="adm-add-key-form">
              <input
                type="text"
                value={newKeyInput}
                onChange={(e) => setNewKeyInput(e.target.value)}
                placeholder="Add new upstream key (sk-...)"
                className="adm-key-input"
              />
              <button
                type="submit"
                disabled={addingKey || !newKeyInput}
                className="adm-btn adm-btn-primary"
              >
                <Plus size={14} />
                <span>{addingKey ? 'Adding...' : 'Add Key'}</span>
              </button>
            </form>

            {/* Active Keys List */}
            <div className="adm-keys-list">
              {keyPool.keys.map((k, idx) => (
                <div key={k.key} className="adm-key-item">
                  <div className="adm-key-left">
                    <span className="adm-key-num">#{idx + 1}</span>
                    <div>
                      <div className="adm-key-masked">{k.maskedKey}</div>
                      <div className="adm-key-meta">
                        Requests: {k.requestsHandled} · Errors: {k.errorsCount}
                      </div>
                    </div>
                  </div>

                  <div className="adm-key-right">
                    <span className={`adm-status-badge adm-status-${k.status}`}>
                      {k.status === 'active' ? 'Active' : 'Degraded'}
                    </span>
                    {keyPool.keys.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveKey(k.key)}
                        className="adm-remove-key-btn"
                        title="Remove from pool"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="adm-modal-backdrop">
          <div className="adm-modal-card">
            <h3 className="adm-modal-title">Register User with Tier</h3>
            <form onSubmit={handleCreateUser} className="adm-modal-form">
              <div className="adm-form-group">
                <label className="adm-label">User Email Address</label>
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="name@company.com"
                  required
                  className="adm-modal-input"
                />
              </div>

              <div className="adm-form-group">
                <label className="adm-label">Assign Subscription Tier</label>
                <select
                  value={newUserTier}
                  onChange={(e) => setNewUserTier(e.target.value as any)}
                  className="adm-modal-select"
                >
                  <option value="free">Free Tier (Standard models)</option>
                  <option value="pro">Pro Tier (Full access to claude-opus-5 &amp; GPT-4o)</option>
                  <option value="enterprise">Enterprise Tier</option>
                </select>
              </div>

              <div className="adm-modal-actions">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="adm-btn adm-btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" className="adm-btn adm-btn-primary">
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
