import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import { errorHandler, createRateLimitError } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { logger } from './utils/logger';
import { prisma } from './utils/prisma';
import { performStartupConfigCheck } from './middleware/configValidation';

// Import routes
import playRoutes from './routes/play';
import adminRoutes from './routes/admin';
import staffRoutes from './routes/staff';
import healthRoutes from './routes/health';

// Load environment variables
dotenv.config();

// Perform startup configuration validation
try {
  performStartupConfigCheck();
} catch (error) {
  logger.error('Startup configuration check failed', {
    error: error instanceof Error ? error.message : 'Unknown error'
  });
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3002;

// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN ? 
    process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()) : 
    (process.env.NODE_ENV === 'production' ? false : "*"),
  credentials: false,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));

// Rate limiting with enhanced error handling
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: createRateLimitError(),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path.startsWith('/health');
  },
  handler: (req, res, next) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url,
      method: req.method
    });
    next(createRateLimitError());
  }
});

app.use(limiter);

// Body parsing middleware with error handling
app.use(express.json({ 
  limit: '10mb',
  type: ['application/json', 'text/plain']
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}));

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
    
    logger[logLevel]('Request completed', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      contentLength: res.get('Content-Length')
    });
  });
  
  next();
});

// Health check routes (before authentication)
app.use('/health', healthRoutes);

// Legacy health check endpoint for backward compatibility
app.get('/health-legacy', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV 
  });
});

// API routes
app.use('/api/play', playRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/staff', staffRoutes);

// Error handling middleware (must be last)
app.use(notFound);
app.use(errorHandler);

// Global error handlers for uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack,
    type: 'uncaughtException'
  });
  
  // Graceful shutdown
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    promise: promise.toString(),
    type: 'unhandledRejection'
  });
  
  // Graceful shutdown
  process.exit(1);
});

// Graceful shutdown handlers
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  
  try {
    // Close database connections
    await prisma.$disconnect();
    logger.info('Database connections closed');
    
    // Exit successfully
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    process.exit(1);
  }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Start server with error handling
const server = app.listen(PORT, () => {
  logger.info('Server started successfully', {
    port: PORT,
    environment: process.env.NODE_ENV,
    nodeVersion: process.version,
    pid: process.pid
  });
});

// Handle server errors
server.on('error', (error: any) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`Port ${PORT} is already in use`);
  } else if (error.code === 'EACCES') {
    logger.error(`Permission denied to bind to port ${PORT}`);
  } else {
    logger.error('Server error', {
      error: error.message,
      code: error.code
    });
  }
  process.exit(1);
});

export default app;

