import { Request, Response, NextFunction } from 'express';
import { createError } from './errorHandler';
import { logger } from '../utils/logger';

interface ConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// Required environment variables
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'NODE_ENV'
];

// Optional but recommended environment variables
const RECOMMENDED_ENV_VARS = [
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
  'FROM_EMAIL',
  'FROM_NAME',
  'CORS_ORIGIN',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX_REQUESTS'
];

interface ValidationRule {
  required: boolean;
  pattern?: RegExp;
  minLength?: number;
  allowedValues?: string[];
  message: string;
}

// Environment variable validation rules
const ENV_VALIDATION_RULES: Record<string, ValidationRule> = {
  DATABASE_URL: {
    required: true,
    pattern: /^postgresql:\/\/.+/,
    message: 'DATABASE_URL must be a valid PostgreSQL connection string'
  },
  JWT_SECRET: {
    required: true,
    minLength: 32,
    message: 'JWT_SECRET must be at least 32 characters long'
  },
  NODE_ENV: {
    required: true,
    allowedValues: ['development', 'production', 'test'],
    message: 'NODE_ENV must be one of: development, production, test'
  },
  PORT: {
    required: false,
    pattern: /^\d+$/,
    message: 'PORT must be a valid number'
  },
  SMTP_PORT: {
    required: false,
    pattern: /^\d+$/,
    message: 'SMTP_PORT must be a valid number'
  },
  MIN_AGE: {
    required: false,
    pattern: /^\d+$/,
    message: 'MIN_AGE must be a valid number'
  },
  MAX_FILE_SIZE: {
    required: false,
    pattern: /^\d+$/,
    message: 'MAX_FILE_SIZE must be a valid number (bytes)'
  },
  RATE_LIMIT_WINDOW_MS: {
    required: false,
    pattern: /^\d+$/,
    message: 'RATE_LIMIT_WINDOW_MS must be a valid number'
  },
  RATE_LIMIT_MAX_REQUESTS: {
    required: false,
    pattern: /^\d+$/,
    message: 'RATE_LIMIT_MAX_REQUESTS must be a valid number'
  }
};

// Validate environment configuration
export function validateEnvironmentConfig(): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required environment variables
  for (const envVar of REQUIRED_ENV_VARS) {
    if (!process.env[envVar]) {
      errors.push(`Missing required environment variable: ${envVar}`);
    }
  }

  // Check recommended environment variables
  for (const envVar of RECOMMENDED_ENV_VARS) {
    if (!process.env[envVar]) {
      warnings.push(`Missing recommended environment variable: ${envVar}`);
    }
  }

  // Validate environment variable formats
  for (const [envVar, rules] of Object.entries(ENV_VALIDATION_RULES)) {
    const value = process.env[envVar];
    
    if (!value) {
      if (rules.required) {
        errors.push(`Missing required environment variable: ${envVar}`);
      }
      continue;
    }

    // Check pattern
    if (rules.pattern && !rules.pattern.test(value)) {
      errors.push(rules.message);
    }

    // Check minimum length
    if (rules.minLength && value.length < rules.minLength) {
      errors.push(rules.message);
    }

    // Check allowed values
    if (rules.allowedValues && !rules.allowedValues.includes(value)) {
      errors.push(rules.message);
    }
  }

  // Additional security checks
  if (process.env.NODE_ENV === 'production') {
    if (process.env.JWT_SECRET === 'your-super-secret-jwt-key-change-this-in-production') {
      errors.push('JWT_SECRET is using default value in production - this is a security risk');
    }

    if (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === '*') {
      warnings.push('CORS_ORIGIN should be set to specific domain(s) in production');
    }

    if (!process.env.SMTP_HOST) {
      warnings.push('Email service not configured - users will not receive notifications');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

// Middleware to validate configuration on startup
export const validateConfig = (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = validateEnvironmentConfig();
    
    if (!validation.isValid) {
      logger.error('Configuration validation failed', {
        errors: validation.errors,
        warnings: validation.warnings
      });
      
      return next(createError(
        `Configuration errors: ${validation.errors.join(', ')}`,
        500,
        'CONFIGURATION_ERROR'
      ));
    }

    if (validation.warnings.length > 0) {
      logger.warn('Configuration warnings', {
        warnings: validation.warnings
      });
    }

    next();
  } catch (error) {
    logger.error('Configuration validation error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    next(createError(
      'Failed to validate configuration',
      500,
      'CONFIGURATION_VALIDATION_ERROR'
    ));
  }
};

// Check database configuration
export async function validateDatabaseConfig(): Promise<ConfigValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const databaseUrl = process.env.DATABASE_URL;
    
    if (!databaseUrl) {
      errors.push('DATABASE_URL not configured');
      return { isValid: false, errors, warnings };
    }

    // Parse database URL
    const url = new URL(databaseUrl);
    
    if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
      errors.push('DATABASE_URL must use postgresql:// protocol');
    }

    if (!url.hostname) {
      errors.push('DATABASE_URL missing hostname');
    }

    if (!url.pathname || url.pathname === '/') {
      errors.push('DATABASE_URL missing database name');
    }

    if (!url.username) {
      warnings.push('DATABASE_URL missing username');
    }

    if (!url.password) {
      warnings.push('DATABASE_URL missing password');
    }

    // Check for SSL in production
    if (process.env.NODE_ENV === 'production') {
      const searchParams = new URLSearchParams(url.search);
      if (!searchParams.has('sslmode') && !searchParams.has('ssl')) {
        warnings.push('SSL not configured for database connection in production');
      }
    }

  } catch (error) {
    errors.push(`Invalid DATABASE_URL format: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

// Check email configuration
export function validateEmailConfig(): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const requiredEmailVars = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
  const missingVars = requiredEmailVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    if (process.env.NODE_ENV === 'production') {
      errors.push(`Missing required email configuration: ${missingVars.join(', ')}`);
    } else {
      warnings.push(`Email service not configured: missing ${missingVars.join(', ')}`);
    }
  }

  // Validate SMTP port
  const smtpPort = process.env.SMTP_PORT;
  if (smtpPort && !/^\d+$/.test(smtpPort)) {
    errors.push('SMTP_PORT must be a valid number');
  }

  // Validate email addresses
  const fromEmail = process.env.FROM_EMAIL;
  if (fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
    errors.push('FROM_EMAIL must be a valid email address');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

// Get configuration status
export function getConfigurationStatus() {
  const envValidation = validateEnvironmentConfig();
  const emailValidation = validateEmailConfig();
  
  return {
    environment: envValidation,
    email: emailValidation,
    overall: {
      isValid: envValidation.isValid && emailValidation.isValid,
      errors: [...envValidation.errors, ...emailValidation.errors],
      warnings: [...envValidation.warnings, ...emailValidation.warnings]
    }
  };
}

// Startup configuration check
export function performStartupConfigCheck() {
  logger.info('Performing startup configuration check...');
  
  const status = getConfigurationStatus();
  
  if (!status.overall.isValid) {
    logger.error('Configuration validation failed', status.overall);
    throw new Error(`Configuration errors: ${status.overall.errors.join(', ')}`);
  }

  if (status.overall.warnings.length > 0) {
    logger.warn('Configuration warnings detected', status.overall.warnings);
  }

  logger.info('Configuration validation passed', {
    environment: process.env.NODE_ENV,
    warningCount: status.overall.warnings.length
  });
}

// Middleware for health check endpoint
export const configHealthCheck = (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = getConfigurationStatus();
    
    res.json({
      success: true,
      data: {
        configuration: {
          status: status.overall.isValid ? 'healthy' : 'unhealthy',
          errors: status.overall.errors,
          warnings: status.overall.warnings
        },
        environment: process.env.NODE_ENV,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    next(createError(
      'Failed to check configuration status',
      500,
      'CONFIG_HEALTH_CHECK_ERROR'
    ));
  }
};
