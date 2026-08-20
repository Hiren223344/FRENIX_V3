import React, { useEffect, useState, useRef } from 'react';
import { SignedIn, SignedOut, UserButton } from '@clerk/clerk-react';
import { toastStore } from '../components/toastStore';

interface LandingPageProps {
  onNavigateSignIn: () => void;
  onNavigateDashboard?: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onNavigateSignIn, onNavigateDashboard }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeNav, setActiveNav] = useState('Home');
  const statsRef = useRef<HTMLElement>(null);
  const hasAnimatedStats = useRef(false);

  // Count-up stats state
  const [stats, setStats] = useState([
    { icon: '<', target: 120, suffix: 'ms', decimals: 0, label: 'Inference Time', current: 0 },
    { icon: '%', target: 99.99, suffix: '%', decimals: 2, label: 'Platform Uptime', current: 0 },
    { icon: '*', target: 24, suffix: '/7', decimals: 0, label: 'Autonomous Runtime', current: 0 },
    { icon: '#', target: 2.4, suffix: 'M', decimals: 1, label: 'Context Windows', current: 0 },
  ]);

  useEffect(() => {
    // Check if user prefers reduced motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      setStats((prev) => prev.map((s) => ({ ...s, current: s.target })));
      return;
    }

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const runCountUp = () => {
      if (hasAnimatedStats.current) return;
      hasAnimatedStats.current = true;

      stats.forEach((item, index) => {
        const duration = 1500 + index * 80;
        const startDelay = 480 + index * 90;

        setTimeout(() => {
          let startTime: number | null = null;

          const step = (timestamp: number) => {
            if (!startTime) startTime = timestamp;
            const elapsed = timestamp - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const currentVal = easeOutCubic(progress) * item.target;

            setStats((prev) =>
              prev.map((s, idx) => (idx === index ? { ...s, current: currentVal } : s))
            );

            if (progress < 1) {
              requestAnimationFrame(step);
            } else {
              setStats((prev) =>
                prev.map((s, idx) => (idx === index ? { ...s, current: item.target } : s))
              );
            }
          };

          requestAnimationFrame(step);
        }, startDelay);
      });
    };

    if ('IntersectionObserver' in window && statsRef.current) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              runCountUp();
              observer.disconnect();
            }
          });
        },
        { threshold: 0.25 }
      );
      observer.observe(statsRef.current);
      return () => observer.disconnect();
    } else {
      runCountUp();
    }
  }, []);

  // Keyboard Escape listener for mobile menu
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menuOpen) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen]);

  // Window resize listener
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 720 && menuOpen) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [menuOpen]);

  const handleNavClick = (name: string) => {
    setActiveNav(name);
    setMenuOpen(false);
    toastStore.info(name, `Navigating to ${name} section`);
  };

  const handleGetStarted = (e: React.MouseEvent) => {
    e.preventDefault();
    toastStore.success('Get Started', 'Launching workspace setup...');
    setTimeout(() => {
      onNavigateSignIn();
    }, 600);
  };

  return (
    <>
      {/* Background Video */}
      <div className="bg">
        <video className="bg-video" autoPlay muted loop playsInline>
          <source
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260809_012548_ef22562c-c0ae-4816-ad9d-f8922af4e6a7.mp4"
            type="video/mp4"
          />
        </video>
      </div>

      <div className={`page ${menuOpen ? 'menu-open' : ''}`}>
        {/* 1. Header (Desktop & Mobile) */}
        <header className="header">
          <a href="#" className="logo-btn" aria-label="Home" onClick={(e) => { e.preventDefault(); handleNavClick('Home'); }}>
            <img src="/assets/logo.webp" alt="" width="52" height="52" />
          </a>

          {/* Desktop Nav Pill */}
          <nav className="nav-pill" aria-label="Main Navigation">
            {['Home', 'Product', 'Case Studies', 'Contact'].map((item) => (
              <a
                key={item}
                href={`#${item.toLowerCase().replace(/\s+/g, '-')}`}
                className={`nav-link ${activeNav === item ? 'active' : ''}`}
                onClick={(e) => {
                  e.preventDefault();
                  handleNavClick(item);
                }}
              >
                {item}
              </a>
            ))}
          </nav>

          {/* Desktop Sign In / Dashboard */}
          <SignedOut>
            <a
              href="/signin"
              className="btn-signin"
              onClick={(e) => {
                e.preventDefault();
                onNavigateSignIn();
              }}
            >
              Sign In
            </a>
          </SignedOut>

          <SignedIn>
            <div className="flex items-center gap-2">
              <a
                href="/dashboard"
                className="btn-signin"
                onClick={(e) => {
                  e.preventDefault();
                  if (onNavigateDashboard) {
                    onNavigateDashboard();
                  } else {
                    window.history.pushState({}, '', '/dashboard');
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }
                }}
              >
                Dashboard
              </a>
              <UserButton afterSignOutUrl="/" />
            </div>
          </SignedIn>

          {/* Mobile Burger Toggle */}
          <button
            className="burger-btn"
            aria-label="Toggle navigation menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span className="burger-bar"></span>
            <span className="burger-bar"></span>
            <span className="burger-bar"></span>
          </button>
        </header>

        {/* Mobile Sheet Menu & Overlay */}
        {menuOpen && (
          <>
            <div className="mobile-overlay" onClick={() => setMenuOpen(false)}></div>
            <div className="mobile-sheet" aria-label="Mobile Navigation">
              <nav className="mobile-nav">
                {['Home', 'Product', 'Case Studies', 'Contact'].map((item) => (
                  <a
                    key={item}
                    href={`#${item.toLowerCase().replace(/\s+/g, '-')}`}
                    className={`mobile-nav-link ${activeNav === item ? 'active' : ''}`}
                    onClick={(e) => {
                      e.preventDefault();
                      handleNavClick(item);
                    }}
                  >
                    {item}
                  </a>
                ))}
                <a
                  href="/signin"
                  className="mobile-signin"
                  onClick={(e) => {
                    e.preventDefault();
                    setMenuOpen(false);
                    onNavigateSignIn();
                  }}
                >
                  Sign In
                </a>
              </nav>
            </div>
          </>
        )}

        {/* 2. Hero Region (Center) */}
        <main className="hero">
          {/* Trust Row */}
          <div className="trust-row anim" style={{ '--d': '0.05s' } as React.CSSProperties}>
            <div className="avatar-ring a1" style={{ '--z': 1, '--lift': '-2px' } as React.CSSProperties}>
              <div className="avatar-inner">
                <i className="fa-brands fa-microsoft" aria-hidden="true"></i>
              </div>
            </div>
            <div className="avatar-ring a2" style={{ '--z': 2, '--lift': '-4px' } as React.CSSProperties}>
              <div className="avatar-inner">
                <i className="fa-brands fa-amazon" aria-hidden="true"></i>
              </div>
            </div>
            <div className="avatar-ring a3" style={{ '--z': 4, '--lift': '-2px' } as React.CSSProperties}>
              <div className="avatar-inner">
                <i className="fa-brands fa-google" aria-hidden="true"></i>
              </div>
            </div>
            <div className="trust-pill">
              <span>Trusted by 2000+ Enterprises</span>
            </div>
          </div>

          {/* Headline */}
          <h1 className="headline anim">
            <span className="headline-line" style={{ '--d': '0.12s' } as React.CSSProperties}>
              Intelligence
            </span>
            <span className="headline-line" style={{ '--d': '0.3s' } as React.CSSProperties}>
              Designed To Evolve
            </span>
          </h1>

          {/* Subhead */}
          <p className="subhead anim" style={{ '--d': '0.28s' } as React.CSSProperties}>
            Build applications that reason, adapt and collaborate using a modular
            AI platform designed for production.
          </p>

          {/* CTA Button */}
          <div className="cta-wrapper anim-pulse" style={{ '--d': '0.4s' } as React.CSSProperties}>
            <a href="/signin" className="cta-btn" onClick={handleGetStarted}>
              Get Started
            </a>
          </div>
        </main>

        {/* 3. Stats Footer (Bottom) */}
        <footer className="stats-footer" ref={statsRef}>
          <div className="stats-grid">
            {stats.map((stat, i) => {
              const delays = ['0.5s', '0.58s', '0.66s', '0.74s'];
              const displayVal =
                stat.decimals > 0
                  ? stat.current.toFixed(stat.decimals)
                  : Math.round(stat.current).toString();

              return (
                <div
                  key={stat.label}
                  className="stat-card anim"
                  style={{ '--d': delays[i] } as React.CSSProperties}
                >
                  <div className="stat-icon" aria-hidden="true">
                    {stat.icon}
                  </div>
                  <div className="stat-value">
                    <span className="count">{displayVal}</span>
                    <span className="stat-suffix">{stat.suffix}</span>
                  </div>
                  <div className="stat-label">{stat.label}</div>
                </div>
              );
            })}
          </div>
        </footer>
      </div>
    </>
  );
};
