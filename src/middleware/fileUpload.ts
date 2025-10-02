import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { createError, asyncHandler } from './errorHandler';
import { logger } from '../utils/logger';

// File upload configuration
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '5242880'); // 5MB default
const ALLOWED_MIME_TYPES = [
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1, // Only allow 1 file at a time
    fields: 10, // Limit number of fields
    fieldNameSize: 100, // Limit field name size
    fieldSize: 1024 * 1024, // 1MB limit for field values
  },
  fileFilter: (req, file, cb) => {
    try {
      // Check file type
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        logger.warn('File upload rejected - invalid file type', {
          filename: file.originalname,
          mimetype: file.mimetype,
          allowedTypes: ALLOWED_MIME_TYPES,
          ip: req.ip
        });
        return cb(createError(
          `Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`,
          400,
          'INVALID_FILE_TYPE'
        ));
      }

      // Check file extension
      const allowedExtensions = ['.csv', '.txt', '.xls', '.xlsx'];
      const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));
      
      if (!allowedExtensions.includes(fileExtension)) {
        logger.warn('File upload rejected - invalid file extension', {
          filename: file.originalname,
          extension: fileExtension,
          allowedExtensions,
          ip: req.ip
        });
        return cb(createError(
          `Invalid file extension. Allowed extensions: ${allowedExtensions.join(', ')}`,
          400,
          'INVALID_FILE_EXTENSION'
        ));
      }

      // Check filename for security
      if (file.originalname.includes('..') || file.originalname.includes('/') || file.originalname.includes('\\')) {
        logger.warn('File upload rejected - suspicious filename', {
          filename: file.originalname,
          ip: req.ip
        });
        return cb(createError(
          'Invalid filename - path traversal detected',
          400,
          'INVALID_FILENAME'
        ));
      }

      cb(null, true);
    } catch (error) {
      logger.error('File filter error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        filename: file.originalname,
        ip: req.ip
      });
      cb(createError('File validation error', 500, 'FILE_VALIDATION_ERROR'));
    }
  }
});

// Single file upload middleware
export const uploadSingle = (fieldName: string) => {
  return asyncHandler((req: Request, res: Response, next: NextFunction) => {
    const uploadMiddleware = upload.single(fieldName);
    
    uploadMiddleware(req, res, (err: any) => {
      if (err) {
        handleUploadError(err, req, next);
      } else {
        // Validate file was actually uploaded
        if (!req.file) {
          return next(createError(`No file uploaded for field '${fieldName}'`, 400, 'NO_FILE_UPLOADED'));
        }

        // Log successful upload
        logger.info('File uploaded successfully', {
          filename: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
          fieldName,
          ip: req.ip
        });

        next();
      }
    });
  });
};

// Multiple files upload middleware
export const uploadMultiple = (fieldName: string, maxCount: number = 5) => {
  return asyncHandler((req: Request, res: Response, next: NextFunction) => {
    const uploadMiddleware = upload.array(fieldName, maxCount);
    
    uploadMiddleware(req, res, (err: any) => {
      if (err) {
        handleUploadError(err, req, next);
      } else {
        // Validate files were actually uploaded
        if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
          return next(createError(`No files uploaded for field '${fieldName}'`, 400, 'NO_FILES_UPLOADED'));
        }

        // Log successful uploads
        logger.info('Multiple files uploaded successfully', {
          count: req.files.length,
          files: req.files.map(f => ({
            filename: f.originalname,
            size: f.size,
            mimetype: f.mimetype
          })),
          fieldName,
          ip: req.ip
        });

        next();
      }
    });
  });
};

// Handle upload errors
function handleUploadError(err: any, req: Request, next: NextFunction) {
  logger.error('File upload error', {
    error: err.message || 'Unknown upload error',
    code: err.code,
    field: err.field,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return next(createError(
          `File too large. Maximum size allowed: ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(1)}MB`,
          413,
          'FILE_TOO_LARGE'
        ));
      case 'LIMIT_FILE_COUNT':
        return next(createError(
          'Too many files uploaded',
          400,
          'TOO_MANY_FILES'
        ));
      case 'LIMIT_FIELD_KEY':
        return next(createError(
          'Field name too long',
          400,
          'FIELD_NAME_TOO_LONG'
        ));
      case 'LIMIT_FIELD_VALUE':
        return next(createError(
          'Field value too long',
          400,
          'FIELD_VALUE_TOO_LONG'
        ));
      case 'LIMIT_FIELD_COUNT':
        return next(createError(
          'Too many fields',
          400,
          'TOO_MANY_FIELDS'
        ));
      case 'LIMIT_UNEXPECTED_FILE':
        return next(createError(
          `Unexpected file field: ${err.field}`,
          400,
          'UNEXPECTED_FILE_FIELD'
        ));
      case 'LIMIT_PART_COUNT':
        return next(createError(
          'Too many parts in multipart form',
          400,
          'TOO_MANY_PARTS'
        ));
      default:
        return next(createError(
          `Upload error: ${err.message}`,
          400,
          'UPLOAD_ERROR'
        ));
    }
  }

  // Handle custom file filter errors
  if (err.statusCode) {
    return next(err);
  }

  // Generic upload error
  return next(createError(
    'File upload failed',
    500,
    'UPLOAD_FAILED'
  ));
}

// Validate CSV file content
export const validateCSVContent = asyncHandler((req: Request, res: Response, next: NextFunction) => {
  if (!req.file) {
    return next(createError('No file to validate', 400, 'NO_FILE_TO_VALIDATE'));
  }

  try {
    const content = req.file.buffer.toString('utf8');
    
    // Basic CSV validation
    if (!content.trim()) {
      return next(createError('CSV file is empty', 400, 'EMPTY_CSV_FILE'));
    }

    // Check for minimum required structure
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      return next(createError('CSV file must contain at least a header and one data row', 400, 'INVALID_CSV_STRUCTURE'));
    }

    // Validate header row exists
    const header = lines[0];
    if (!header || !header.includes(',')) {
      return next(createError('CSV file must have a valid header row with comma-separated values', 400, 'INVALID_CSV_HEADER'));
    }

    // Check for consistent column count
    const headerColumns = header.split(',').length;
    const inconsistentRows = lines.slice(1).filter(line => {
      const columns = line.split(',').length;
      return columns !== headerColumns;
    });

    if (inconsistentRows.length > 0) {
      logger.warn('CSV file has inconsistent column counts', {
        filename: req.file.originalname,
        expectedColumns: headerColumns,
        inconsistentRowCount: inconsistentRows.length,
        ip: req.ip
      });
      return next(createError(
        `CSV file has ${inconsistentRows.length} rows with inconsistent column counts`,
        400,
        'INCONSISTENT_CSV_COLUMNS'
      ));
    }

    // Check file size vs content
    if (content.length > MAX_FILE_SIZE) {
      return next(createError(
        'CSV content exceeds maximum allowed size',
        413,
        'CSV_CONTENT_TOO_LARGE'
      ));
    }

    logger.info('CSV file validation successful', {
      filename: req.file.originalname,
      rows: lines.length - 1, // Exclude header
      columns: headerColumns,
      size: req.file.size,
      ip: req.ip
    });

    next();
  } catch (error) {
    logger.error('CSV validation error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      filename: req.file?.originalname,
      ip: req.ip
    });
    
    return next(createError(
      'Failed to validate CSV file content',
      400,
      'CSV_VALIDATION_ERROR'
    ));
  }
});

// Sanitize uploaded file
export const sanitizeFile = asyncHandler((req: Request, res: Response, next: NextFunction) => {
  if (!req.file) {
    return next();
  }

  try {
    // Remove any potential BOM (Byte Order Mark)
    if (req.file.buffer.length >= 3) {
      const bom = req.file.buffer.slice(0, 3);
      if (bom[0] === 0xEF && bom[1] === 0xBB && bom[2] === 0xBF) {
        req.file.buffer = req.file.buffer.slice(3);
        logger.debug('Removed BOM from uploaded file', {
          filename: req.file.originalname,
          ip: req.ip
        });
      }
    }

    // Sanitize filename
    req.file.originalname = req.file.originalname
      .replace(/[^a-zA-Z0-9.-]/g, '_') // Replace special chars with underscore
      .replace(/_{2,}/g, '_') // Replace multiple underscores with single
      .substring(0, 255); // Limit filename length

    next();
  } catch (error) {
    logger.error('File sanitization error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      filename: req.file?.originalname,
      ip: req.ip
    });
    
    return next(createError(
      'Failed to sanitize uploaded file',
      500,
      'FILE_SANITIZATION_ERROR'
    ));
  }
});

// Get upload configuration info
export const getUploadConfig = () => ({
  maxFileSize: MAX_FILE_SIZE,
  maxFileSizeMB: (MAX_FILE_SIZE / 1024 / 1024).toFixed(1),
  allowedMimeTypes: ALLOWED_MIME_TYPES,
  allowedExtensions: ['.csv', '.txt', '.xls', '.xlsx']
});
