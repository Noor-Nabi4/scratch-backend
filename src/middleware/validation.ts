import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { createError } from './errorHandler';

export const validate = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req.body);
    
    if (error) {
      const message = error.details.map(detail => detail.message).join(', ');
      return next(createError(message, 400));
    }
    
    next();
  };
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

