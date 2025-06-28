// scripts/testEmail.js
import dotenv from 'dotenv';
import emailService from '../src/services/emailService.js';

dotenv.config();

async function testEmailService() {
  console.log('Testing Gmail Email Service...');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('EMAIL_USER:', process.env.EMAIL_USER);
  
  try {
    // Test connection first
    console.log('\n🔍 Testing Gmail connection...');
    const isConnected = await emailService.verifyConnection();
    if (!isConnected) {
      console.error('❌ Gmail connection failed');
      console.log('💡 Make sure you have:');
      console.log('   - Enabled 2-factor authentication on your Gmail account');
      console.log('   - Generated an App Password (not your regular password)');
      console.log('   - Set EMAIL_USER and EMAIL_PASSWORD in your .env file');
      return;
    }
    console.log('✅ Gmail connection successful');

    // Test email sending
    const testEmail = 'test@example.com'; // Change this to your email to see the actual emails
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
    console.log('📧 Check your inbox for the test emails');
    
  } catch (error) {
    console.error('❌ Email service test failed:', error.message);
    console.log('\n🔧 Troubleshooting tips:');
    console.log('1. Make sure 2FA is enabled on your Gmail account');
    console.log('2. Use an App Password, not your regular Gmail password');
    console.log('3. Check EMAIL_USER and EMAIL_PASSWORD in your .env file');
    console.log('4. Verify your Gmail account allows "Less secure app access" or use OAuth2');
  }
}

testEmailService();