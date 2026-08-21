import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  Users,
  KeyRound,
  RotateCw,
  Plus,
  Search,
  CheckCircle,
  Copy,
  LogOut,
  Zap,
  Activity,
  Layers,
  Settings,
  Cpu,
  Unlink2,
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
  dedicatedKeysCount: number;
}

interface AdminUserItem {
  id: string;
  email: string;
  apiKey: string;
  maskedKey: string;
  tier: 'free' | 'pro' | 'enterprise';
  assignedProviderKey?: string | null;
  maskedAssignedKey?: string | null;
  assignedModel?: string | null;
  customModelRouting?: Record<string, string> | null;
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

const PRESET_MODELS = [
  { id: '', label: 'Default Global Routing (qwen3.5-397B)' },
  { id: 'qwen3.5-397B', label: 'Qwen 3.5 397B' },
  { id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet (Hybrid Reasoning)' },
  { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (v2 Oct 2024)' },
  { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
  { id: 'gpt-4o', label: 'GPT-4o (Omni)' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'deepseek-chat', label: 'DeepSeek V3 (Chat)' },
  { id: 'deepseek-reasoner', label: 'DeepSeek R1 (Reasoner)' },
  { id: 'mimo-v2.5-free', label: 'Mimo v2.5 Free' },
];

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
    dedicatedKeysCount: 0,
  });

  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // New user form state
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserTier, setNewUserTier] = useState<'free' | 'pro' | 'enterprise'>('pro');
  const [newUserModel, setNewUserModel] = useState('');
  const [showAddUserModal, setShowAddUserModal] = useState(false);

  // Edit User Configuration Modal state
  const [editingUser, setEditingUser] = useState<AdminUserItem | null>(null);
  const [editClientApiKey, setEditClientApiKey] = useState('');
  const [editTier, setEditTier] = useState<'free' | 'pro' | 'enterprise'>('pro');
  const [editUpstreamKey, setEditUpstreamKey] = useState('');
  const [editAssignedModel, setEditAssignedModel] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);

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

      // 1. Fetch Users
      try {
        const usersRes = await fetch('/api/admin/users', { headers });
        if (usersRes.status === 401) {
          sessionStorage.removeItem('frenix_admin_token');
          onNavigateLogin();
          return;
        }
        if (usersRes.ok) {
          const usersData = await usersRes.json();
          if (usersData.users) setUsers(usersData.users);
        }
      } catch (err) {
        console.warn('Failed to load users list:', err);
      }

      // 2. Fetch Stats
      try {
        const statsRes = await fetch('/api/admin/stats', { headers });
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          if (statsData.stats) setStats(statsData.stats);
        }
      } catch (err) {
        console.warn('Failed to load stats:', err);
      }

      // 3. Fetch Live Upstream Models
      try {
        const modelsRes = await fetch('/api/admin/models', { headers });
        if (modelsRes.ok) {
          const modelsData = await modelsRes.json();
          if (modelsData.models && Array.isArray(modelsData.models)) {
            setAvailableModels(modelsData.models);
          }
        }
      } catch (err) {
        console.warn('Failed to load models list:', err);
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

  // Open Edit Modal for a User
  const handleOpenEditModal = (u: AdminUserItem) => {
    setEditingUser(u);
    setEditClientApiKey(u.apiKey);
    setEditTier(u.tier);
    setEditUpstreamKey(u.assignedProviderKey || '');
    setEditAssignedModel(u.assignedModel || '');
  };

  // Save Full User Configuration
  const handleSaveUserConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    const token = getAdminToken();
    try {
      setSavingConfig(true);
      const res = await fetch('/api/admin/users/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token,
        },
        body: JSON.stringify({
          emailOrKey: editingUser.email,
          apiKey: editClientApiKey.trim() || undefined,
          tier: editTier,
          assignedProviderKey: editUpstreamKey.trim(),
          assignedModel: editAssignedModel.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toasts.success(data.message || 'User configuration updated successfully.');
        setEditingUser(null);
        loadAdminData();
      } else {
        toasts.error(data.error || 'Failed to update user configuration.');
      }
    } catch {
      toasts.error('Network error updating user.');
    } finally {
      setSavingConfig(false);
    }
  };

  // Quick Tier Toggle
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
        loadAdminData();
      } else {
        toasts.error(data.error || 'Failed to update tier');
      }
    } catch {
      toasts.error('Network error updating user tier.');
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
        body: JSON.stringify({
          email: newUserEmail,
          tier: newUserTier,
          assignedModel: newUserModel.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toasts.success(`User '${newUserEmail}' created with ${newUserTier.toUpperCase()} tier.`);
        setNewUserEmail('');
        setNewUserModel('');
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

  const allSelectModels = [
    ...PRESET_MODELS,
    ...availableModels
      .filter((m) => !PRESET_MODELS.some((p) => p.id === m.id))
      .map((m) => ({ id: m.id, label: `${m.id} (Upstream NewAPI)` })),
  ];

  const filteredUsers = users.filter(
    (u) =>
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.apiKey.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.tier.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.assignedModel && u.assignedModel.toLowerCase().includes(searchQuery.toLowerCase()))
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
              <div className="adm-brand-sub">Provider-1 (newapi.frenix.sh) &amp; Per-User Model Router</div>
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
              <span className="adm-kpi-label">Dedicated Upstream Keys</span>
              <KeyRound size={16} className="text-white/70" />
            </div>
            <div className="adm-kpi-value">{stats.dedicatedKeysCount} Assigned</div>
            <div className="adm-kpi-sub">Isolated limits per Pro account</div>
          </div>

          <div className="adm-kpi-card">
            <div className="adm-kpi-header">
              <span className="adm-kpi-label">Upstream Gateway</span>
              <Cpu size={16} className="text-white/70" />
            </div>
            <div className="adm-kpi-value text-sm font-mono mt-1 text-white/90">newapi.frenix.sh/v1</div>
            <div className="adm-kpi-sub">Provider-1 Active Gateway</div>
          </div>

          <div className="adm-kpi-card">
            <div className="adm-kpi-header">
              <span className="adm-kpi-label">Total Requests</span>
              <Activity size={16} className="text-white/70" />
            </div>
            <div className="adm-kpi-value">{stats.totalRequests.toLocaleString()}</div>
            <div className="adm-kpi-sub">Live across all API keys</div>
          </div>
        </section>

        {/* Main Deck: Full Width Users & Model Routing Table */}
        <div className="adm-deck-single">
          <section className="adm-deck-card adm-users-card">
            <div className="adm-deck-header">
              <div>
                <h2 className="adm-deck-title">User Accounts, Dedicated Keys &amp; Model Routing</h2>
                <p className="adm-deck-sub">
                  Assign custom Claude model routing and dedicated NewAPI upstream keys per user.
                </p>
              </div>

              <div className="adm-users-toolbar">
                <div className="adm-search-wrap">
                  <Search size={14} className="adm-search-icon" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search email, key, model..."
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
                    <th>Client API Key</th>
                    <th>Tier</th>
                    <th>Dedicated Upstream Key</th>
                    <th>Routed Claude Model</th>
                    <th>Requests</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="adm-empty-td">
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
                        <td>
                          {u.assignedProviderKey ? (
                            <div className="adm-assigned-key-wrap">
                              <span className="adm-dedicated-badge" title={u.assignedProviderKey}>
                                <Zap size={11} className="text-yellow-400 mr-1" />
                                {u.maskedAssignedKey || 'Dedicated'}
                              </span>
                            </div>
                          ) : (
                            <span className="adm-pool-badge">Default Server Key</span>
                          )}
                        </td>
                        <td>
                          {u.assignedModel ? (
                            <span className="adm-model-badge">
                              <Cpu size={11} className="mr-1 text-cyan-400" />
                              {u.assignedModel}
                            </span>
                          ) : (
                            <span className="adm-pool-badge">Global (claude-3-7-sonnet)</span>
                          )}
                        </td>
                        <td>{u.usage?.totalRequests || 0}</td>
                        <td>
                          <div className="adm-tier-btn-group">
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(u)}
                              className="adm-tier-btn adm-btn-keybind"
                              title="Edit user client key, dedicated upstream key, tier, and model routing"
                            >
                              <Settings size={12} className="inline mr-1" />
                              Edit Config
                            </button>
                            <button
                              type="button"
                              onClick={() => handleChangeTier(u.email, 'pro')}
                              className={`adm-tier-btn ${u.tier === 'pro' ? 'active-pro' : ''}`}
                              title="Promote to Pro tier"
                            >
                              PRO
                            </button>
                            <button
                              type="button"
                              onClick={() => handleChangeTier(u.email, 'free')}
                              className={`adm-tier-btn ${u.tier === 'free' ? 'active-free' : ''}`}
                              title="Set to Free tier"
                            >
                              FREE
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
        </div>
      </div>

      {/* Modal: Edit Full User Configuration (Key, Tier, Upstream Key, Model Routing) */}
      {editingUser && (
        <div className="adm-modal-backdrop">
          <div className="adm-modal-card">
            <h3 className="adm-modal-title">
              Edit User &amp; Model Routing Configuration
            </h3>
            <p className="adm-modal-sub">
              Target User: <strong className="text-white">{editingUser.email}</strong>
            </p>

            <form onSubmit={handleSaveUserConfig} className="adm-modal-form">
              <div className="adm-form-group">
                <label className="adm-label">Client API Key (Frenix Key for Client Apps)</label>
                <input
                  type="text"
                  value={editClientApiKey}
                  onChange={(e) => setEditClientApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="adm-modal-input font-mono"
                  required
                />
              </div>

              <div className="adm-form-group">
                <label className="adm-label">Subscription Tier</label>
                <select
                  value={editTier}
                  onChange={(e) => setEditTier(e.target.value as any)}
                  className="adm-modal-select"
                >
                  <option value="free">Free Tier</option>
                  <option value="pro">Pro Tier (Full access to Claude models)</option>
                  <option value="enterprise">Enterprise Tier</option>
                </select>
              </div>

              <div className="adm-form-group">
                <label className="adm-label">Dedicated Upstream API Key (NewAPI / Upstream sk-...)</label>
                <input
                  type="text"
                  value={editUpstreamKey}
                  onChange={(e) => setEditUpstreamKey(e.target.value)}
                  placeholder="Leave empty to use server default key"
                  className="adm-modal-input font-mono"
                />
                <span className="text-xs text-white/40 mt-1">
                  Requests from this user will be authenticated using this dedicated key on <code>https://newapi.frenix.sh/v1</code>.
                </span>
              </div>

              <div className="adm-form-group">
                <label className="adm-label">Assigned Target Claude Model for this User</label>
                <select
                  value={editAssignedModel}
                  onChange={(e) => setEditAssignedModel(e.target.value)}
                  className="adm-modal-select"
                >
                  {allSelectModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={editAssignedModel}
                  onChange={(e) => setEditAssignedModel(e.target.value)}
                  placeholder="Or enter custom model ID (e.g. claude-3-7-sonnet-20250219)"
                  className="adm-modal-input font-mono mt-2"
                />
                <span className="text-xs text-white/40 mt-1">
                  When this user requests Claude / Opus models, the request will route directly to this target model.
                </span>
              </div>

              <div className="adm-modal-actions">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="adm-btn adm-btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="adm-btn adm-btn-primary"
                >
                  {savingConfig ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="adm-modal-backdrop">
          <div className="adm-modal-card">
            <h3 className="adm-modal-title">Register User with Tier &amp; Model Routing</h3>
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
                  <option value="pro">Pro Tier (Full access to claude-opus-5 &amp; Claude 3.7)</option>
                  <option value="enterprise">Enterprise Tier</option>
                </select>
              </div>

              <div className="adm-form-group">
                <label className="adm-label">Assigned Target Model (Optional)</label>
                <select
                  value={newUserModel}
                  onChange={(e) => setNewUserModel(e.target.value)}
                  className="adm-modal-select"
                >
                  {allSelectModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
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
