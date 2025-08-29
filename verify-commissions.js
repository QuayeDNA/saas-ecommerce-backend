import mongoose from 'mongoose';
import CommissionRecord from './src/models/CommissionRecord.js';

async function verifyCommissions() {
  try {
    await mongoose.connect('mongodb://localhost:27017/saas-ecommerce');

    const commissions = await CommissionRecord.find({});
    console.log('Total commission records:', commissions.length);

    commissions.forEach((commission, index) => {
      console.log(index + 1 + '. Agent ID: ' + commission.agentId + ' - Amount: ' + commission.amount + ' - Status: ' + commission.status);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

verifyCommissions();
