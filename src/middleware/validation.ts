import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { createError, createValidationError, asyncHandler } from './errorHandler';
import { logger } from '../utils/logger';

export const validate = (schema: Joi.ObjectSchema, options?: {
  allowUnknown?: boolean;
  stripUnknown?: boolean;
  abortEarly?: boolean;
}) => {
  return asyncHandler((req: Request, res: Response, next: NextFunction) => {
    try {
      const validationOptions = {
        allowUnknown: options?.allowUnknown || false,
        stripUnknown: options?.stripUnknown || true,
        abortEarly: options?.abortEarly || false,
        ...options
      };

      const { error, value } = schema.validate(req.body, validationOptions);
      
      if (error) {
        const validationErrors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message.replace(/"/g, ''),
          value: detail.context?.value
        }));

        logger.warn('Validation failed', {
          url: req.url,
          method: req.method,
          errors: validationErrors,
          ip: req.ip
        });

        const message = validationErrors.map(err => `${err.field}: ${err.message}`).join(', ');
        return next(createValidationError('request body', message));
      }
      
      // Replace req.body with validated and sanitized data
      req.body = value;
      next();
    } catch (err) {
      logger.error('Validation middleware error', {
        error: err instanceof Error ? err.message : 'Unknown error',
        url: req.url,
        method: req.method
      });
      next(createError('Validation service error', 500, 'VALIDATION_SERVICE_ERROR'));
    }
  });
};

// Validate query parameters
export const validateQuery = (schema: Joi.ObjectSchema) => {
  return asyncHandler((req: Request, res: Response, next: NextFunction) => {
    try {
      const { error, value } = schema.validate(req.query, {
        allowUnknown: false,
        stripUnknown: true,
        abortEarly: false
      });
      
      if (error) {
        const validationErrors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message.replace(/"/g, ''),
          value: detail.context?.value
        }));

        logger.warn('Query validation failed', {
          url: req.url,
          method: req.method,
          errors: validationErrors,
          ip: req.ip
        });

        const message = validationErrors.map(err => `${err.field}: ${err.message}`).join(', ');
        return next(createValidationError('query parameters', message));
      }
      
      req.query = value;
      next();
    } catch (err) {
      logger.error('Query validation middleware error', {
        error: err instanceof Error ? err.message : 'Unknown error',
        url: req.url,
        method: req.method
      });
      next(createError('Query validation service error', 500, 'VALIDATION_SERVICE_ERROR'));
    }
  });
};

// Validate URL parameters
export const validateParams = (schema: Joi.ObjectSchema) => {
  return asyncHandler((req: Request, res: Response, next: NextFunction) => {
    try {
      const { error, value } = schema.validate(req.params, {
        allowUnknown: false,
        stripUnknown: true,
        abortEarly: false
      });
      
      if (error) {
        const validationErrors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message.replace(/"/g, ''),
          value: detail.context?.value
        }));

        logger.warn('Parameter validation failed', {
          url: req.url,
          method: req.method,
          errors: validationErrors,
          ip: req.ip
        });

        const message = validationErrors.map(err => `${err.field}: ${err.message}`).join(', ');
        return next(createValidationError('URL parameters', message));
      }
      
      req.params = value;
      next();
    } catch (err) {
      logger.error('Parameter validation middleware error', {
        error: err instanceof Error ? err.message : 'Unknown error',
        url: req.url,
        method: req.method
      });
      next(createError('Parameter validation service error', 500, 'VALIDATION_SERVICE_ERROR'));
    }
  });
};

// Common validation schemas
export const schemas = {
  playClaim: Joi.object({
    token: Joi.string().required(),
    firstName: Joi.string().min(1).max(50).required(),
    lastName: Joi.string().min(1).max(50).required(),
    phone: Joi.string().pattern(/^\+?[\d\s\-\(\)]+$/).min(10).max(20).required(),
    email: Joi.string().email().optional(),
    age: Joi.number().integer().min(parseInt(process.env.MIN_AGE || '18')).max(120).required(),
    acceptTerms: Joi.boolean().valid(true).required()
  }),

  adminLogin: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required()
  }),

  resultType: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    code: Joi.string().min(1).max(50).required(),
    description: Joi.string().max(500).optional(),
    weight: Joi.number().integer().min(1).default(1),
    stockLimit: Joi.number().integer().min(0).optional(),
    isActive: Joi.boolean().default(true)
  }),

  tokenUpload: Joi.object({
    tokens: Joi.array().items(
      Joi.object({
        code: Joi.string().required(),
        metadata: Joi.object().optional()
      })
    ).min(1).required()
  }),

  playSearch: Joi.object({
    query: Joi.string().min(1).required()
  }),

  playRedeem: Joi.object({
    redeemedBy: Joi.string().min(1).max(100).required(),
    notes: Joi.string().max(500).optional()
  })
};

