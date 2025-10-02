import { PrismaClient } from '@prisma/client'
import { playService } from '../services/playService'
import { createError } from '../middleware/errorHandler'

// Mock Prisma
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $transaction: jest.fn(),
    token: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    play: {
      create: jest.fn(),
    },
    resultType: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  })),
}))

// Mock email service
jest.mock('../services/emailService', () => ({
  emailService: {
    sendResultEmail: jest.fn().mockResolvedValue(undefined),
  },
}))

describe('PlayService', () => {
  let mockPrisma: any

  beforeEach(() => {
    mockPrisma = new PrismaClient()
    jest.clearAllMocks()
  })

  describe('claimTokenAndPlay', () => {
    const mockRequest = {
      token: 'TEST123',
      firstName: 'John',
      lastName: 'Doe',
      phone: '+1234567890',
      email: 'john@example.com',
      age: 25,
      acceptTerms: true,
      ip: '127.0.0.1',
      userAgent: 'test-agent',
    }

    const mockToken = {
      id: 'token-id',
      code: 'TEST123',
      isUsed: false,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
      play: null,
    }

    const mockResultTypes = [
      {
        id: 'result-1',
        name: 'No Prize',
        code: 'NO_PRIZE',
        weight: 70,
        stockLimit: null,
        distributedCount: 0,
        isActive: true,
      },
      {
        id: 'result-2',
        name: 'Small Prize',
        code: 'SMALL_PRIZE',
        weight: 20,
        stockLimit: 100,
        distributedCount: 50,
        isActive: true,
      },
      {
        id: 'result-3',
        name: 'Grand Prize',
        code: 'GRAND_PRIZE',
        weight: 10,
        stockLimit: 10,
        distributedCount: 10, // At limit
        isActive: true,
      },
    ]

    it('should successfully claim token and create play', async () => {
      const mockPlay = {
        id: 'play-id',
        resultCode: 'RESULT123',
        resultType: { name: 'Small Prize' },
      }

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback({
          token: {
            findUnique: jest.fn().mockResolvedValue(mockToken),
            update: jest.fn().mockResolvedValue({}),
          },
          play: {
            create: jest.fn().mockResolvedValue(mockPlay),
          },
          resultType: {
            findMany: jest.fn().mockResolvedValue(mockResultTypes),
            update: jest.fn().mockResolvedValue({}),
          },
        })
      })

      const result = await playService.claimTokenAndPlay(mockRequest)

      expect(result).toHaveProperty('playId')
      expect(result).toHaveProperty('result')
      expect(result.result).toHaveProperty('prizeType')
      expect(result.result).toHaveProperty('isWinner')
      expect(result.result).toHaveProperty('resultCode')
      expect(result).toHaveProperty('sendEmail')
    })

    it('should throw error for invalid token', async () => {
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback({
          token: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        })
      })

      await expect(playService.claimTokenAndPlay(mockRequest)).rejects.toThrow('Invalid token')
    })

    it('should throw error for already used token', async () => {
      const usedToken = { ...mockToken, isUsed: true }

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback({
          token: {
            findUnique: jest.fn().mockResolvedValue(usedToken),
          },
        })
      })

      await expect(playService.claimTokenAndPlay(mockRequest)).rejects.toThrow('Token has already been used')
    })

    it('should throw error for expired token', async () => {
      const expiredToken = {
        ...mockToken,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
      }

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback({
          token: {
            findUnique: jest.fn().mockResolvedValue(expiredToken),
          },
        })
      })

      await expect(playService.claimTokenAndPlay(mockRequest)).rejects.toThrow('Token has expired')
    })

    it('should throw error when no result types configured', async () => {
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback({
          token: {
            findUnique: jest.fn().mockResolvedValue(mockToken),
          },
          resultType: {
            findMany: jest.fn().mockResolvedValue([]),
          },
        })
      })

      await expect(playService.claimTokenAndPlay(mockRequest)).rejects.toThrow('No result types configured')
    })

    it('should not allow winner when stock limit is reached', async () => {
      const mockPlay = {
        id: 'play-id',
        resultCode: 'RESULT123',
        resultType: { name: 'Grand Prize' },
      }

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback({
          token: {
            findUnique: jest.fn().mockResolvedValue(mockToken),
            update: jest.fn().mockResolvedValue({}),
          },
          play: {
            create: jest.fn().mockResolvedValue(mockPlay),
          },
          resultType: {
            findMany: jest.fn().mockResolvedValue(mockResultTypes),
            update: jest.fn().mockResolvedValue({}),
          },
        })
      })

      // Mock Math.random to always return a value that would select the grand prize
      const originalRandom = Math.random
      Math.random = jest.fn(() => 0.95) // This should select the grand prize

      const result = await playService.claimTokenAndPlay(mockRequest)

      // Since grand prize is at stock limit, isWinner should be false
      expect(result.result.isWinner).toBe(false)

      // Restore original Math.random
      Math.random = originalRandom
    })
  })

  describe('getPlayStatus', () => {
    it('should return play status for valid play ID', async () => {
      const mockPlay = {
        id: 'play-id',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+1234567890',
        email: 'john@example.com',
        resultCode: 'RESULT123',
        resultType: {
          name: 'Small Prize',
          stockLimit: 100,
          distributedCount: 50,
        },
        isRedeemed: false,
        redeemedAt: null,
        createdAt: new Date(),
      }

      mockPrisma.play.findUnique.mockResolvedValue(mockPlay)

      const result = await playService.getPlayStatus('play-id')

      expect(result).toHaveProperty('id', 'play-id')
      expect(result).toHaveProperty('firstName', 'John')
      expect(result).toHaveProperty('resultCode', 'RESULT123')
      expect(result).toHaveProperty('isWinner', true) // distributedCount < stockLimit
    })

    it('should throw error for non-existent play', async () => {
      mockPrisma.play.findUnique.mockResolvedValue(null)

      await expect(playService.getPlayStatus('non-existent')).rejects.toThrow('Play not found')
    })
  })

  describe('searchPlay', () => {
    it('should return search results for valid query', async () => {
      const mockPlays = [
        {
          id: 'play-1',
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1234567890',
          email: 'john@example.com',
          resultCode: 'RESULT123',
          resultType: { name: 'Small Prize', stockLimit: 100, distributedCount: 50 },
          isRedeemed: false,
          redeemedAt: null,
          createdAt: new Date(),
        },
      ]

      mockPrisma.play.findMany.mockResolvedValue(mockPlays)

      const result = await playService.searchPlay('RESULT123')

      expect(result).toHaveLength(1)
      expect(result[0]).toHaveProperty('resultCode', 'RESULT123')
    })
  })

  describe('redeemPlay', () => {
    it('should successfully redeem play', async () => {
      const mockPlay = {
        id: 'play-id',
        resultCode: 'RESULT123',
        resultType: { name: 'Small Prize' },
        isRedeemed: false,
      }

      const mockUpdatedPlay = {
        ...mockPlay,
        isRedeemed: true,
        redeemedAt: new Date(),
      }

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback({
          play: {
            findUnique: jest.fn().mockResolvedValue(mockPlay),
            update: jest.fn().mockResolvedValue(mockUpdatedPlay),
          },
          audit: {
            create: jest.fn().mockResolvedValue({}),
          },
        })
      })

      const result = await playService.redeemPlay('play-id', 'Staff Member', 'Test redemption')

      expect(result).toHaveProperty('isRedeemed', true)
    })

    it('should throw error for non-existent play', async () => {
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback({
          play: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        })
      })

      await expect(playService.redeemPlay('non-existent', 'Staff Member')).rejects.toThrow('Play not found')
    })

    it('should throw error for already redeemed play', async () => {
      const mockPlay = {
        id: 'play-id',
        resultCode: 'RESULT123',
        resultType: { name: 'Small Prize' },
        isRedeemed: true,
      }

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback({
          play: {
            findUnique: jest.fn().mockResolvedValue(mockPlay),
          },
        })
      })

      await expect(playService.redeemPlay('play-id', 'Staff Member')).rejects.toThrow('Play has already been redeemed')
    })
  })
})
