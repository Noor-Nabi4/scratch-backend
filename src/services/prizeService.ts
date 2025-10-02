import { v4 as uuidv4 } from 'uuid';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

export interface PrizeCreateRequest {
  name: string;
  code: string;
  description?: string;
  prizeValue?: string;
  weight: number;
  stockLimit?: number;
  isPrize: boolean;
  isActive?: boolean;
}

export interface PrizeUpdateRequest {
  name?: string;
  description?: string;
  prizeValue?: string;
  weight?: number;
  stockLimit?: number;
  isPrize?: boolean;
  isActive?: boolean;
}

export class PrizeService {
  async createPrize(request: PrizeCreateRequest) {
    const { code, ...data } = request;

    // Check if code already exists
    const existing = await prisma.resultType.findUnique({
      where: { code }
    });

    if (existing) {
      throw createError('Prize code already exists.', 400);
    }

    const prize = await prisma.resultType.create({
      data: {
        id: uuidv4(),
        code: code.toUpperCase(),
        ...data,
        isActive: data.isActive ?? true
      }
    });

    logger.info('Prize created successfully', {
      prizeId: prize.id,
      code: prize.code,
      name: prize.name
    });

    return prize;
  }

  async updatePrize(id: string, request: PrizeUpdateRequest) {
    const prize = await prisma.resultType.findUnique({
      where: { id }
    });

    if (!prize) {
      throw createError('Prize not found.', 404);
    }

    const updatedPrize = await prisma.resultType.update({
      where: { id },
      data: request
    });

    logger.info('Prize updated successfully', {
      prizeId: id,
      changes: Object.keys(request)
    });

    return updatedPrize;
  }

  async deletePrize(id: string) {
    const prize = await prisma.resultType.findUnique({
      where: { id },
      include: {
        plays: true
      }
    });

    if (!prize) {
      throw createError('Prize not found.', 404);
    }

    if (prize.plays.length > 0) {
      throw createError('Cannot delete prize that has been awarded to players.', 400);
    }

    await prisma.resultType.delete({
      where: { id }
    });

    logger.info('Prize deleted successfully', {
      prizeId: id,
      code: prize.code,
      name: prize.name
    });

    return { success: true };
  }

  async getPrizes(includeInactive: boolean = false) {
    const where = includeInactive ? {} : { isActive: true };

    const prizes = await prisma.resultType.findMany({
      where,
      orderBy: [
        { isPrize: 'desc' },
        { weight: 'desc' },
        { name: 'asc' }
      ]
    });

    return prizes;
  }

  async getPrize(id: string) {
    const prize = await prisma.resultType.findUnique({
      where: { id },
      include: {
        plays: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            resultCode: true,
            isRedeemed: true,
            createdAt: true
          },
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    });

    if (!prize) {
      throw createError('Prize not found.', 404);
    }

    return {
      ...prize,
      recentWinners: prize.plays
    };
  }

  async getPrizeStats() {
    const prizes = await prisma.resultType.findMany({
      include: {
        _count: {
          select: {
            plays: true
          }
        }
      }
    });

    const totalPlays = await prisma.play.count();
    const totalRedeemed = await prisma.play.count({
      where: { isRedeemed: true }
    });

    const stats = prizes.map(prize => {
      const totalAwarded = prize._count.plays;
      const distributionRate = totalPlays > 0 ? (totalAwarded / totalPlays) * 100 : 0;
      const stockRemaining = prize.stockLimit ? prize.stockLimit - prize.distributedCount : null;
      const isOutOfStock = prize.stockLimit ? prize.distributedCount >= prize.stockLimit : false;

      return {
        id: prize.id,
        name: prize.name,
        code: prize.code,
        isPrize: prize.isPrize,
        isActive: prize.isActive,
        weight: prize.weight,
        stockLimit: prize.stockLimit,
        distributedCount: prize.distributedCount,
        redeemedCount: prize.redeemedCount,
        stockRemaining,
        isOutOfStock,
        totalAwarded,
        distributionRate: Math.round(distributionRate * 100) / 100
      };
    });

    return {
      prizes: stats,
      summary: {
        totalPrizeTypes: prizes.length,
        activePrizeTypes: prizes.filter(p => p.isActive).length,
        totalPlays,
        totalRedeemed,
        redemptionRate: totalPlays > 0 ? Math.round((totalRedeemed / totalPlays) * 100 * 100) / 100 : 0
      }
    };
  }

  async updatePrizeStock(id: string, newStockLimit: number) {
    const prize = await prisma.resultType.findUnique({
      where: { id }
    });

    if (!prize) {
      throw createError('Prize not found.', 404);
    }

    if (newStockLimit < prize.distributedCount) {
      throw createError(
        `New stock limit (${newStockLimit}) cannot be less than already distributed count (${prize.distributedCount}).`,
        400
      );
    }

    const updatedPrize = await prisma.resultType.update({
      where: { id },
      data: { stockLimit: newStockLimit }
    });

    logger.info('Prize stock updated', {
      prizeId: id,
      oldLimit: prize.stockLimit,
      newLimit: newStockLimit
    });

    return updatedPrize;
  }

  async resetPrizeDistribution(id: string) {
    const prize = await prisma.resultType.findUnique({
      where: { id },
      include: {
        plays: true
      }
    });

    if (!prize) {
      throw createError('Prize not found.', 404);
    }

    if (prize.plays.length > 0) {
      throw createError(
        'Cannot reset distribution for prize that has been awarded. Delete associated plays first.',
        400
      );
    }

    const updatedPrize = await prisma.resultType.update({
      where: { id },
      data: {
        distributedCount: 0,
        redeemedCount: 0
      }
    });

    logger.info('Prize distribution reset', {
      prizeId: id,
      code: prize.code,
      name: prize.name
    });

    return updatedPrize;
  }

  async validatePrizeConfiguration() {
    const prizes = await prisma.resultType.findMany({
      where: { isActive: true }
    });

    const issues = [];

    // Check if there's at least one "No Prize" option
    const noPrizeOptions = prizes.filter(p => !p.isPrize);
    if (noPrizeOptions.length === 0) {
      issues.push('No "No Prize" option configured. At least one non-prize result type is required.');
    }

    // Check for prizes that are out of stock
    const outOfStockPrizes = prizes.filter(p => 
      p.isPrize && p.stockLimit && p.distributedCount >= p.stockLimit
    );

    if (outOfStockPrizes.length > 0) {
      issues.push(`Prizes out of stock: ${outOfStockPrizes.map(p => p.name).join(', ')}`);
    }

    // Check total weight
    const totalWeight = prizes.reduce((sum, p) => sum + p.weight, 0);
    if (totalWeight === 0) {
      issues.push('Total weight of all active prizes is 0. No results can be generated.');
    }

    return {
      isValid: issues.length === 0,
      issues,
      totalWeight,
      activePrizes: prizes.length,
      prizeOptions: prizes.filter(p => p.isPrize).length,
      noPrizeOptions: noPrizeOptions.length
    };
  }

  async exportPrizeData(includeWinners: boolean = false) {
    const prizes = await prisma.resultType.findMany({
      include: includeWinners ? {
        plays: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            resultCode: true,
            isRedeemed: true,
            redeemedAt: true,
            createdAt: true
          },
          orderBy: { createdAt: 'desc' }
        }
      } : undefined,
      orderBy: { name: 'asc' }
    });

    if (!includeWinners) {
      return prizes.map(prize => ({
        id: prize.id,
        name: prize.name,
        code: prize.code,
        description: prize.description,
        prizeValue: prize.prizeValue,
        weight: prize.weight,
        stockLimit: prize.stockLimit,
        distributedCount: prize.distributedCount,
        redeemedCount: prize.redeemedCount,
        isPrize: prize.isPrize,
        isActive: prize.isActive,
        createdAt: prize.createdAt,
        updatedAt: prize.updatedAt
      }));
    }

    // Flatten data to include winner details
    const flatData = [];
    for (const prize of prizes) {
      if ((prize as any).plays && (prize as any).plays.length > 0) {
        for (const play of (prize as any).plays) {
          flatData.push({
            prizeId: prize.id,
            prizeName: prize.name,
            prizeCode: prize.code,
            prizeDescription: prize.description,
            prizeValue: prize.prizeValue,
            playId: play.id,
            winnerName: `${play.firstName} ${play.lastName}`,
            winnerEmail: play.email,
            winnerPhone: play.phone,
            resultCode: play.resultCode,
            isRedeemed: play.isRedeemed,
            redeemedAt: play.redeemedAt,
            wonAt: play.createdAt
          });
        }
      } else {
        // Include prize even if no winners
        flatData.push({
          prizeId: prize.id,
          prizeName: prize.name,
          prizeCode: prize.code,
          prizeDescription: prize.description,
          prizeValue: prize.prizeValue,
          playId: null,
          winnerName: null,
          winnerEmail: null,
          winnerPhone: null,
          resultCode: null,
          isRedeemed: null,
          redeemedAt: null,
          wonAt: null
        });
      }
    }

    return flatData;
  }
}

export const prizeService = new PrizeService();
