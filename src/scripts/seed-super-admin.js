import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import connectDB from '../config/db.js';
import User from '../models/User.js';
import logger from '../utils/logger.js';

// Connect to database
connectDB();

// Seed super admin function
const seedSuperAdmin = async () => {
  try {
    logger.info('Starting super admin seeding...');
    
    // Check if super admin already exists
    const existingAdmin = await User.findOne({ 
      email: 'admin@saastleplay.com',
      userType: 'super_admin'
    });
    
    if (existingAdmin) {
      logger.info('Super admin already exists. Skipping creation.');
      logger.info(`Existing admin ID: ${existingAdmin._id}`);
      return;
    }
    
    // Create super admin user
    const hashedPassword = await bcrypt.hash('Admin@123', 10);
    
    const adminUser = new User({
      fullName: 'Super Admin',
      email: 'admin@saastleplay.com',
      phone: '+233500000000',
      password: hashedPassword,
      userType: 'super_admin',
      isVerified: true,
      role: 'admin'
    });
    
    await adminUser.save();
    logger.info(`Super admin created successfully!`);
    logger.info(`Admin ID: ${adminUser._id}`);
    logger.info(`Email: ${adminUser.email}`);
    logger.info(`Password: Admin@123`);
    
  } catch (error) {
    logger.error(`Super admin seeding failed: ${error.message}`);
    console.error(error);
  } finally {
    // Disconnect from database
    mongoose.connection.close();
    logger.info('Database connection closed');
  }
};

// Run the seed function
seedSuperAdmin(); 