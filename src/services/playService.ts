import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { emailService } from './emailService';

const prisma = new PrismaClient();

export interface PlayClaimRequest {
  token: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string; // Required for notifications
  age: number;
  acceptTerms: boolean;
  ip?: string;
  userAgent?: string;
}

export interface PlayResult {
  playId: string;
  result: {
    prizeType: string;
    prizeValue?: string;
    description?: string;
    isWinner: boolean;
    resultCode: string;
  };
  emailSent: boolean;
}

export class PlayService {
  async claimTokenAndPlay(request: PlayClaimRequest): Promise<PlayResult> {
    const { token, ip, userAgent, acceptTerms, ...playerData } = request;

    return await prisma.$transaction(async (tx: any) => {
      // Find and lock the token for update
      const tokenRecord = await tx.token.findUnique({
        where: { code: token },
        include: { play: true }
      });

      if (!tokenRecord) {
        throw createError('Invalid token.', 400);
      }

      if (tokenRecord.isUsed) {
        throw createError('Token has already been used.', 400);
      }

      if (tokenRecord.play) {
        throw createError('Token has already been used.', 400);
      }

      // Check if token is expired
      if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
        throw createError('Token has expired.', 400);
      }

      // Determine the result
      const result = await this.determineResult(tx);

      // Generate unique result code
      const resultCode = this.generateResultCode();

      // Create the play record
      const play = await tx.play.create({
        data: {
          ...playerData,
          tokenId: tokenRecord.id,
          resultTypeId: result.resultTypeId,
          resultCode,
          ip,
          userAgent
        },
        include: {
          resultType: true
        }
      });

      // Mark token as used
      await tx.token.update({
        where: { id: tokenRecord.id },
        data: {
          isUsed: true,
          usedAt: new Date()
        }
      });

      // Update result type distributed count if it's a winner
      if (result.isWinner) {
        await tx.resultType.update({
          where: { id: result.resultTypeId },
          data: {
            distributedCount: {
              increment: 1
            }
          }
        });
      }

      // Send email notification
      let emailSent = false;
      try {
        await emailService.sendResultEmail({
          to: playerData.email,
          firstName: playerData.firstName,
          resultCode,
          prizeType: result.prizeType,
          prizeValue: result.prizeValue,
          description: result.description,
          isWinner: result.isWinner
        });
        
        // Update play record to mark email as sent
        await tx.play.update({
          where: { id: play.id },
          data: {
            emailSent: true,
            emailSentAt: new Date()
          }
        });
        
        emailSent = true;
      } catch (error) {
        logger.error('Failed to send result email', { error, playId: play.id });
      }

      logger.info('Play created successfully', {
        playId: play.id,
        tokenId: tokenRecord.id,
        resultType: result.prizeType,
        isWinner: result.isWinner
      });

      return {
        playId: play.id,
        result: {
          prizeType: result.prizeType,
          prizeValue: result.prizeValue,
          description: result.description,
          isWinner: result.isWinner,
          resultCode
        },
        emailSent
      };
    });
  }

  private async determineResult(tx: any): Promise<{
    resultTypeId: string;
    prizeType: string;
    prizeValue?: string;
    description?: string;
    isWinner: boolean;
  }> {
    // Get all active result types
    const resultTypes = await tx.resultType.findMany({
      where: { isActive: true },
      orderBy: { weight: 'desc' }
    });

    if (resultTypes.length === 0) {
      throw createError('No result types configured.', 500);
    }

    // Calculate total weight
    const totalWeight = resultTypes.reduce((sum: number, rt: any) => sum + rt.weight, 0);

    // Generate random number
    const random = Math.random() * totalWeight;

    // Find the selected result type
    let currentWeight = 0;
    let selectedResultType = resultTypes[0];

    for (const resultType of resultTypes) {
      currentWeight += resultType.weight;
      if (random <= currentWeight) {
        selectedResultType = resultType;
        break;
      }
    }

    // Check stock limit and if it's actually a prize
    const hasStock = selectedResultType.stockLimit === null || 
                    selectedResultType.distributedCount < selectedResultType.stockLimit;
    const isWinner = selectedResultType.isPrize && hasStock;

    // If selected result is out of stock, fall back to "No Prize" result
    let finalResultType = selectedResultType;
    if (selectedResultType.isPrize && !hasStock) {
      const noPrizeResult = resultTypes.find(rt => !rt.isPrize);
      if (noPrizeResult) {
        finalResultType = noPrizeResult;
      }
    }

    return {
      resultTypeId: finalResultType.id,
      prizeType: finalResultType.name,
      prizeValue: finalResultType.prizeValue,
      description: finalResultType.description,
      isWinner: finalResultType.isPrize && hasStock
    };
  }

  private generateResultCode(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${random}`.toUpperCase();
  }

  async getPlayStatus(playId: string) {
    const play = await prisma.play.findUnique({
      where: { id: playId },
      include: {
        resultType: true,
        token: true
      }
    });

    if (!play) {
      throw createError('Play not found.', 404);
    }

    return {
      id: play.id,
      firstName: play.firstName,
      lastName: play.lastName,
      phone: play.phone,
      email: play.email,
      resultCode: play.resultCode,
      prizeType: play.resultType.name,
      isWinner: play.resultType.stockLimit === null || 
                play.resultType.distributedCount < play.resultType.stockLimit,
      isRedeemed: play.isRedeemed,
      redeemedAt: play.redeemedAt,
      createdAt: play.createdAt
    };
  }

  async searchPlay(query: string) {
    const plays = await prisma.play.findMany({
      where: {
        OR: [
          { resultCode: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } }
        ]
      },
      include: {
        resultType: true
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    return plays.map((play: any) => ({
      id: play.id,
      firstName: play.firstName,
      lastName: play.lastName,
      phone: play.phone,
      email: play.email,
      resultCode: play.resultCode,
      prizeType: play.resultType.name,
      isWinner: play.resultType.stockLimit === null || 
                play.resultType.distributedCount < play.resultType.stockLimit,
      isRedeemed: play.isRedeemed,
      redeemedAt: play.redeemedAt,
      createdAt: play.createdAt
    }));
  }

  async redeemPlay(playId: string, redeemedBy: string, notes?: string) {
    return await prisma.$transaction(async (tx: any) => {
      const play = await tx.play.findUnique({
        where: { id: playId },
        include: { resultType: true }
      });

      if (!play) {
        throw createError('Play not found.', 404);
      }

      if (play.isRedeemed) {
        throw createError('Play has already been redeemed.', 400);
      }

      const updatedPlay = await tx.play.update({
        where: { id: playId },
        data: {
          isRedeemed: true,
          redeemedAt: new Date()
        }
      });

      // Log the redemption
      await tx.audit.create({
        data: {
          actorId: 'system', // This would be the staff member's ID in a real implementation
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

      logger.info('Play redeemed successfully', {
        playId,
        resultCode: play.resultCode,
        redeemedBy
      });

      return updatedPlay;
    });
  }
}

export const playService = new PlayService();

