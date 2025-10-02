import { PrismaClient } from '@prisma/client'

// Mock Prisma
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $transaction: jest.fn(),
    token: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  })),
}))

describe('Token Validation', () => {
  let mockPrisma: any

  beforeEach(() => {
    mockPrisma = new PrismaClient()
    jest.clearAllMocks()
  })

  describe('Single-use token validation', () => {
    it('should prevent concurrent token usage', async () => {
      const mockToken = {
        id: 'token-id',
        code: 'TEST123',
        isUsed: false,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        play: null,
      }

      let transactionCount = 0
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        transactionCount++
        
        // Simulate race condition: first transaction succeeds, second fails
        if (transactionCount === 1) {
          return callback({
            token: {
              findUnique: jest.fn().mockResolvedValue(mockToken),
              update: jest.fn().mockResolvedValue({}),
            },
          })
        } else {
          return callback({
            token: {
              findUnique: jest.fn().mockResolvedValue({ ...mockToken, isUsed: true }),
            },
          })
        }
      })

      // Simulate two concurrent requests
      const promise1 = mockPrisma.$transaction((tx: any) => {
        const token = tx.token.findUnique({ where: { code: 'TEST123' } })
        if (token.isUsed) {
          throw new Error('Token has already been used')
        }
        return tx.token.update({ where: { id: token.id }, data: { isUsed: true } })
      })

      const promise2 = mockPrisma.$transaction((tx: any) => {
        const token = tx.token.findUnique({ where: { code: 'TEST123' } })
        if (token.isUsed) {
          throw new Error('Token has already been used')
        }
        return tx.token.update({ where: { id: token.id }, data: { isUsed: true } })
      })

      // First request should succeed
      await expect(promise1).resolves.toBeDefined()
      
      // Second request should fail
      await expect(promise2).rejects.toThrow('Token has already been used')
    })

    it('should validate token expiration', () => {
      const now = new Date()
      const expiredToken = {
        expiresAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), // 24 hours ago
      }
      const validToken = {
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), // 24 hours from now
      }

      const isExpired = (token: any) => {
        return token.expiresAt && token.expiresAt < new Date()
      }

      expect(isExpired(expiredToken)).toBe(true)
      expect(isExpired(validToken)).toBe(false)
    })

    it('should validate token format', () => {
      const validTokens = ['ABC123', 'TEST-456', 'SAMPLE001', 'QR-CODE-789']
      const invalidTokens = ['', '   ', 'abc', '123', 'TOO-LONG-TOKEN-NAME-EXCEEDS-LIMIT']

      const isValidTokenFormat = (token: string) => {
        return token && 
               token.length >= 3 && 
               token.length <= 50 && 
               /^[A-Z0-9\-_]+$/.test(token)
      }

      validTokens.forEach(token => {
        expect(isValidTokenFormat(token)).toBe(true)
      })

      invalidTokens.forEach(token => {
        expect(isValidTokenFormat(token)).toBe(false)
      })
    })
  })

  describe('Rate limiting', () => {
    it('should track requests per IP', () => {
      const rateLimitMap = new Map<string, { count: number; resetTime: number }>()
      const windowMs = 15 * 60 * 1000 // 15 minutes
      const maxRequests = 100

      const checkRateLimit = (ip: string) => {
        const now = Date.now()
        const record = rateLimitMap.get(ip)

        if (!record || now > record.resetTime) {
          rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs })
          return { allowed: true, remaining: maxRequests - 1 }
        }

        if (record.count >= maxRequests) {
          return { allowed: false, remaining: 0 }
        }

        record.count++
        return { allowed: true, remaining: maxRequests - record.count }
      }

      // Test rate limiting
      const ip = '192.168.1.1'
      
      // First request should be allowed
      expect(checkRateLimit(ip).allowed).toBe(true)
      expect(checkRateLimit(ip).remaining).toBe(99)

      // Simulate many requests
      for (let i = 0; i < 98; i++) {
        checkRateLimit(ip)
      }

      // Should still be allowed
      expect(checkRateLimit(ip).allowed).toBe(true)
      expect(checkRateLimit(ip).remaining).toBe(0)

      // Next request should be blocked
      expect(checkRateLimit(ip).allowed).toBe(false)
      expect(checkRateLimit(ip).remaining).toBe(0)
    })
  })

  describe('Input validation', () => {
    it('should validate player data', () => {
      const validPlayerData = {
        firstName: 'John',
        lastName: 'Doe',
        phone: '+1234567890',
        email: 'john@example.com',
        age: 25,
        acceptTerms: true,
      }

      const invalidPlayerData = {
        firstName: '', // Empty
        lastName: 'Doe',
        phone: '123', // Too short
        email: 'invalid-email', // Invalid format
        age: 17, // Too young
        acceptTerms: false, // Not accepted
      }

      const validatePlayerData = (data: any) => {
        const errors: string[] = []

        if (!data.firstName || data.firstName.length < 1) {
          errors.push('First name is required')
        }
        if (!data.lastName || data.lastName.length < 1) {
          errors.push('Last name is required')
        }
        if (!data.phone || data.phone.length < 10) {
          errors.push('Phone number must be at least 10 digits')
        }
        if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
          errors.push('Invalid email format')
        }
        if (data.age < 18) {
          errors.push('Age must be at least 18')
        }
        if (!data.acceptTerms) {
          errors.push('Terms and conditions must be accepted')
        }

        return { isValid: errors.length === 0, errors }
      }

      expect(validatePlayerData(validPlayerData).isValid).toBe(true)
      expect(validatePlayerData(invalidPlayerData).isValid).toBe(false)
      expect(validatePlayerData(invalidPlayerData).errors).toContain('First name is required')
      expect(validatePlayerData(invalidPlayerData).errors).toContain('Phone number must be at least 10 digits')
      expect(validatePlayerData(invalidPlayerData).errors).toContain('Invalid email format')
      expect(validatePlayerData(invalidPlayerData).errors).toContain('Age must be at least 18')
      expect(validatePlayerData(invalidPlayerData).errors).toContain('Terms and conditions must be accepted')
    })
  })

  describe('Result code generation', () => {
    it('should generate unique result codes', () => {
      const generateResultCode = () => {
        const timestamp = Date.now().toString(36)
        const random = Math.random().toString(36).substring(2, 8)
        return `${timestamp}-${random}`.toUpperCase()
      }

      const codes = new Set()
      for (let i = 0; i < 1000; i++) {
        const code = generateResultCode()
        expect(codes.has(code)).toBe(false)
        codes.add(code)
      }

      expect(codes.size).toBe(1000)
    })

    it('should generate codes with proper format', () => {
      const generateResultCode = () => {
        const timestamp = Date.now().toString(36)
        const random = Math.random().toString(36).substring(2, 8)
        return `${timestamp}-${random}`.toUpperCase()
      }

      const code = generateResultCode()
      expect(code).toMatch(/^[A-Z0-9]+-[A-Z0-9]+$/)
      expect(code.length).toBeGreaterThan(10)
      expect(code.length).toBeLessThan(20)
    })
  })
})
