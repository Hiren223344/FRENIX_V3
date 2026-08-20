import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { clerkMiddleware } from '@clerk/express';
import apiRouter from './routes/api.js';
import v1Router from './routes/v1.js';
import { errorHandler } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
// Provider-1 Gateway Router active (mimo-v2.5-free)

// Core Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Clerk Middleware for Express
app.use(clerkMiddleware());

// API Routes
app.use('/v1', v1Router);
app.use('/api/v1', v1Router);
app.use('/api', apiRouter);

// Production Static File Serving (Vite build output)
if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(__dirname, '../dist');
  app.use(express.static(distPath));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Error Handler
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`\n🚀 [Backend Server]     Listening on http://localhost:${PORT}`);
  console.log(`📡 [API Health]        http://localhost:${PORT}/api/health`);
  console.log(`📊 [API Stats]         http://localhost:${PORT}/api/stats`);
  console.log(`⚡ [API v1 Status]     http://localhost:${PORT}/v1/ok`);
  console.log(`👤 [User Creation]     POST http://localhost:${PORT}/v1/user/create`);
  console.log(`👤 [User Profile / Me] GET  http://localhost:${PORT}/v1/user/me`);
  console.log(`💎 [Model Pricing]     GET  http://localhost:${PORT}/v1/pricing`);
  console.log(`🎭 [AI Identity]       GET  http://localhost:${PORT}/v1/identity`);
  console.log(`🌐 [AI Provider-1]     OpenCode Zen (https://opencode.ai/zen/v1)`);
  console.log(`🔀 [Model Routing]     claude-opus-5 ➔ mimo-v2.5-free`);
  console.log(`🤖 [OpenAI Chat]       POST http://localhost:${PORT}/v1/chat/completions`);
  console.log(`📦 [OpenAI Models]     GET  http://localhost:${PORT}/v1/models`);
  console.log(`🧠 [Anthropic Messages] POST http://localhost:${PORT}/v1/messages`);
  console.log(`🛡️  [Rate Limiter]     800 req / 5h per user (Redis Fast Sliding-Window)`);
  console.log(`⚡ [Redis Metrics]     Live tokens, costs, and request counters in Redis`);
  console.log(`💾 [Database Auth]     PostgreSQL Database (Supabase) authoritative API keys & audit logs`);
  console.log(`🗄️  [Supabase Storage]  http://localhost:${PORT}/api/storage/status\n`);
});
