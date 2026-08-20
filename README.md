# Intelligence Designed To Evolve — Full-Stack Vite + TypeScript

A high-performance, single-viewport video landing page with a unified Vite + Express TypeScript architecture.

## 📁 Architecture

```
├── package.json               # Fullstack dependencies & concurrent scripts
├── tsconfig.json              # Frontend TypeScript config
├── tsconfig.node.json         # Vite config TypeScript setup
├── tsconfig.server.json       # Backend Express TypeScript config
├── vite.config.ts             # Vite dev server + proxy to Express (:5000)
├── index.html                 # Single-viewport landing page entry
├── src/                       # Frontend Source
│   ├── main.ts                # TypeScript interactions (stats count-up, mobile menu)
│   └── styles.css             # Full design system & responsive styling
├── server/                    # Backend Source
│   ├── index.ts               # Express server entry point
│   ├── routes/
│   │   └── api.ts             # API endpoints (/api/health, /api/stats, /api/contact)
│   └── middleware/
│       └── errorHandler.ts    # Centralized error handler
├── public/                    # Static Assets
│   ├── assets/
│   │   └── logo.webp          # Circular logo mark
│   └── fonts/
│       └── GeistPixel-Circle.woff2 # Fallback dot-matrix display font
└── assets/ & fonts/           # Root static assets
```

## 🚀 Quick Start

### 1. Install Dependencies
```bash
pnpm install
# or
npm install
```

### 2. Run Concurrent Development Server
Starts both the **Vite Client** (`http://localhost:3000`) and the **Express TypeScript Server** (`http://localhost:5000`) with live reloading:
```bash
pnpm dev
# or
npm run dev
```

### 3. Build for Production
Compiles the frontend to `dist/` and backend to `dist-server/`:
```bash
pnpm build
# or
npm run build
```

### 4. Start Production Server
Serves the compiled production app directly through Express:
```bash
pnpm start
# or
npm start
```
