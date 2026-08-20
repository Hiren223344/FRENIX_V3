import React, { useState } from 'react';
import {
  useSignIn,
  useUser,
  SignedIn,
  SignedOut,
  UserButton,
  SignIn as ClerkSignInComponent,
} from '@clerk/clerk-react';
import { JellyBlobMascot, BlobSpeech, type JellyBlobMood } from 'feral-blob';
import 'feral-blob/blob.css';
import { toastStore } from '../components/toastStore';
import './SignIn.css';

interface SignInProps {
  onNavigateHome: () => void;
  onNavigateDashboard?: () => void;
}

export const SignIn: React.FC<SignInProps> = ({ onNavigateHome, onNavigateDashboard }) => {
  const { isLoaded, signIn, setActive } = useSignIn();
  const { user } = useUser();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [useClerkEmbed, setUseClerkEmbed] = useState(false);

  // Mascot dynamic state
  const [mood, setMood] = useState<JellyBlobMood>('neutral');
  const [gaze, setGaze] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [speechMsg, setSpeechMsg] = useState<string | null>(null);

  const handleEmailFocus = () => {
    setMood('hmm');
    setGaze({ x: -14, y: 10 });
    setSpeechMsg("Enter your registered Clerk email...");
  };

  const handleEmailBlur = () => {
    if (!password) {
      setMood('neutral');
      setGaze({ x: 0, y: 0 });
      setSpeechMsg(null);
    }
  };

  const handlePasswordFocus = () => {
    setMood('password');
    setGaze({ x: 18, y: -8 });
    setSpeechMsg("Privacy mode active. Looking away for your security.");
  };

  const handlePasswordBlur = () => {
    setMood('neutral');
    setGaze({ x: 0, y: 0 });
    setSpeechMsg(null);
  };

  const handleRememberToggle = () => {
    setRememberMe(!rememberMe);
    setMood('sideEye');
    setGaze({ x: -12, y: 15 });
    setTimeout(() => setMood('neutral'), 1500);
  };

  const handleOverpoke = () => {
    setMood('angry');
    setSpeechMsg("Tactile threshold exceeded.");
    toastStore.warning(
      'Mascot Overpoked',
      'Direct interaction past patience limit.'
    );

    setTimeout(() => {
      setMood('neutral');
      setSpeechMsg(null);
    }, 4500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      setMood('sad');
      setSpeechMsg('Please fill in all fields.');
      toastStore.error('Validation Error', 'Email and password are required.');
      return;
    }

    if (!isLoaded) {
      toastStore.warning('Clerk Initializing', 'Please wait a moment while auth initializes.');
      return;
    }

    setLoading(true);
    setMood('hmm');
    setGaze({ x: 0, y: 18 });

    try {
      // Attempt Clerk Authentication
      const result = await signIn.create({
        identifier: email,
        password: password,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        setMood('happy');
        setSpeechMsg('Authentication verified. Welcome to Intelligence.');
        toastStore.success('Signed In Successfully', `Welcome back, ${email}`);
        setTimeout(() => {
          onNavigateHome();
        }, 1800);
      } else {
        setMood('hmm');
        setSpeechMsg('Additional verification step required.');
        toastStore.info('Verification Required', 'Check your email for 2FA code.');
      }
    } catch (err: any) {
      setMood('sad');
      const errorMessage = err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || err.message || 'Check your credentials.';
      setSpeechMsg(errorMessage);
      toastStore.error('Sign In Failed', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthSignIn = async (strategy: 'oauth_google' | 'oauth_microsoft' | 'oauth_github') => {
    if (!isLoaded) return;
    setMood('happy');
    toastStore.info('SSO Redirect', `Connecting to ${strategy.replace('oauth_', '')} via Clerk...`);
    try {
      await signIn.authenticateWithRedirect({
        strategy,
        redirectUrl: '/sso-callback',
        redirectUrlComplete: '/',
      });
    } catch (err: any) {
      toastStore.error('OAuth Error', err?.message || 'Failed to initiate social login.');
    }
  };

  return (
    <div className="signin-page">
      {/* Top Bar */}
      <header className="signin-header">
        <button
          onClick={onNavigateHome}
          className="back-btn"
          aria-label="Back to landing page"
        >
          <span className="back-arrow">←</span>
          <span>Back to Home</span>
        </button>

        <div className="flex items-center gap-3">
          <SignedIn>
            <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-full border border-white/15">
              <span className="text-xs text-gray-200">Hi, {user?.firstName || user?.primaryEmailAddress?.emailAddress}</span>
              <UserButton afterSignOutUrl="/" />
            </div>
          </SignedIn>

          <a href="#" onClick={(e) => { e.preventDefault(); onNavigateHome(); }} className="logo-btn" aria-label="Home">
            <img src="/assets/logo.webp" alt="" width="52" height="52" />
          </a>
        </div>
      </header>

      {/* Center Auth Card */}
      <main className="signin-container">
        <SignedIn>
          <div className="signin-card text-center">
            <div className="mascot-section">
              <div className="mascot-avatar-wrapper">
                <JellyBlobMascot
                  mood="happy"
                  happyEyes="star"
                  className="signin-mascot"
                />
              </div>
              <div className="custom-speech-bubble">Authentication verified with Clerk.</div>
            </div>

            <div className="signin-header-copy mt-2">
              <h1 className="signin-title">Authenticated</h1>
              <p className="signin-subtitle">
                Logged in as <strong>{user?.primaryEmailAddress?.emailAddress}</strong>
              </p>
            </div>

            <div className="flex flex-col gap-3 mt-4">
              <button
                type="button"
                className="submit-btn"
                onClick={onNavigateDashboard || onNavigateHome}
              >
                Open Live Dashboard (/dashboard) →
              </button>
              <button
                type="button"
                className="dash-btn-secondary"
                onClick={onNavigateHome}
              >
                Return to Landing Page
              </button>
            </div>
          </div>
        </SignedIn>

        <SignedOut>
          <div className="signin-card">
            {/* Feral Blob Mascot Avatar */}
            <div className="mascot-section">
              <div className="mascot-avatar-wrapper">
                <JellyBlobMascot
                  mood={mood}
                  gaze={gaze}
                  onOverpoke={handleOverpoke}
                  happyEyes="star"
                  className="signin-mascot"
                />
              </div>
              {speechMsg ? (
                <div className="custom-speech-bubble">{speechMsg}</div>
              ) : (
                <BlobSpeech mood={mood} className="mascot-speech" />
              )}
            </div>

            <div className="signin-header-copy">
              <h1 className="signin-title">Sign In</h1>
              <p className="signin-subtitle">
                Enter your credentials to access your intelligence workspace.
              </p>
            </div>

            {useClerkEmbed ? (
              <div className="clerk-embed-wrapper">
                <ClerkSignInComponent routing="hash" />
                <button
                  type="button"
                  className="switch-form-btn mt-3"
                  onClick={() => setUseClerkEmbed(false)}
                >
                  ← Switch to Interactive Mascot Form
                </button>
              </div>
            ) : (
              <>
                {/* Social SSO Options via Clerk */}
                <div className="social-buttons-row">
                  <button
                    type="button"
                    className="social-btn"
                    onClick={() => handleOAuthSignIn('oauth_microsoft')}
                  >
                    <i className="fa-brands fa-microsoft"></i>
                    <span>Microsoft</span>
                  </button>
                  <button
                    type="button"
                    className="social-btn"
                    onClick={() => handleOAuthSignIn('oauth_google')}
                  >
                    <i className="fa-brands fa-google"></i>
                    <span>Google</span>
                  </button>
                  <button
                    type="button"
                    className="social-btn"
                    onClick={() => handleOAuthSignIn('oauth_github')}
                  >
                    <i className="fa-brands fa-github"></i>
                    <span>GitHub</span>
                  </button>
                </div>

                <div className="auth-divider">
                  <span>or continue with email</span>
                </div>

                {/* Form */}
                <form className="signin-form" onSubmit={handleSubmit}>
                  <div className="form-field">
                    <label htmlFor="email">Enterprise Email</label>
                    <input
                      id="email"
                      type="email"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onFocus={handleEmailFocus}
                      onBlur={handleEmailBlur}
                      required
                      autoComplete="email"
                    />
                  </div>

                  <div className="form-field">
                    <div className="field-header">
                      <label htmlFor="password">Password</label>
                      <a
                        href="#forgot"
                        onClick={(e) => {
                          e.preventDefault();
                          toastStore.info('Password Reset', 'Password recovery instructions sent.');
                        }}
                        className="forgot-link"
                      >
                        Forgot password?
                      </a>
                    </div>
                    <div className="password-input-wrap">
                      <input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onFocus={handlePasswordFocus}
                        onBlur={handlePasswordBlur}
                        required
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        className="toggle-password"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label="Toggle password visibility"
                      >
                        {showPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>

                  <div className="form-options">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={handleRememberToggle}
                      />
                      <span>Remember this device for 30 days</span>
                    </label>
                  </div>

                  <button type="submit" className="submit-btn" disabled={loading}>
                    {loading ? 'Authenticating with Clerk...' : 'Sign In to Workspace'}
                  </button>
                </form>

                <footer className="signin-footer-text">
                  <span>Don't have an account?</span>{' '}
                  <button
                    type="button"
                    onClick={() => setUseClerkEmbed(true)}
                    className="signup-link bg-transparent border-0 cursor-pointer p-0"
                  >
                    Open Clerk Sign Up
                  </button>
                </footer>
              </>
            )}

            {/* Quick interactive test strip for stacked 3D toasts */}
            <div className="toast-test-strip">
              <span className="text-xs text-gray-400">Test Stacked Toasts:</span>
              <div className="flex gap-2 flex-wrap justify-center mt-1">
                <button
                  type="button"
                  className="test-toast-pill"
                  onClick={() => toastStore.success("Your changes have been saved successfully.")}
                >
                  + Success
                </button>
                <button
                  type="button"
                  className="test-toast-pill"
                  onClick={() => toastStore.warning("High compute load detected.")}
                >
                  + Warning
                </button>
                <button
                  type="button"
                  className="test-toast-pill"
                  onClick={() =>
                    toastStore.message({
                      text: "Workspace item archived.",
                      onUndoAction: () => toastStore.success("Item restored to workspace."),
                    })
                  }
                >
                  + Undo
                </button>
              </div>
            </div>
          </div>
        </SignedOut>
      </main>
    </div>
  );
};
