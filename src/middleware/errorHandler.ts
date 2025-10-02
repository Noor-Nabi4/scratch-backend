import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { logger } from '../utils/logger';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
  code?: string;
  meta?: any;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let { statusCode = 500, message } = err;
  let errorCode = 'INTERNAL_ERROR';

  // Handle specific error types
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    ({ statusCode, message, errorCode } = handlePrismaError(err));
  } else if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    statusCode = 500;
    message = 'Database connection error';
    errorCode = 'DATABASE_CONNECTION_ERROR';
  } else if (err instanceof Prisma.PrismaClientRustPanicError) {
    statusCode = 500;
    message = 'Database engine error';
    errorCode = 'DATABASE_ENGINE_ERROR';
  } else if (err instanceof Prisma.PrismaClientInitializationError) {
    statusCode = 500;
    message = 'Database initialization error';
    errorCode = 'DATABASE_INIT_ERROR';
  } else if (err instanceof Prisma.PrismaClientValidationError) {
    statusCode = 400;
    message = 'Invalid data provided';
    errorCode = 'VALIDATION_ERROR';
  } else if (err instanceof JsonWebTokenError) {
    statusCode = 401;
    message = 'Invalid authentication token';
    errorCode = 'INVALID_TOKEN';
  } else if (err instanceof TokenExpiredError) {
    statusCode = 401;
    message = 'Authentication token expired';
    errorCode = 'TOKEN_EXPIRED';
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
  } else if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
    statusCode = 503;
    message = 'Service temporarily unavailable';
    errorCode = 'SERVICE_UNAVAILABLE';
  } else if (err.code === 'ETIMEDOUT') {
    statusCode = 408;
    message = 'Request timeout';
    errorCode = 'TIMEOUT';
  } else if (err.code === 'ECONNRESET') {
    statusCode = 503;
    message = 'Connection reset';
    errorCode = 'CONNECTION_RESET';
  }

  // Log error with context
  logger.error(`Error ${statusCode}: ${message}`, {
    errorCode,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: (req as any).user?.id,
    stack: err.stack,
    originalError: err.name,
    ...(err.meta && { meta: err.meta })
  });

  // Don't leak error details in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'Internal Server Error';
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message,
      ...(process.env.NODE_ENV === 'development' && { 
        stack: err.stack,
        originalError: err.name 
      })
    }
  });
};

function handlePrismaError(err: Prisma.PrismaClientKnownRequestError) {
  let statusCode = 500;
  let message = 'Database error';
  let errorCode = 'DATABASE_ERROR';

  switch (err.code) {
    case 'P2000':
      statusCode = 400;
      message = 'The provided value is too long';
      errorCode = 'VALUE_TOO_LONG';
      break;
    case 'P2001':
      statusCode = 404;
      message = 'Record not found';
      errorCode = 'RECORD_NOT_FOUND';
      break;
    case 'P2002':
      statusCode = 409;
      const target = err.meta?.target as string[];
      message = `Duplicate value for ${target ? target.join(', ') : 'unique field'}`;
      errorCode = 'DUPLICATE_VALUE';
      break;
    case 'P2003':
      statusCode = 400;
      message = 'Foreign key constraint failed';
      errorCode = 'FOREIGN_KEY_ERROR';
      break;
    case 'P2004':
      statusCode = 400;
      message = 'Constraint failed';
      errorCode = 'CONSTRAINT_ERROR';
      break;
    case 'P2005':
      statusCode = 400;
      message = 'Invalid value for field';
      errorCode = 'INVALID_FIELD_VALUE';
      break;
    case 'P2006':
      statusCode = 400;
      message = 'Invalid value provided';
      errorCode = 'INVALID_VALUE';
      break;
    case 'P2007':
      statusCode = 400;
      message = 'Data validation error';
      errorCode = 'DATA_VALIDATION_ERROR';
      break;
    case 'P2008':
      statusCode = 400;
      message = 'Failed to parse query';
      errorCode = 'QUERY_PARSE_ERROR';
      break;
    case 'P2009':
      statusCode = 400;
      message = 'Failed to validate query';
      errorCode = 'QUERY_VALIDATION_ERROR';
      break;
    case 'P2010':
      statusCode = 500;
      message = 'Raw query failed';
      errorCode = 'RAW_QUERY_ERROR';
      break;
    case 'P2011':
      statusCode = 400;
      message = 'Null constraint violation';
      errorCode = 'NULL_CONSTRAINT_ERROR';
      break;
    case 'P2012':
      statusCode = 400;
      message = 'Missing required value';
      errorCode = 'MISSING_REQUIRED_VALUE';
      break;
    case 'P2013':
      statusCode = 400;
      message = 'Missing required argument';
      errorCode = 'MISSING_REQUIRED_ARGUMENT';
      break;
    case 'P2014':
      statusCode = 400;
      message = 'Required relation is missing';
      errorCode = 'MISSING_REQUIRED_RELATION';
      break;
    case 'P2015':
      statusCode = 404;
      message = 'Related record not found';
      errorCode = 'RELATED_RECORD_NOT_FOUND';
      break;
    case 'P2016':
      statusCode = 400;
      message = 'Query interpretation error';
      errorCode = 'QUERY_INTERPRETATION_ERROR';
      break;
    case 'P2017':
      statusCode = 400;
      message = 'Records for relation are not connected';
      errorCode = 'RECORDS_NOT_CONNECTED';
      break;
    case 'P2018':
      statusCode = 400;
      message = 'Required connected records not found';
      errorCode = 'CONNECTED_RECORDS_NOT_FOUND';
      break;
    case 'P2019':
      statusCode = 400;
      message = 'Input error';
      errorCode = 'INPUT_ERROR';
      break;
    case 'P2020':
      statusCode = 400;
      message = 'Value out of range';
      errorCode = 'VALUE_OUT_OF_RANGE';
      break;
    case 'P2021':
      statusCode = 404;
      message = 'Table does not exist';
      errorCode = 'TABLE_NOT_FOUND';
      break;
    case 'P2022':
      statusCode = 404;
      message = 'Column does not exist';
      errorCode = 'COLUMN_NOT_FOUND';
      break;
    case 'P2023':
      statusCode = 400;
      message = 'Inconsistent column data';
      errorCode = 'INCONSISTENT_COLUMN_DATA';
      break;
    case 'P2024':
      statusCode = 408;
      message = 'Connection timeout';
      errorCode = 'CONNECTION_TIMEOUT';
      break;
    case 'P2025':
      statusCode = 404;
      message = 'Record to update not found';
      errorCode = 'UPDATE_RECORD_NOT_FOUND';
      break;
    case 'P2026':
      statusCode = 400;
      message = 'Query parameter error';
      errorCode = 'QUERY_PARAMETER_ERROR';
      break;
    case 'P2027':
      statusCode = 500;
      message = 'Multiple errors occurred';
      errorCode = 'MULTIPLE_ERRORS';
      break;
    case 'P2028':
      statusCode = 500;
      message = 'Transaction API error';
      errorCode = 'TRANSACTION_ERROR';
      break;
    case 'P2030':
      statusCode = 404;
      message = 'Fulltext index not found';
      errorCode = 'FULLTEXT_INDEX_NOT_FOUND';
      break;
    case 'P2033':
      statusCode = 400;
      message = 'Number out of range';
      errorCode = 'NUMBER_OUT_OF_RANGE';
      break;
    case 'P2034':
      statusCode = 409;
      message = 'Transaction conflict';
      errorCode = 'TRANSACTION_CONFLICT';
      break;
    default:
      statusCode = 500;
      message = `Database error: ${err.message}`;
      errorCode = 'UNKNOWN_DATABASE_ERROR';
  }

  return { statusCode, message, errorCode };
}

export const createError = (message: string, statusCode: number = 500, code?: string): AppError => {
  const error: AppError = new Error(message);
  error.statusCode = statusCode;
  error.isOperational = true;
  error.code = code;
  return error;
};

// Async error wrapper for route handlers
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Rate limiting error
export const createRateLimitError = (): AppError => {
  return createError('Too many requests, please try again later', 429, 'RATE_LIMIT_EXCEEDED');
};

// Validation error helper
export const createValidationError = (field: string, message: string): AppError => {
  return createError(`Validation error for ${field}: ${message}`, 400, 'VALIDATION_ERROR');
};

// Authentication errors
export const createAuthError = (message: string = 'Authentication required'): AppError => {
  return createError(message, 401, 'AUTHENTICATION_ERROR');
};

export const createAuthorizationError = (message: string = 'Insufficient permissions'): AppError => {
  return createError(message, 403, 'AUTHORIZATION_ERROR');
};

