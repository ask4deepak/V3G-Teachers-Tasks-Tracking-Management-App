/**
 * Main Application Server (server.js)
 * Teacher Task, Workflow, Performance & Administration Web Application (Version 1)
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const db = require('./db');
const routes = require('./routes');
const services = require('./services');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Trust reverse proxy (Railway, Heroku, Cloudflare)
if (isProduction) {
  app.set('trust proxy', 1);
}

// Body Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Simple In-Memory Login Rate Limiter
const loginAttempts = new Map();
app.use('/api/auth/login', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const ip = req.ip || '127.0.0.1';
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, resetTime: now + 60000 };

  if (now > entry.resetTime) {
    entry.count = 0;
    entry.resetTime = now + 60000;
  }

  entry.count++;
  loginAttempts.set(ip, entry);

  if (entry.count > 10) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again after one minute.' });
  }
  next();
});

// Initialize Database and Configure Sessions
async function startServer() {
  await db.initDb();

  // Session Store Configuration
  let sessionStore;
  if (!db.isMemoryFallback() && db.getPool()) {
    sessionStore = new pgSession({
      pool: db.getPool(),
      tableName: 'session',
      createTableIfMissing: true
    });
  }

  app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'v3g-teacher-task-tracking-default-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    }
  }));

  // Static Assets
  app.use(express.static(path.join(__dirname, 'public')));

  // REST API Routes
  app.use('/api', routes);

  // Fallback to SPA Frontend for HTML navigation
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // Centralized Error Handling Middleware
  app.use((err, req, res, next) => {
    console.error(`[Server Error] ${req.method} ${req.path}:`, err.message);
    const statusCode = err.status || 500;
    const clientMessage = isProduction
      ? 'An unexpected error occurred. Please try again later.'
      : err.message || 'Internal Server Error';

    res.status(statusCode).json({ error: clientMessage });
  });

  // Start HTTP Server
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`========================================================`);
    console.log(`🚀 Teacher Task Tracking System is running on port ${PORT} (0.0.0.0)`);
    console.log(`🌐 Local URL: http://localhost:${PORT}`);
    console.log(`🔒 Mode: ${process.env.NODE_ENV || 'development'}`);
    console.log(`========================================================`);
  });

  // Lightweight Idempotent Scheduler Ticker for Recurring Tasks (Runs every 60 seconds)
  const recurrenceInterval = setInterval(async () => {
    try {
      await services.processRecurringTasks();
    } catch (err) {
      console.error('[Recurring Tasks Scheduler Error]:', err.message);
    }
  }, 60 * 1000);

  // Graceful Shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received. Closing HTTP server.');
    clearInterval(recurrenceInterval);
    server.close(() => console.log('HTTP server closed.'));
  });

  return server;
}

if (require.main === module) {
  startServer().catch(err => {
    console.error('Fatal Server Startup Error:', err);
    process.exit(1);
  });
}

module.exports = { app, startServer };
