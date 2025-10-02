import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import csv from 'csv-parser';
import { Readable } from 'stream';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { validate, schemas } from '../middleware/validation';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { tokenService } from '../services/tokenService';
import { prizeService } from '../services/prizeService';
import { playService } from '../services/playService';
import { prisma } from '../utils/prisma';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880') // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

// Admin login
router.post('/login', validate(schemas.adminLogin), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const admin = await prisma.admin.findUnique({
      where: { email }
    });

    if (!admin || !admin.isActive) {
      throw createError('Invalid credentials.', 401);
    }

    const isValidPassword = await bcrypt.compare(password, admin.passwordHash);
    if (!isValidPassword) {
      throw createError('Invalid credentials.', 401);
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw createError('JWT_SECRET environment variable is not set.', 500);
    }
    
    const token = jwt.sign(
      { id: admin.id, email: admin.email, role: admin.role },
      jwtSecret,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' } as jwt.SignOptions
    );

    // Log login
    await prisma.audit.create({
      data: {
        actorId: admin.id,
        action: 'ADMIN_LOGIN',
        details: { email, ip: req.ip }
      }
    });

    res.json({
      success: true,
      data: {
        token,
        admin: {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          role: admin.role
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get admin profile
router.get('/profile', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const admin = await prisma.admin.findUnique({
      where: { id: req.user!.id },
      select: { id: true, name: true, email: true, role: true, createdAt: true }
    });

    res.json({
      success: true,
      data: admin
    });
  } catch (error) {
    next(error);
  }
});

// Create tokens
router.post('/tokens/create', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { count, expiresAt, metadata } = req.body;
    
    if (!count || count <= 0) {
      throw createError('Count must be a positive number.', 400);
    }

    const result = await tokenService.createTokens({
      count,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      metadata
    });

    // Log the creation
    await prisma.audit.create({
      data: {
        actorId: req.user!.id,
        action: 'TOKENS_CREATED',
        details: { count: result.created }
      }
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// Upload tokens via CSV
router.post('/tokens/upload', authenticate, requireAdmin, upload.single('file'), async (req: AuthRequest, res, next) => {
  try {
    if (!req.file) {
      throw createError('CSV file is required.', 400);
    }

    const codes: string[] = [];
    const buffer = req.file.buffer;
    const stream = Readable.from(buffer.toString());

    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (row) => {
          if (row.code) {
            codes.push(row.code.trim());
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    if (codes.length === 0) {
      throw createError('No valid tokens found in CSV.', 400);
    }

    const result = await tokenService.createTokensFromCodes({
      codes,
      expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined,
      metadata: req.body.metadata
    });

    // Log the upload
    await prisma.audit.create({
      data: {
        actorId: req.user!.id,
        action: 'TOKENS_UPLOADED',
        details: { 
          created: result.created, 
          duplicates: result.duplicates,
          filename: req.file.originalname 
        }
      }
    });

    res.json({
      success: true,
      data: {
        message: `Successfully uploaded ${result.created} tokens. ${result.duplicates} duplicates skipped.`,
        created: result.created,
        duplicates: result.duplicates
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get tokens with pagination
router.get('/tokens', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const search = req.query.search as string;

    const result = await tokenService.getTokens(page, limit, search);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// Get token statistics
router.get('/tokens/stats', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const stats = await tokenService.getTokenStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    next(error);
  }
});

// Delete tokens
router.delete('/tokens', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { tokenIds } = req.body;
    
    if (!tokenIds || !Array.isArray(tokenIds)) {
      throw createError('Token IDs array is required.', 400);
    }

    const result = await tokenService.deleteTokens(tokenIds);

    // Log the deletion
    await prisma.audit.create({
      data: {
        actorId: req.user!.id,
        action: 'TOKENS_DELETED',
        details: { count: result.deleted, tokenIds }
      }
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// Create prize/result type
router.post('/prizes', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const prize = await prizeService.createPrize(req.body);

    // Log the creation
    await prisma.audit.create({
      data: {
        actorId: req.user!.id,
        action: 'PRIZE_CREATED',
        details: { prizeId: prize.id, name: prize.name, code: prize.code }
      }
    });

    res.json({
      success: true,
      data: prize
    });
  } catch (error) {
    next(error);
  }
});

// Get prizes
router.get('/prizes', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const prizes = await prizeService.getPrizes(includeInactive);

    res.json({
      success: true,
      data: prizes
    });
  } catch (error) {
    next(error);
  }
});

// Get prize details
router.get('/prizes/:id', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const prize = await prizeService.getPrize(id);

    res.json({
      success: true,
      data: prize
    });
  } catch (error) {
    next(error);
  }
});

// Update prize
router.put('/prizes/:id', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const prize = await prizeService.updatePrize(id, req.body);

    // Log the update
    await prisma.audit.create({
      data: {
        actorId: req.user!.id,
        action: 'PRIZE_UPDATED',
        details: { prizeId: id, changes: req.body }
      }
    });

    res.json({
      success: true,
      data: prize
    });
  } catch (error) {
    next(error);
  }
});

// Delete prize
router.delete('/prizes/:id', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    await prizeService.deletePrize(id);

    // Log the deletion
    await prisma.audit.create({
      data: {
        actorId: req.user!.id,
        action: 'PRIZE_DELETED',
        details: { prizeId: id }
      }
    });

    res.json({
      success: true,
      data: { message: 'Prize deleted successfully' }
    });
  } catch (error) {
    next(error);
  }
});

// Get prize statistics
router.get('/prizes/stats', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const stats = await prizeService.getPrizeStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    next(error);
  }
});

// Update prize stock
router.put('/prizes/:id/stock', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { stockLimit } = req.body;
    
    if (typeof stockLimit !== 'number' || stockLimit < 0) {
      throw createError('Stock limit must be a non-negative number.', 400);
    }

    const prize = await prizeService.updatePrizeStock(id, stockLimit);

    // Log the update
    await prisma.audit.create({
      data: {
        actorId: req.user!.id,
        action: 'PRIZE_STOCK_UPDATED',
        details: { prizeId: id, newStockLimit: stockLimit }
      }
    });

    res.json({
      success: true,
      data: prize
    });
  } catch (error) {
    next(error);
  }
});

// Validate prize configuration
router.get('/prizes/validate', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const validation = await prizeService.validatePrizeConfiguration();

    res.json({
      success: true,
      data: validation
    });
  } catch (error) {
    next(error);
  }
});

// Get plays with filters
router.get('/plays', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const from = req.query.from as string;
    const to = req.query.to as string;
    const prizeType = req.query.prizeType as string;
    const isRedeemed = req.query.isRedeemed as string;

    const where: any = {};
    
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    
    if (prizeType) {
      where.resultType = { code: prizeType };
    }
    
    if (isRedeemed !== undefined) {
      where.isRedeemed = isRedeemed === 'true';
    }

    const [plays, total] = await Promise.all([
      prisma.play.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { resultType: true, token: true }
      }),
      prisma.play.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        plays,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Export plays as CSV
router.get('/exports/plays.csv', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const from = req.query.from as string;
    const to = req.query.to as string;
    const prizeType = req.query.prizeType as string;

    const where: any = {};
    
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    
    if (prizeType) {
      where.resultType = { code: prizeType };
    }

    const plays = await prisma.play.findMany({
      where,
      include: { resultType: true, token: true },
      orderBy: { createdAt: 'desc' }
    });

    // Generate CSV
    const csvHeader = 'ID,First Name,Last Name,Phone,Email,Age,Result Code,Prize Type,Is Winner,Is Redeemed,Redeemed At,Created At,Token Code\n';
    const csvRows = plays.map((play: any) => [
      play.id,
      play.firstName,
      play.lastName,
      play.phone,
      play.email || '',
      play.age,
      play.resultCode,
      play.resultType.name,
      play.resultType.stockLimit === null || play.resultType.distributedCount < play.resultType.stockLimit ? 'Yes' : 'No',
      play.isRedeemed ? 'Yes' : 'No',
      play.redeemedAt ? play.redeemedAt.toISOString() : '',
      play.createdAt.toISOString(),
      play.token.code
    ].map(field => `"${field}"`).join(',')).join('\n');

    const csvContent = csvHeader + csvRows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="plays-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);

    // Log the export
    await prisma.audit.create({
      data: {
        actorId: req.user!.id,
        action: 'PLAYS_EXPORTED',
        details: { count: plays.length, filters: { from, to, prizeType } }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Mark play as redeemed
router.post('/play/:playId/redeem', authenticate, requireAdmin, validate(schemas.playRedeem), async (req: AuthRequest, res, next) => {
  try {
    const { playId } = req.params;
    const { redeemedBy, notes } = req.body;

    const play = await prisma.play.update({
      where: { id: playId },
      data: {
        isRedeemed: true,
        redeemedAt: new Date()
      },
      include: { resultType: true }
    });

    // Log the redemption
    await prisma.audit.create({
      data: {
        actorId: req.user!.id,
        action: 'PLAY_REDEEMED',
        details: {
          playId,
          resultCode: play.resultCode,
          prizeType: play.resultType.name,
          redeemedBy,
          notes
        }
      }
    });

    res.json({
      success: true,
      data: {
        message: 'Play marked as redeemed successfully.',
        play
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get dashboard stats
router.get('/dashboard', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalTokens,
      usedTokens,
      totalPlays,
      todayPlays,
      weekPlays,
      totalRedeemed,
      resultTypes
    ] = await Promise.all([
      prisma.token.count(),
      prisma.token.count({ where: { isUsed: true } }),
      prisma.play.count(),
      prisma.play.count({ where: { createdAt: { gte: today } } }),
      prisma.play.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.play.count({ where: { isRedeemed: true } }),
      prisma.resultType.findMany({
        include: {
          _count: {
            select: { plays: true }
          }
        }
      })
    ]);

    res.json({
      success: true,
      data: {
        tokens: {
          total: totalTokens,
          used: usedTokens,
          available: totalTokens - usedTokens
        },
        plays: {
          total: totalPlays,
          today: todayPlays,
          thisWeek: weekPlays,
          redeemed: totalRedeemed
        },
        resultTypes: resultTypes.map((rt: any) => ({
          ...rt,
          playsCount: rt._count.plays
        }))
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;


