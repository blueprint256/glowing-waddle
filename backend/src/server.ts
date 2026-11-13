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
import { requirePartOne, requirePartTwo } from './middleware/access';
import { isAuthenticated } from './middleware/auth';

// Content Hub routes
import slotRoutes from './routes/slot.routes';
import uploadRoutes from './routes/upload.routes';
import versionRoutes from './routes/version.routes';
import hubProjectRoutes from './routes/hubProject.routes';
import hubAssetRoutes from './routes/hubAsset.routes';

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/campaign_management';

// Connect to database
connectDatabase();

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Request logging
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Disable ETags for API routes to prevent 304 caching issues
// ETags can cause problems with client-side state management when
// using conditional requests with dynamic JSON data
app.set('etag', false);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later'
});

app.use('/api/', limiter);

// Session configuration
app.use(
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

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
// Part one (full campaign suite). A System Admin can restrict a user to the Content Hub only,
// in which case every request below answers 403 ACCESS_RESTRICTED for that user.
app.use('/api/campaigns', requirePartOne, campaignRoutes);
app.use('/api/projects', requirePartOne, projectRoutes);
app.use('/api/tasks', requirePartOne, taskRoutes);
app.use('/api/comments', requirePartOne, commentRoutes);
app.use('/api/assets', requirePartOne, assetRoutes);
app.use('/api/integrations', requirePartOne, integrationsRoutes);
app.use('/api/prompts', requirePartOne, promptRoutes);
app.use('/api/llm', requirePartOne, llmRoutes);
app.use('/api/command-mappings', requirePartOne, commandMappingRoutes);
app.use('/api/chains', requirePartOne, chainRoutes);

// Part two (Content Hub), everything namespaced under /api/hub.
// The guest upload endpoint is public by design (its one-time token is the credential),
// so it is mounted before the authenticated + access-gated hub routes.
app.use('/api/hub', uploadRoutes);
app.use('/api/hub', isAuthenticated, requirePartTwo, hubProjectRoutes, slotRoutes, versionRoutes, hubAssetRoutes);

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
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 API: http://localhost:${PORT}`);
});

export default app;
