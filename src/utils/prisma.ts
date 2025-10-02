import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from './logger';
import { createError } from '../middleware/errorHandler';

// Create a singleton Prisma client with optimized configuration
class PrismaService {
  private static instance: PrismaClient;
  private static isConnected: boolean = false;
  private static connectionRetries: number = 0;
  private static readonly MAX_RETRIES = 3;

  public static getInstance(): PrismaClient {
    if (!PrismaService.instance) {
      PrismaService.instance = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DATABASE_URL,
          },
        },
      });

      // Setup event listeners
      PrismaService.setupEventListeners();
      
      // Test connection
      PrismaService.testConnection();

      // Graceful shutdown
      process.on('beforeExit', async () => {
        await PrismaService.disconnect();
      });

      process.on('SIGINT', async () => {
        await PrismaService.disconnect();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        await PrismaService.disconnect();
        process.exit(0);
      });
    }

    return PrismaService.instance;
  }

  private static setupEventListeners() {
    // Event listeners removed due to TypeScript compatibility issues
    // Logging is handled at the application level
  }

  private static async testConnection() {
    try {
      await PrismaService.instance.$connect();
      PrismaService.isConnected = true;
      PrismaService.connectionRetries = 0;
      logger.info('Database connection established successfully');
    } catch (error) {
      PrismaService.isConnected = false;
      PrismaService.connectionRetries++;
      logger.error('Failed to connect to database', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        retries: PrismaService.connectionRetries 
      });

      if (PrismaService.connectionRetries < PrismaService.MAX_RETRIES) {
        logger.info(`Retrying database connection in 5 seconds... (${PrismaService.connectionRetries}/${PrismaService.MAX_RETRIES})`);
        setTimeout(() => PrismaService.testConnection(), 5000);
      } else {
        logger.error('Max database connection retries exceeded. Application may not function properly.');
      }
    }
  }

  public static async disconnect() {
    if (PrismaService.instance) {
      try {
        await PrismaService.instance.$disconnect();
        PrismaService.isConnected = false;
        logger.info('Database connection closed');
      } catch (error) {
        logger.error('Error disconnecting from database', { 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }
  }

  public static isHealthy(): boolean {
    return PrismaService.isConnected;
  }

  // Helper method for transactions with optimized timeout and error handling
  public static async transaction<T>(
    fn: (prisma: any) => Promise<T>,
    options?: {
      timeout?: number;
      maxWait?: number;
      retries?: number;
    }
  ): Promise<T> {
    const prisma = PrismaService.getInstance();
    const retries = options?.retries || 1;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await prisma.$transaction(fn, {
          timeout: options?.timeout || 10000, // 10 seconds default
          maxWait: options?.maxWait || 5000,  // 5 seconds max wait
        });
      } catch (error) {
        logger.warn(`Transaction attempt ${attempt} failed`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          attempt,
          maxRetries: retries
        });

        if (attempt === retries) {
          // Handle specific transaction errors
          if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2028') {
              throw createError('Transaction timeout - operation took too long', 408, 'TRANSACTION_TIMEOUT');
            } else if (error.code === 'P2034') {
              throw createError('Transaction conflict - please try again', 409, 'TRANSACTION_CONFLICT');
            }
          }
          throw error;
        }

        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
      }
    }

    throw createError('Transaction failed after all retries', 500, 'TRANSACTION_FAILED');
  }

  // Safe query execution with error handling
  public static async safeQuery<T>(
    operation: () => Promise<T>,
    errorMessage: string = 'Database operation failed'
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      logger.error('Database query failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        operation: errorMessage
      });

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // Let the global error handler deal with specific Prisma errors
        throw error;
      }

      throw createError(errorMessage, 500, 'DATABASE_OPERATION_FAILED');
    }
  }

  // Health check method
  public static async healthCheck(): Promise<{ status: string; latency: number; connected: boolean }> {
    const startTime = Date.now();
    
    try {
      await PrismaService.instance.$queryRaw`SELECT 1`;
      const latency = Date.now() - startTime;
      
      return {
        status: 'healthy',
        latency,
        connected: true
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      
      logger.error('Database health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        latency
      });

      return {
        status: 'unhealthy',
        latency,
        connected: false
      };
    }
  }
}

export const prisma = PrismaService.getInstance();
export const prismaTransaction = PrismaService.transaction;
export const safeQuery = PrismaService.safeQuery;
export const dbHealthCheck = PrismaService.healthCheck;
export default PrismaService;
