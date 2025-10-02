import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';
import { createError } from '../middleware/errorHandler';

interface EmailConfig {
  to: string;
  firstName: string;
  resultCode: string;
  prizeType: string;
  prizeValue?: string;
  description?: string;
  isWinner: boolean;
}

interface EmailServiceHealth {
  status: 'healthy' | 'unhealthy' | 'degraded';
  lastError?: string;
  lastSuccessfulSend?: Date;
  totalSent: number;
  totalFailed: number;
}

class EmailService {
  private transporter!: nodemailer.Transporter;
  private isConfigured: boolean = false;
  private health: EmailServiceHealth = {
    status: 'healthy',
    totalSent: 0,
    totalFailed: 0
  };

  constructor() {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    try {
      // Validate required environment variables
      if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        logger.warn('Email service not configured - missing SMTP environment variables');
        this.isConfigured = false;
        this.health.status = 'unhealthy';
        this.health.lastError = 'Missing SMTP configuration';
        return;
      }

      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
        connectionTimeout: 10000, // 10 seconds
        greetingTimeout: 5000,    // 5 seconds
        socketTimeout: 15000,     // 15 seconds
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        pool: true, // Use connection pooling
        maxConnections: 5,
        maxMessages: 100,
        rateLimit: 10, // Max 10 emails per second
      });

      this.isConfigured = true;
      this.health.status = 'healthy';
      
      // Test the connection
      this.testConnection();
      
      logger.info('Email service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize email service', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      this.isConfigured = false;
      this.health.status = 'unhealthy';
      this.health.lastError = error instanceof Error ? error.message : 'Unknown error';
    }
  }

  private async testConnection() {
    if (!this.isConfigured) return;

    try {
      await this.transporter.verify();
      logger.info('Email service connection verified');
      this.health.status = 'healthy';
      this.health.lastError = undefined;
    } catch (error) {
      logger.error('Email service connection test failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      this.health.status = 'degraded';
      this.health.lastError = error instanceof Error ? error.message : 'Unknown error';
    }
  }

  public getHealth(): EmailServiceHealth {
    return { ...this.health };
  }

  async sendResultEmail(config: EmailConfig): Promise<void> {
    const { to, firstName, resultCode, prizeType, prizeValue, description, isWinner } = config;

    // Check if email service is configured
    if (!this.isConfigured) {
      const error = createError('Email service not configured', 503, 'EMAIL_SERVICE_NOT_CONFIGURED');
      this.health.totalFailed++;
      throw error;
    }

    // Validate email address
    if (!this.isValidEmail(to)) {
      const error = createError(`Invalid email address: ${to}`, 400, 'INVALID_EMAIL_ADDRESS');
      this.health.totalFailed++;
      throw error;
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const subject = isWinner 
          ? `🎉 Congratulations! You've won: ${prizeType}`
          : `Thank you for playing!`;

        const htmlContent = this.generateEmailHTML({
          firstName,
          resultCode,
          prizeType,
          prizeValue,
          description,
          isWinner
        });

        const textContent = this.generateEmailText({
          firstName,
          resultCode,
          prizeType,
          prizeValue,
          description,
          isWinner
        });

        const mailOptions = {
          from: `"${process.env.FROM_NAME || 'Scratch & Win'}" <${process.env.FROM_EMAIL || process.env.SMTP_USER}>`,
          to,
          subject,
          text: textContent,
          html: htmlContent,
          headers: {
            'X-Priority': '3',
            'X-MSMail-Priority': 'Normal',
            'X-Mailer': 'Scratch & Win Game',
          },
        };

        const info = await this.transporter.sendMail(mailOptions);
        
        // Success
        this.health.totalSent++;
        this.health.lastSuccessfulSend = new Date();
        this.health.status = 'healthy';
        this.health.lastError = undefined;

        logger.info('Result email sent successfully', { 
          to, 
          resultCode, 
          messageId: info.messageId,
          attempt 
        });
        
        return; // Success, exit retry loop

      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown email error');
        
        logger.warn(`Email send attempt ${attempt} failed`, {
          to,
          resultCode,
          attempt,
          maxRetries,
          error: lastError.message
        });

        // Handle specific email errors
        if (this.isTemporaryError(lastError)) {
          if (attempt < maxRetries) {
            // Wait before retry (exponential backoff)
            const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        } else {
          // Permanent error, don't retry
          break;
        }
      }
    }

    // All retries failed
    this.health.totalFailed++;
    this.health.lastError = lastError?.message;
    
    if (this.health.totalFailed > this.health.totalSent * 0.5) {
      this.health.status = 'degraded';
    }

    logger.error('Failed to send result email after all retries', { 
      to, 
      resultCode, 
      error: lastError?.message,
      attempts: maxRetries 
    });

    // Determine error type and throw appropriate error
    if (lastError) {
      if (this.isAuthenticationError(lastError)) {
        throw createError('Email authentication failed', 503, 'EMAIL_AUTH_FAILED');
      } else if (this.isNetworkError(lastError)) {
        throw createError('Email service temporarily unavailable', 503, 'EMAIL_SERVICE_UNAVAILABLE');
      } else if (this.isRateLimitError(lastError)) {
        throw createError('Email rate limit exceeded', 429, 'EMAIL_RATE_LIMIT_EXCEEDED');
      } else {
        throw createError(`Email delivery failed: ${lastError.message}`, 503, 'EMAIL_DELIVERY_FAILED');
      }
    }

    throw createError('Email delivery failed', 503, 'EMAIL_DELIVERY_FAILED');
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private isTemporaryError(error: Error): boolean {
    const temporaryErrors = [
      'ETIMEDOUT',
      'ECONNRESET',
      'ENOTFOUND',
      'ECONNREFUSED',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'EAI_AGAIN'
    ];
    
    return temporaryErrors.some(code => 
      error.message.includes(code) || 
      (error as any).code === code
    );
  }

  private isAuthenticationError(error: Error): boolean {
    const authErrors = [
      'Invalid login',
      'Authentication failed',
      'Username and Password not accepted',
      'EAUTH'
    ];
    
    return authErrors.some(msg => 
      error.message.includes(msg) || 
      (error as any).code === 'EAUTH'
    );
  }

  private isNetworkError(error: Error): boolean {
    const networkErrors = [
      'ENOTFOUND',
      'ECONNREFUSED',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ETIMEDOUT',
      'ECONNRESET'
    ];
    
    return networkErrors.some(code => 
      error.message.includes(code) || 
      (error as any).code === code
    );
  }

  private isRateLimitError(error: Error): boolean {
    return error.message.includes('rate limit') || 
           error.message.includes('too many') ||
           (error as any).responseCode === 421;
  }

  private generateEmailHTML(config: {
    firstName: string;
    resultCode: string;
    prizeType: string;
    prizeValue?: string;
    description?: string;
    isWinner: boolean;
  }): string {
    const { firstName, resultCode, prizeType, prizeValue, description, isWinner } = config;
    
    const whatsappMessage = encodeURIComponent(
      `I just played ${process.env.APP_NAME} and ${isWinner ? 'WON' : 'played'}! ` +
      `My result code is: ${resultCode}${isWinner ? ` - Prize: ${prizeType}` : ''}`
    );
    
    const whatsappUrl = `https://wa.me/?text=${whatsappMessage}`;

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${isWinner ? 'Congratulations!' : 'Thank you for playing!'}</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .result-code { background: #fff; border: 2px dashed #667eea; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px; }
          .code { font-size: 24px; font-weight: bold; color: #667eea; letter-spacing: 2px; }
          .button { display: inline-block; background: #25D366; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 5px; }
          .button:hover { background: #128C7E; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${isWinner ? '🎉 Congratulations!' : 'Thank you for playing!'}</h1>
          <p>${isWinner ? `You've won: ${prizeType}` : 'Better luck next time!'}</p>
        </div>
        
        <div class="content">
          <p>Hi ${firstName},</p>
          
          <p>${isWinner 
            ? `Congratulations! You've won <strong>${prizeType}</strong> in our Scratch & Win game!`
            : 'Thank you for playing our Scratch & Win game! While you didn\'t win this time, we hope you had fun playing.'
          }</p>
          
          <div class="result-code">
            <p><strong>Your Result Code:</strong></p>
            <div class="code">${resultCode}</div>
            <p><small>Keep this code safe - you'll need it to claim your prize!</small></p>
          </div>
          
          ${isWinner ? `
          <p><strong>How to claim your prize:</strong></p>
          <ol>
            <li>Visit our store with this result code</li>
            <li>Show the code to our staff</li>
            <li>Enjoy your ${prizeType}!</li>
          </ol>
          ` : ''}
          
          <p>Share your result with friends:</p>
          <a href="${whatsappUrl}" class="button">📱 Share on WhatsApp</a>
          
          <p>Thank you for playing ${process.env.APP_NAME}!</p>
        </div>
        
        <div class="footer">
          <p>This is an automated message. Please do not reply to this email.</p>
          <p>© ${new Date().getFullYear()} ${process.env.APP_NAME}. All rights reserved.</p>
        </div>
      </body>
      </html>
    `;
  }

  private generateEmailText(config: {
    firstName: string;
    resultCode: string;
    prizeType: string;
    prizeValue?: string;
    description?: string;
    isWinner: boolean;
  }): string {
    const { firstName, resultCode, prizeType, prizeValue, description, isWinner } = config;
    
    return `
${isWinner ? '🎉 Congratulations!' : 'Thank you for playing!'}

Hi ${firstName},

${isWinner 
  ? `Congratulations! You've won ${prizeType} in our Scratch & Win game!`
  : 'Thank you for playing our Scratch & Win game! While you didn\'t win this time, we hope you had fun playing.'
}

Your Result Code: ${resultCode}
${isWinner ? `Prize: ${prizeType}` : ''}

${isWinner ? `
How to claim your prize:
1. Visit our store with this result code
2. Show the code to our staff
3. Enjoy your ${prizeType}!
` : ''}

Share your result with friends on WhatsApp!

Thank you for playing ${process.env.APP_NAME}!

---
This is an automated message. Please do not reply to this email.
© ${new Date().getFullYear()} ${process.env.APP_NAME}. All rights reserved.
    `.trim();
  }
}

export const emailService = new EmailService();

