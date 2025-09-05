// api/contact.js
import nodemailer from 'nodemailer';

// Rate limiting store (in production, use Redis or similar)
const rateLimitStore = new Map();

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { name, email, message, website, recaptchaToken } = req.body;

    // Get client IP
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    // Rate limiting
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({ 
        success: false, 
        message: 'Too many requests. Please wait a few minutes.' 
      });
    }

    // Honeypot check
    if (website) {
      // Bot detected - return success to fool the bot
      return res.status(200).json({ 
        success: true, 
        message: 'Thank you for your message!' 
      });
    }

    // Validation
    const validation = validateInputs(name, email, message);
    if (!validation.valid) {
      return res.status(400).json({ 
        success: false, 
        message: validation.message 
      });
    }

    // Optional: Verify reCAPTCHA
    if (process.env.RECAPTCHA_SECRET_KEY && recaptchaToken) {
      const recaptchaValid = await verifyRecaptcha(recaptchaToken);
      if (!recaptchaValid) {
        return res.status(400).json({ 
          success: false, 
          message: 'reCAPTCHA verification failed' 
        });
      }
    }

    // Check for spam
    if (isSpam(message)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Your message appears to contain spam content' 
      });
    }

    // Send email
    await sendEmail(name, email, message);

    return res.status(200).json({ 
      success: true, 
      message: 'Thank you for your message! I\'ll get back to you soon.' 
    });

  } catch (error) {
    console.error('Contact form error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'An error occurred. Please try again later.' 
    });
  }
}

function checkRateLimit(ip) {
  const now = Date.now();
  const limit = 3; // 3 requests
  const window = 5 * 60 * 1000; // 5 minutes

  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, [now]);
    return true;
  }

  const timestamps = rateLimitStore.get(ip).filter(t => now - t < window);
  
  if (timestamps.length >= limit) {
    return false;
  }

  timestamps.push(now);
  rateLimitStore.set(ip, timestamps);
  return true;
}

function validateInputs(name, email, message) {
  // Name validation
  if (!name || name.length < 2 || name.length > 50) {
    return { valid: false, message: 'Please enter a valid name (2-50 characters)' };
  }
  if (!/^[A-Za-z\s\-']+$/.test(name)) {
    return { valid: false, message: 'Name contains invalid characters' };
  }

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return { valid: false, message: 'Please enter a valid email address' };
  }

  // Message validation
  if (!message || message.length < 10 || message.length > 1000) {
    return { valid: false, message: 'Message must be between 10 and 1000 characters' };
  }

  return { valid: true };
}

function isSpam(message) {
  const spamPatterns = [
    /\b(viagra|cialis|casino|poker|payday loan|crypto)\b/i,
    /\[url=/i,
    /\<a href=/i,
    /(http|https):\/\/[^\s]{50,}/i,
    /(.)\1{10,}/i,
  ];

  for (const pattern of spamPatterns) {
    if (pattern.test(message)) {
      return true;
    }
  }

  // Check for excessive links
  const linkCount = (message.match(/(http|https|www\.)/gi) || []).length;
  if (linkCount > 3) {
    return true;
  }

  return false;
}

async function verifyRecaptcha(token) {
  const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${token}`
  });

  const data = await response.json();
  return data.success && data.score >= 0.5;
}

async function sendEmail(name, email, message) {
  // Create transporter based on your email service
  // Option 1: Gmail
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS // App-specific password
    }
  });

  // Option 2: SendGrid (recommended for production)
  // const transporter = nodemailer.createTransport({
  //   host: 'smtp.sendgrid.net',
  //   port: 587,
  //   auth: {
  //     user: 'apikey',
  //     pass: process.env.SENDGRID_API_KEY
  //   }
  // });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.ADMIN_EMAIL,
    subject: 'New Contact Form Submission - Hyder Media',
    text: `
Name: ${name}
Email: ${email}
Message: ${message}

Submitted: ${new Date().toISOString()}
    `,
    html: `
      <h2>New Contact Form Submission</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Message:</strong></p>
      <p>${message.replace(/\n/g, '<br>')}</p>
      <hr>
      <p><small>Submitted: ${new Date().toISOString()}</small></p>
    `
  };

  await transporter.sendMail(mailOptions);
}