import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { clerkMiddleware } from '@clerk/express';
import { createServer as createViteServer } from 'vite';
import apiRouter from './routes/api.js';
import v1Router from './routes/v1.js';
import adminRouter from './routes/admin.js';
import { errorHandler } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function bootstrapServer() {
  const app = express();
  const PORT = process.env.PORT || 5000;

  // Core Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Clerk Middleware for Express
  app.use(clerkMiddleware());

  // Backend API Routes (Always mounted first)
  app.use('/api/admin', adminRouter);
  app.use('/v1/admin', adminRouter);
  app.use('/v1', v1Router);
  app.use('/api/v1', v1Router);
  app.use('/api', apiRouter);

  // Unified Frontend & Backend on the EXACT SAME PORT & DOMAIN
  if (process.env.NODE_ENV === 'production') {
    // Production: Serve optimized build assets
    const distPath = path.resolve(__dirname, '../dist');
    app.use(express.static(distPath));

    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    // Development: Vite Middleware Mode with HMR on the same port
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
        root: path.resolve(__dirname, '..'),
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.warn('⚠️ [Vite Middleware] Could not attach dev middleware, falling back to static files:', err);
      const distPath = path.resolve(__dirname, '../dist');
      app.use(express.static(distPath));
    }
  }

  // Global Error Handler
  app.use(errorHandler);

  app.listen(PORT, () => {
    console.log(`\n🚀 [Unified Fullstack Server] Running on http://localhost:${PORT}`);
    console.log(`🌐 [Frontend UI]        http://localhost:${PORT}/`);
    console.log(`📡 [API Health]        http://localhost:${PORT}/api/health`);
    console.log(`⚡ [API v1 Status]     http://localhost:${PORT}/v1/ok`);
    console.log(`👤 [User Profile / Me] GET  http://localhost:${PORT}/v1/user/me`);
    console.log(`💎 [Model Pricing]     GET  http://localhost:${PORT}/v1/pricing`);
    console.log(`🎭 [AI Identity]       GET  http://localhost:${PORT}/v1/identity`);
    console.log(`🌐 [AI Provider-1]     OpenCode Zen (https://opencode.ai/zen/v1)`);
    console.log(`🔀 [Model Routing]     claude-opus-5 ➔ mimo-v2.5-free`);
    console.log(`🤖 [OpenAI Chat]       POST http://localhost:${PORT}/v1/chat/completions`);
    console.log(`📦 [OpenAI Models]     GET  http://localhost:${PORT}/v1/models`);
    console.log(`🧠 [Anthropic Messages] POST http://localhost:${PORT}/v1/messages`);
    console.log(`🛡️  [Rate Limiter]     800 req / 5h per user (Redis Sliding-Window)`);
    console.log(`⚡ [Redis Metrics]     Live tokens, costs, and request counters in Redis`);
    console.log(`💾 [Database Auth]     PostgreSQL Database (Supabase) authoritative API keys`);
    console.log(`🗄️  [Supabase Storage]  http://localhost:${PORT}/api/storage/status\n`);
  });
}

bootstrapServer();
