import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { createError } from './errorHandler';

const prisma = new PrismaClient();

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: 'ADMIN' | 'STAFF';
  };
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      throw createError('Access denied. No token provided.', 401);
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    
    const admin = await prisma.admin.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, role: true, isActive: true }
    });

    if (!admin || !admin.isActive) {
      throw createError('Invalid token or user not found.', 401);
    }

    req.user = {
      id: admin.id,
      email: admin.email,
      role: admin.role
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(createError('Invalid token.', 401));
    } else {
      next(error);
    }
  }
};

export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (req.user?.role !== 'ADMIN') {
    return next(createError('Admin access required.', 403));
  }
  next();
};

export const requireStaff = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user || (req.user.role !== 'ADMIN' && req.user.role !== 'STAFF')) {
    return next(createError('Staff access required.', 403));
  }
  next();
};

