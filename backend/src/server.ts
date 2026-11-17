import dotenv from 'dotenv';

// Load environment variables FIRST before any other imports that use them
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import rateLimit from 'express-rate-limit';
import passport from './config/passport';
import { connectDatabase } from './config/database';

// Import routes
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import campaignRoutes from './routes/campaign.routes';
import projectRoutes from './routes/project.routes';
import taskRoutes from './routes/task.routes';
import commentRoutes from './routes/comment.routes';
import assetRoutes from './routes/asset.routes';
import integrationsRoutes from './routes/integrations.routes';
import promptRoutes from './routes/prompt.routes';
import llmRoutes from './routes/llm.routes';
import commandMappingRoutes from './routes/commandMapping.routes';
import chainRoutes from './routes/chain.routes';
import { requireAI } from './middleware/access';
import { authenticateBearer, skipForBearer, isInternalRequest } from './middleware/bearerAuth';
import oauthRoutes from './oauth/oauth.routes';
import connectedAppsRoutes from './routes/connectedApps.routes';
import blueRoutes from './routes/blue.routes';
import libraryRoutes from './routes/library.routes';
import publishingRoutes from './routes/publishing.routes';
import canvaRoutes from './routes/canva.routes';
import inboxRoutes from './routes/inbox.routes';
import { startInboxWorker } from './inbox/rules';
import { startPublishingWorker } from './publishing/worker';
import { startLibraryWorker } from './library/worker';
import mcpRouter from './mcp/router';

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/campaign_management';

// Connect to database
connectDatabase();

// Behind a tunnel or reverse proxy (ngrok, cloudflared, nginx) this lets req.ip / req.protocol / host
// reflect the real client and public URL. Default trusts only a proxy running on this machine.
const trustProxyEnv = process.env.TRUST_PROXY?.trim();
app.set(
  'trust proxy',
  !trustProxyEnv ? 'loopback'
    : trustProxyEnv === 'true' ? true
    : trustProxyEnv === 'false' ? false
    : /^\d+$/.test(trustProxyEnv) ? Number(trustProxyEnv)
    : trustProxyEnv
);

// Security middleware
app.use(helmet());

// Request logging
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// ---------------------------------------------------------------------------
// Claude connector: OAuth 2.1 authorization server + MCP endpoint.
// Mounted before the app's cookie/CORS stack: these are called server-to-server by Claude
// (and by browser-based MCP tools), authenticate with bearer tokens and never use cookies.
// ---------------------------------------------------------------------------
app.use(oauthRoutes);
app.use('/mcp', mcpRouter);

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Body parsing middleware (task content written through the connector can be long)
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Disable ETags for API routes to prevent 304 caching issues
// ETags can cause problems with client-side state management when
// using conditional requests with dynamic JSON data
app.set('etag', false);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  // A Library page alone loads dozens of thumbnails, so the old limit of 100 was far too low for normal use.
  max: Number(process.env.API_RATE_LIMIT_PER_15_MIN) || 1500,
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  // The MCP connector's own loopback calls are limited per token on /mcp instead; Library file links
  // are cheap signed-URL redirects that browsers request in bulk.
  skip: (req) => isInternalRequest(req) || (req.method === 'GET' && /^\/api\/library\/items\/[a-f0-9]{24}\/file$/i.test(`${req.baseUrl}${req.path}`))
});

app.use('/api/', limiter);

// Session configuration
const sessionMiddleware = (
  session({
    secret: process.env.SESSION_SECRET || 'your-super-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: MONGODB_URI,
      touchAfter: 24 * 3600 // Lazy session update (in seconds)
    }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
    }
  })
);
// Requests authenticated with an OAuth bearer token (Claude) never create or read cookie sessions.
app.use(skipForBearer(sessionMiddleware));

// Initialize Passport
app.use(passport.initialize());
app.use(skipForBearer(passport.session()));

// OAuth bearer tokens act as the user who approved the connection (same permissions as the web app).
app.use('/api', authenticateBearer);

// ---------------------------------------------------------------------------
// AI generation guard (Part one = allowed, Part two = blocked).
// Everything that spends our AI routing is listed here, in one place, so it is easy to audit.
// All other endpoints behave identically for both parts.
// ---------------------------------------------------------------------------
app.use(
  [
    '/api/llm',
    '/api/prompts',
    '/api/command-mappings',
    '/api/chains',
    // provider API keys / default model configuration
    '/api/integrations/openai',
    '/api/integrations/anthropic',
    '/api/integrations/grok',
    '/api/integrations/gemini',
    '/api/integrations/llm',
    '/api/integrations/image-llm'
  ],
  requireAI
);
app.post('/api/campaigns/:id/generate', requireAI);
app.post('/api/campaigns/:id/generate-tasks', requireAI);
app.post('/api/tasks/:id/generate-poster', requireAI);
app.post('/api/tasks/:id/refine-description', requireAI);
app.patch('/api/tasks/:id/adopt-poster', requireAI);

// API Routes
app.use('/api', connectedAppsRoutes); // /api/oauth/requests/*, /api/connected-apps
app.use('/api/blue', blueRoutes); // Blue, the in-app assistant
app.use('/api/library', libraryRoutes); // Library (Aggregator)
app.use('/api/publishing', publishingRoutes); // Publishing (social posting)
app.use('/api/inbox', inboxRoutes); // Inbox + admin Outreach
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/integrations/canva', canvaRoutes); // Canva connect + Edit in Canva
app.use('/api/integrations', integrationsRoutes);
app.use('/api/prompts', promptRoutes);
app.use('/api/llm', llmRoutes);
app.use('/api/command-mappings', commandMappingRoutes);
app.use('/api/chains', chainRoutes);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Campaign Management API',
    version: '1.0.0'
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);

  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// Start server
// Production safety: secrets left at their development defaults would let anyone forge sessions or
// read stored platform tokens. Warn loudly (not fatal, so an existing deployment keeps running).
if (process.env.NODE_ENV === 'production') {
  const weak: string[] = [];
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'your-super-secret-key-change-in-production') weak.push('SESSION_SECRET');
  if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY === 'default-32-char-encryption-key!!') weak.push('ENCRYPTION_KEY');
  if (!process.env.MCP_PUBLIC_URL) weak.push('MCP_PUBLIC_URL (needed for Claude, platform sign-ins and Canva)');
  if (weak.length) console.warn(`⚠️  SECURITY: set these environment variables before going live: ${weak.join(', ')}`);
}

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 API: http://localhost:${PORT}`);
  startLibraryWorker();
  startPublishingWorker();
  startInboxWorker();
});

export default app;
