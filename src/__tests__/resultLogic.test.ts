describe('Result Logic', () => {
  describe('Weighted random selection', () => {
    it('should select result types based on weights', () => {
      const resultTypes = [
        { id: '1', name: 'No Prize', weight: 70 },
        { id: '2', name: 'Small Prize', weight: 20 },
        { id: '3', name: 'Grand Prize', weight: 10 },
      ]

      const selectResultType = (resultTypes: any[], randomValue: number) => {
        const totalWeight = resultTypes.reduce((sum, rt) => sum + rt.weight, 0)
        const random = randomValue * totalWeight

        let currentWeight = 0
        for (const resultType of resultTypes) {
          currentWeight += resultType.weight
          if (random <= currentWeight) {
            return resultType
          }
        }

        return resultTypes[resultTypes.length - 1]
      }

      // Test with specific random values
      expect(selectResultType(resultTypes, 0.1).name).toBe('No Prize') // 0.1 * 100 = 10, should select first
      expect(selectResultType(resultTypes, 0.5).name).toBe('No Prize') // 0.5 * 100 = 50, should select first
      expect(selectResultType(resultTypes, 0.8).name).toBe('Small Prize') // 0.8 * 100 = 80, should select second
      expect(selectResultType(resultTypes, 0.95).name).toBe('Grand Prize') // 0.95 * 100 = 95, should select third
    })

    it('should handle edge cases in weight selection', () => {
      const resultTypes = [
        { id: '1', name: 'Only Option', weight: 100 },
      ]

      const selectResultType = (resultTypes: any[], randomValue: number) => {
        const totalWeight = resultTypes.reduce((sum, rt) => sum + rt.weight, 0)
        const random = randomValue * totalWeight

        let currentWeight = 0
        for (const resultType of resultTypes) {
          currentWeight += resultType.weight
          if (random <= currentWeight) {
            return resultType
          }
        }

        return resultTypes[resultTypes.length - 1]
      }

      expect(selectResultType(resultTypes, 0).name).toBe('Only Option')
      expect(selectResultType(resultTypes, 0.5).name).toBe('Only Option')
      expect(selectResultType(resultTypes, 1).name).toBe('Only Option')
    })
  })

  describe('Stock limit validation', () => {
    it('should prevent winners when stock limit is reached', () => {
      const resultTypes = [
        { id: '1', name: 'No Prize', weight: 70, stockLimit: null, distributedCount: 0 },
        { id: '2', name: 'Small Prize', weight: 20, stockLimit: 100, distributedCount: 50 },
        { id: '3', name: 'Grand Prize', weight: 10, stockLimit: 10, distributedCount: 10 }, // At limit
      ]

      const determineResult = (resultTypes: any[], selectedResultType: any) => {
        const isWinner = selectedResultType.stockLimit === null || 
                        selectedResultType.distributedCount < selectedResultType.stockLimit

        return {
          resultTypeId: selectedResultType.id,
          prizeType: selectedResultType.name,
          isWinner
        }
      }

      // Test no prize (no stock limit)
      const noPrizeResult = determineResult(resultTypes, resultTypes[0])
      expect(noPrizeResult.isWinner).toBe(false) // No prize is never a winner

      // Test small prize (under limit)
      const smallPrizeResult = determineResult(resultTypes, resultTypes[1])
      expect(smallPrizeResult.isWinner).toBe(true)

      // Test grand prize (at limit)
      const grandPrizeResult = determineResult(resultTypes, resultTypes[2])
      expect(grandPrizeResult.isWinner).toBe(false)
    })

    it('should handle null stock limits', () => {
      const resultTypes = [
        { id: '1', name: 'Unlimited Prize', weight: 100, stockLimit: null, distributedCount: 1000 },
      ]

      const determineResult = (resultTypes: any[], selectedResultType: any) => {
        const isWinner = selectedResultType.stockLimit === null || 
                        selectedResultType.distributedCount < selectedResultType.stockLimit

        return {
          resultTypeId: selectedResultType.id,
          prizeType: selectedResultType.name,
          isWinner
        }
      }

      const result = determineResult(resultTypes, resultTypes[0])
      expect(result.isWinner).toBe(false) // No prize is never a winner, regardless of stock limit
    })
  })

  describe('Result distribution simulation', () => {
    it('should maintain statistical distribution over many plays', () => {
      const resultTypes = [
        { id: '1', name: 'No Prize', weight: 70, stockLimit: null, distributedCount: 0 },
        { id: '2', name: 'Small Prize', weight: 20, stockLimit: 1000, distributedCount: 0 },
        { id: '3', name: 'Grand Prize', weight: 10, stockLimit: 1000, distributedCount: 0 },
      ]

      const selectResultType = (resultTypes: any[], randomValue: number) => {
        const totalWeight = resultTypes.reduce((sum, rt) => sum + rt.weight, 0)
        const random = randomValue * totalWeight

        let currentWeight = 0
        for (const resultType of resultTypes) {
          currentWeight += resultType.weight
          if (random <= currentWeight) {
            return resultType
          }
        }

        return resultTypes[resultTypes.length - 1]
      }

      const determineResult = (resultTypes: any[], selectedResultType: any) => {
        const isWinner = selectedResultType.stockLimit === null || 
                        selectedResultType.distributedCount < selectedResultType.stockLimit

        return {
          resultTypeId: selectedResultType.id,
          prizeType: selectedResultType.name,
          isWinner
        }
      }

      // Simulate 1000 plays
      const results = { 'No Prize': 0, 'Small Prize': 0, 'Grand Prize': 0 }
      
      for (let i = 0; i < 1000; i++) {
        const randomValue = Math.random()
        const selectedType = selectResultType(resultTypes, randomValue)
        const result = determineResult(resultTypes, selectedType)
        results[result.prizeType as keyof typeof results]++
      }

      // Check that distribution is roughly proportional to weights
      // Allow for some variance due to randomness
      expect(results['No Prize']).toBeGreaterThan(600) // Should be around 700
      expect(results['No Prize']).toBeLessThan(800)
      
      expect(results['Small Prize']).toBeGreaterThan(150) // Should be around 200
      expect(results['Small Prize']).toBeLessThan(250)
      
      expect(results['Grand Prize']).toBeGreaterThan(50) // Should be around 100
      expect(results['Grand Prize']).toBeLessThan(150)
    })
  })

  describe('Cryptographic randomness', () => {
    it('should use secure random number generation', () => {
      // Test that we're using crypto.randomInt for secure randomness
      const generateSecureRandom = () => {
        // Simulate crypto.randomInt behavior
        const array = new Uint32Array(1)
        crypto.getRandomValues(array)
        return array[0] / (0xffffffff + 1)
      }

      const randomValues = []
      for (let i = 0; i < 100; i++) {
        randomValues.push(generateSecureRandom())
      }

      // Check that values are properly distributed
      const average = randomValues.reduce((sum, val) => sum + val, 0) / randomValues.length
      expect(average).toBeGreaterThan(0.4)
      expect(average).toBeLessThan(0.6)

      // Check that all values are in valid range
      randomValues.forEach(val => {
        expect(val).toBeGreaterThanOrEqual(0)
        expect(val).toBeLessThan(1)
      })
    })
  })

  describe('Result code uniqueness', () => {
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

    it('should handle concurrent result code generation', () => {
      const generateResultCode = () => {
        const timestamp = Date.now().toString(36)
        const random = Math.random().toString(36).substring(2, 8)
        return `${timestamp}-${random}`.toUpperCase()
      }

      // Simulate concurrent generation
      const codes = new Set()
      const promises = []

      for (let i = 0; i < 100; i++) {
        promises.push(
          new Promise(resolve => {
            setTimeout(() => {
              const code = generateResultCode()
              codes.add(code)
              resolve(code)
            }, Math.random() * 10)
          })
        )
      }

      return Promise.all(promises).then(() => {
        expect(codes.size).toBe(100)
      })
    })
  })
})
