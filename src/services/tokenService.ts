import { v4 as uuidv4 } from 'uuid';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

export interface TokenCreateRequest {
  count: number;
  expiresAt?: Date;
  metadata?: any;
}

export interface TokenBulkCreateRequest {
  codes: string[];
  expiresAt?: Date;
  metadata?: any;
}

export class TokenService {
  async createTokens(request: TokenCreateRequest): Promise<{ tokens: any[], created: number }> {
    const { count, expiresAt, metadata } = request;

    if (count <= 0 || count > 10000) {
      throw createError('Token count must be between 1 and 10000.', 400);
    }

    const tokens = [];
    for (let i = 0; i < count; i++) {
      tokens.push({
        id: uuidv4(),
        code: this.generateTokenCode(),
        expiresAt,
        metadata
      });
    }

    try {
      const result = await prisma.token.createMany({
        data: tokens,
        skipDuplicates: true
      });

      logger.info('Tokens created successfully', {
        requested: count,
        created: result.count
      });

      return {
        tokens: tokens.map(t => ({ id: t.id, code: t.code })),
        created: result.count
      };
    } catch (error) {
      logger.error('Failed to create tokens', { error, count });
      throw createError('Failed to create tokens.', 500);
    }
  }

  async createTokensFromCodes(request: TokenBulkCreateRequest): Promise<{ created: number, duplicates: number }> {
    const { codes, expiresAt, metadata } = request;

    if (codes.length === 0 || codes.length > 10000) {
      throw createError('Codes array must contain between 1 and 10000 items.', 400);
    }

    // Remove duplicates from input
    const uniqueCodes = [...new Set(codes)];
    
    const tokens = uniqueCodes.map(code => ({
      id: uuidv4(),
      code: code.trim().toUpperCase(),
      expiresAt,
      metadata
    }));

    try {
      const result = await prisma.token.createMany({
        data: tokens,
        skipDuplicates: true
      });

      const duplicates = uniqueCodes.length - result.count;

      logger.info('Tokens created from codes', {
        provided: codes.length,
        unique: uniqueCodes.length,
        created: result.count,
        duplicates
      });

      return {
        created: result.count,
        duplicates
      };
    } catch (error) {
      logger.error('Failed to create tokens from codes', { error, codesCount: codes.length });
      throw createError('Failed to create tokens from codes.', 500);
    }
  }

  async getTokens(page: number = 1, limit: number = 50, search?: string) {
    const offset = (page - 1) * limit;

    const where = search ? {
      OR: [
        { code: { contains: search, mode: 'insensitive' as const } },
        { id: { contains: search, mode: 'insensitive' as const } }
      ]
    } : {};

    const [tokens, total] = await Promise.all([
      prisma.token.findMany({
        where,
        include: {
          play: {
            include: {
              resultType: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.token.count({ where })
    ]);

    return {
      tokens: tokens.map(token => ({
        id: token.id,
        code: token.code,
        isUsed: token.isUsed,
        usedAt: token.usedAt,
        expiresAt: token.expiresAt,
        createdAt: token.createdAt,
        play: token.play ? {
          id: token.play.id,
          firstName: token.play.firstName,
          lastName: token.play.lastName,
          resultCode: token.play.resultCode,
          prizeType: token.play.resultType.name,
          isRedeemed: token.play.isRedeemed,
          createdAt: token.play.createdAt
        } : null
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  async getTokenStats() {
    const [total, used, expired, active] = await Promise.all([
      prisma.token.count(),
      prisma.token.count({ where: { isUsed: true } }),
      prisma.token.count({
        where: {
          expiresAt: { lt: new Date() },
          isUsed: false
        }
      }),
      prisma.token.count({
        where: {
          isUsed: false,
          OR: [
            { expiresAt: null },
            { expiresAt: { gte: new Date() } }
          ]
        }
      })
    ]);

    return {
      total,
      used,
      expired,
      active,
      usageRate: total > 0 ? (used / total) * 100 : 0
    };
  }

  async deleteTokens(tokenIds: string[]): Promise<{ deleted: number }> {
    if (tokenIds.length === 0) {
      throw createError('No token IDs provided.', 400);
    }

    // Check if any tokens are already used
    const usedTokens = await prisma.token.findMany({
      where: {
        id: { in: tokenIds },
        isUsed: true
      },
      select: { id: true, code: true }
    });

    if (usedTokens.length > 0) {
      throw createError(
        `Cannot delete used tokens: ${usedTokens.map(t => t.code).join(', ')}`,
        400
      );
    }

    const result = await prisma.token.deleteMany({
      where: {
        id: { in: tokenIds },
        isUsed: false
      }
    });

    logger.info('Tokens deleted', {
      requested: tokenIds.length,
      deleted: result.count
    });

    return { deleted: result.count };
  }

  async validateToken(code: string): Promise<{ valid: boolean, token?: any, reason?: string }> {
    const token = await prisma.token.findUnique({
      where: { code },
      include: { play: true }
    });

    if (!token) {
      return { valid: false, reason: 'Token not found' };
    }

    if (token.isUsed) {
      return { valid: false, reason: 'Token already used', token };
    }

    if (token.expiresAt && token.expiresAt < new Date()) {
      return { valid: false, reason: 'Token expired', token };
    }

    return { valid: true, token };
  }

  private generateTokenCode(): string {
    // Generate a unique 12-character code
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 12; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async exportTokens(filters?: {
    isUsed?: boolean;
    hasExpired?: boolean;
    createdAfter?: Date;
    createdBefore?: Date;
  }) {
    const where: any = {};

    if (filters?.isUsed !== undefined) {
      where.isUsed = filters.isUsed;
    }

    if (filters?.hasExpired === true) {
      where.expiresAt = { lt: new Date() };
    } else if (filters?.hasExpired === false) {
      where.OR = [
        { expiresAt: null },
        { expiresAt: { gte: new Date() } }
      ];
    }

    if (filters?.createdAfter) {
      where.createdAt = { ...where.createdAt, gte: filters.createdAfter };
    }

    if (filters?.createdBefore) {
      where.createdAt = { ...where.createdAt, lte: filters.createdBefore };
    }

    const tokens = await prisma.token.findMany({
      where,
      include: {
        play: {
          include: {
            resultType: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return tokens.map(token => ({
      id: token.id,
      code: token.code,
      isUsed: token.isUsed,
      usedAt: token.usedAt,
      expiresAt: token.expiresAt,
      createdAt: token.createdAt,
      playerName: token.play ? `${token.play.firstName} ${token.play.lastName}` : null,
      playerEmail: token.play?.email || null,
      playerPhone: token.play?.phone || null,
      resultCode: token.play?.resultCode || null,
      prizeType: token.play?.resultType.name || null,
      isRedeemed: token.play?.isRedeemed || false,
      playedAt: token.play?.createdAt || null
    }));
  }
}

export const tokenService = new TokenService();
