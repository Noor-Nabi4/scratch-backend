import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createError, createAuthError, createAuthorizationError, asyncHandler } from './errorHandler';
import { prisma, safeQuery } from '../utils/prisma';
import { logger } from '../utils/logger';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: 'ADMIN' | 'STAFF';
  };
}

export const authenticate = asyncHandler(async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.header('Authorization');
    
    if (!authHeader) {
      throw createAuthError('Authorization header missing');
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw createAuthError('Invalid authorization format. Use Bearer token');
    }

    const token = authHeader.replace('Bearer ', '').trim();

    if (!token) {
      throw createAuthError('Access token missing');
    }

    // Validate JWT_SECRET exists
    if (!process.env.JWT_SECRET) {
      logger.error('JWT_SECRET environment variable not configured');
      throw createError('Authentication service not configured', 500, 'AUTH_SERVICE_ERROR');
    }

    // Verify and decode token
    let decoded: any;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET) as any;
    } catch (jwtError) {
      if (jwtError instanceof jwt.TokenExpiredError) {
        throw createAuthError('Authentication token expired');
      } else if (jwtError instanceof jwt.JsonWebTokenError) {
        throw createAuthError('Invalid authentication token');
      } else if (jwtError instanceof jwt.NotBeforeError) {
        throw createAuthError('Token not active yet');
      } else {
        logger.error('JWT verification failed', { 
          error: jwtError instanceof Error ? jwtError.message : 'Unknown error' 
        });
        throw createAuthError('Token verification failed');
      }
    }

    // Validate token payload
    if (!decoded || typeof decoded !== 'object' || !decoded.id) {
      throw createAuthError('Invalid token payload');
    }

    // Fetch user from database with error handling
    const admin = await safeQuery(
      () => prisma.admin.findUnique({
        where: { id: decoded.id },
        select: { id: true, email: true, role: true, isActive: true }
      }),
      'Failed to fetch user data'
    );

    if (!admin) {
      logger.warn('Authentication attempt with non-existent user', { 
        userId: decoded.id,
        ip: req.ip 
      });
      throw createAuthError('User not found');
    }

    if (!admin.isActive) {
      logger.warn('Authentication attempt with inactive user', { 
        userId: admin.id,
        email: admin.email,
        ip: req.ip 
      });
      throw createAuthError('User account is inactive');
    }

    // Set user context
    req.user = {
      id: admin.id,
      email: admin.email,
      role: admin.role
    };

    logger.debug('User authenticated successfully', {
      userId: admin.id,
      email: admin.email,
      role: admin.role,
      ip: req.ip
    });

    next();
  } catch (error) {
    // Log authentication failures
    logger.warn('Authentication failed', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    next(error);
  }
});

export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw createAuthError('Authentication required');
    }

    if (req.user.role !== 'ADMIN') {
      logger.warn('Authorization failed - insufficient permissions', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRole: 'ADMIN',
        ip: req.ip,
        url: req.url
      });
      throw createAuthorizationError('Admin access required');
    }

    logger.debug('Admin authorization successful', {
      userId: req.user.id,
      ip: req.ip
    });

    next();
  } catch (error) {
    next(error);
  }
};

export const requireStaff = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw createAuthError('Authentication required');
    }

    if (req.user.role !== 'ADMIN' && req.user.role !== 'STAFF') {
      logger.warn('Authorization failed - insufficient permissions', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRoles: ['ADMIN', 'STAFF'],
        ip: req.ip,
        url: req.url
      });
      throw createAuthorizationError('Staff or Admin access required');
    }

    logger.debug('Staff authorization successful', {
      userId: req.user.id,
      userRole: req.user.role,
      ip: req.ip
    });

    next();
  } catch (error) {
    next(error);
  }
};

// Rate limiting for authentication attempts
const authAttempts = new Map<string, { count: number; lastAttempt: Date }>();
const MAX_AUTH_ATTEMPTS = 5;
const AUTH_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export const rateLimitAuth = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const ip = req.ip || 'unknown';
    const now = new Date();
    
    const attempts = authAttempts.get(ip);
    
    if (attempts) {
      // Clean up old attempts
      if (now.getTime() - attempts.lastAttempt.getTime() > AUTH_WINDOW_MS) {
        authAttempts.delete(ip);
      } else if (attempts.count >= MAX_AUTH_ATTEMPTS) {
        logger.warn('Authentication rate limit exceeded', {
          ip,
          attempts: attempts.count,
          lastAttempt: attempts.lastAttempt
        });
        throw createError('Too many authentication attempts. Please try again later.', 429, 'AUTH_RATE_LIMIT_EXCEEDED');
      }
    }
    
    next();
  } catch (error) {
    next(error);
  }
};

export const recordAuthAttempt = (ip: string, success: boolean) => {
  if (success) {
    // Clear attempts on successful auth
    authAttempts.delete(ip);
  } else {
    // Increment failed attempts
    const attempts = authAttempts.get(ip) || { count: 0, lastAttempt: new Date() };
    attempts.count++;
    attempts.lastAttempt = new Date();
    authAttempts.set(ip, attempts);
  }
};

// Middleware to validate environment configuration
export const validateAuthConfig = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!process.env.JWT_SECRET) {
    logger.error('Authentication configuration error: JWT_SECRET not set');
    return next(createError('Authentication service not configured', 500, 'AUTH_CONFIG_ERROR'));
  }

  if (process.env.JWT_SECRET.length < 32) {
    logger.error('Authentication configuration error: JWT_SECRET too short');
    return next(createError('Authentication service misconfigured', 500, 'AUTH_CONFIG_ERROR'));
  }

  next();
};

