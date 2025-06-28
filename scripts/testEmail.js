// scripts/testEmail.js
import dotenv from 'dotenv';
import emailService from '../src/services/emailService.js';

dotenv.config();

async function testEmailService() {
  console.log('Testing Email Service...');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('EMAIL_HOST:', process.env.EMAIL_HOST);
  console.log('EMAIL_PORT:', process.env.EMAIL_PORT);
  console.log('EMAIL_USER:', process.env.EMAIL_USER);
  
  try {
    // Test connection first
    console.log('\n🔍 Testing email connection...');
    const isConnected = await emailService.verifyConnection();
    if (!isConnected) {
      console.error('❌ Email service connection failed');
      console.log('💡 Make sure MailHog is running on port 1025 (SMTP) and 8025 (Web UI)');
      console.log('💡 Start MailHog with: docker run -p 1025:1025 -p 8025:8025 mailhog/mailhog');
      return;
    }
    console.log('✅ Email service connection successful');

    // Test email sending
    const testEmail = 'test@example.com';
    const testToken = 'test-token-123';
    
    console.log('\n🔍 Testing verification email...');
    await emailService.sendVerificationEmail(testEmail, testToken);
    console.log('✅ Verification email sent successfully');
    
    console.log('\n🔍 Testing password reset email...');
    await emailService.sendPasswordResetEmail(testEmail, testToken);
    console.log('✅ Password reset email sent successfully');
    
    console.log('\n🔍 Testing welcome email...');
    await emailService.sendWelcomeEmail(testEmail, 'Test User');
    console.log('✅ Welcome email sent successfully');
    
    console.log('\n🎉 All email tests passed!');
    
    if (process.env.NODE_ENV === 'development') {
      console.log('\n📧 Check MailHog UI at: http://localhost:8025');
      console.log('📧 SMTP Server: localhost:1025');
    }
    
  } catch (error) {
    console.error('❌ Email service test failed:', error.message);
    console.log('\n🔧 Troubleshooting tips:');
    console.log('1. Make sure MailHog is running: docker run -p 1025:1025 -p 8025:8025 mailhog/mailhog');
    console.log('2. Check that EMAIL_PORT=1025 (not 8025) in your .env file');
    console.log('3. Verify your .env file is loaded correctly');
    console.log('4. Check that NODE_ENV=development');
  }
}

testEmailService();