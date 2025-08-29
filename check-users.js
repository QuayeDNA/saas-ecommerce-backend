import User from './src/models/User.js';
import connectDB from './src/config/db.js';

async function checkUsers() {
  try {
    await connectDB();
    const users = await User.find({}).select('fullName email userType isActive');
    console.log('Users found:', users.length);
    users.forEach(user => {
      console.log(`- ${user.fullName} (${user.email}) - ${user.userType} - Active: ${user.isActive}`);
    });
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkUsers();
