import express, { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { dbHealthCheck } from '../utils/prisma';
import { emailService } from '../services/emailService';
import { getConfigurationStatus } from '../middleware/configValidation';
import { logger } from '../utils/logger';

const router = express.Router();

// Basic health check
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    // Basic server health
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      version: process.env.npm_package_version || '1.0.0',
      responseTime: Date.now() - startTime
    };

    res.json({
      success: true,
      data: health
    });
  } catch (error) {
    logger.error('Health check failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    res.status(503).json({
      success: false,
      error: {
        code: 'HEALTH_CHECK_FAILED',
        message: 'Health check failed'
      }
    });
  }
}));

// Detailed health check
router.get('/detailed', asyncHandler(async (req: Request, res: Response) => {
  const startTime = Date.now();
  const checks: any = {};
  let overallStatus = 'healthy';

  try {
    // Database health check
    try {
      const dbHealth = await dbHealthCheck();
      checks.database = {
        status: dbHealth.status,
        latency: dbHealth.latency,
        connected: dbHealth.connected
      };
      
      if (dbHealth.status !== 'healthy') {
        overallStatus = 'degraded';
      }
    } catch (error) {
      checks.database = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      overallStatus = 'unhealthy';
    }

    // Email service health check
    try {
      const emailHealth = emailService.getHealth();
      checks.email = {
        status: emailHealth.status,
        totalSent: emailHealth.totalSent,
        totalFailed: emailHealth.totalFailed,
        lastSuccessfulSend: emailHealth.lastSuccessfulSend,
        lastError: emailHealth.lastError
      };
      
      if (emailHealth.status === 'unhealthy') {
        overallStatus = 'degraded'; // Email is not critical for core functionality
      }
    } catch (error) {
      checks.email = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      // Email service failure doesn't make the whole system unhealthy
    }

    // Configuration health check
    try {
      const configStatus = getConfigurationStatus();
      checks.configuration = {
        status: configStatus.overall.isValid ? 'healthy' : 'unhealthy',
        errors: configStatus.overall.errors,
        warnings: configStatus.overall.warnings
      };
      
      if (!configStatus.overall.isValid) {
        overallStatus = 'unhealthy';
      }
    } catch (error) {
      checks.configuration = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      overallStatus = 'unhealthy';
    }

    // Memory usage
    const memUsage = process.memoryUsage();
    checks.memory = {
      status: 'healthy',
      usage: {
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        external: Math.round(memUsage.external / 1024 / 1024) // MB
      }
    };

    // Check if memory usage is too high (>500MB heap)
    if (memUsage.heapUsed > 500 * 1024 * 1024) {
      checks.memory.status = 'degraded';
      if (overallStatus === 'healthy') {
        overallStatus = 'degraded';
      }
    }

    const responseTime = Date.now() - startTime;
    
    const health = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      version: process.env.npm_package_version || '1.0.0',
      responseTime,
      checks
    };

    // Set appropriate status code
    const statusCode = overallStatus === 'healthy' ? 200 : 
                      overallStatus === 'degraded' ? 200 : 503;

    res.status(statusCode).json({
      success: overallStatus !== 'unhealthy',
      data: health
    });

  } catch (error) {
    logger.error('Detailed health check failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    res.status(503).json({
      success: false,
      error: {
        code: 'DETAILED_HEALTH_CHECK_FAILED',
        message: 'Detailed health check failed'
      }
    });
  }
}));

// Readiness probe (for Kubernetes/Docker)
router.get('/ready', asyncHandler(async (req: Request, res: Response) => {
  try {
    // Check if essential services are ready
    const dbHealth = await dbHealthCheck();
    const configStatus = getConfigurationStatus();
    
    const isReady = dbHealth.connected && configStatus.overall.isValid;
    
    if (isReady) {
      res.json({
        success: true,
        data: {
          status: 'ready',
          timestamp: new Date().toISOString()
        }
      });
    } else {
      res.status(503).json({
        success: false,
        error: {
          code: 'NOT_READY',
          message: 'Service not ready',
          details: {
            database: dbHealth.connected,
            configuration: configStatus.overall.isValid
          }
        }
      });
    }
  } catch (error) {
    logger.error('Readiness check failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    res.status(503).json({
      success: false,
      error: {
        code: 'READINESS_CHECK_FAILED',
        message: 'Readiness check failed'
      }
    });
  }
}));

// Liveness probe (for Kubernetes/Docker)
router.get('/live', asyncHandler(async (req: Request, res: Response) => {
  try {
    // Simple check to see if the process is alive and responsive
    res.json({
      success: true,
      data: {
        status: 'alive',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      }
    });
  } catch (error) {
    logger.error('Liveness check failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    res.status(503).json({
      success: false,
      error: {
        code: 'LIVENESS_CHECK_FAILED',
        message: 'Liveness check failed'
      }
    });
  }
}));

export default router;
