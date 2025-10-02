import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';

interface EmailConfig {
  to: string;
  firstName: string;
  resultCode: string;
  prizeType: string;
  prizeValue?: string;
  description?: string;
  isWinner: boolean;
}

class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendResultEmail(config: EmailConfig): Promise<void> {
    const { to, firstName, resultCode, prizeType, prizeValue, description, isWinner } = config;

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
      from: `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`,
      to,
      subject,
      text: textContent,
      html: htmlContent,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      logger.info('Result email sent successfully', { to, resultCode });
    } catch (error) {
      logger.error('Failed to send result email', { error, to, resultCode });
      throw error;
    }
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

