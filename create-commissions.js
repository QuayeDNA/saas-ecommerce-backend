import mongoose from 'mongoose';
import CommissionRecord from './src/models/CommissionRecord.js';

async function createMissingCommissions() {
  try {
    await mongoose.connect('mongodb://localhost:27017/saas-ecommerce');

    const startDate = new Date('2025-08-01');
    const endDate = new Date('2025-08-31');

    // Users who need commission records
    const usersToProcess = [
      { id: '688ec3502443ed871548ad98', name: 'Kweku Ananse' },
      { id: '689c4945ebd3a0dff8b99eff', name: 'Another Tester' }
    ];

    for (const user of usersToProcess) {
      console.log(`Processing commissions for ${user.name}...`);

      // Find existing commission record for this month
      const existingCommission = await CommissionRecord.findOne({
        agentId: user.id,
        periodStart: startDate,
        periodEnd: endDate
      });

      if (existingCommission) {
        console.log(`  Commission record already exists for ${user.name}`);
        continue;
      }

      // Get orders for this user in August 2025
      const orders = await mongoose.connection.db.collection('orders').find({
        tenantId: new mongoose.Types.ObjectId(user.id),
        createdAt: { $gte: startDate, $lte: endDate },
        status: 'completed',
        paymentStatus: 'paid'
      }).toArray();

      console.log(`  Found ${orders.length} completed paid orders`);

      if (orders.length === 0) {
        // Try without payment status filter to see what orders exist
        const allOrders = await mongoose.connection.db.collection('orders').find({
          tenantId: new mongoose.Types.ObjectId(user.id)
        }).toArray();

        console.log(`  Total orders for user: ${allOrders.length}`);
        if (allOrders.length > 0) {
          allOrders.forEach((order, index) => {
            console.log(`    ${index + 1}. Status: ${order.status}, Payment: ${order.paymentStatus}, Total: ${order.total}`);
          });
        }
        continue;
      }

      const totalRevenue = orders.reduce((sum, order) => sum + (order.total || 0), 0);
      const commissionAmount = totalRevenue * 0.1; // 10% commission rate

      // Create commission record
      const commissionRecord = new CommissionRecord({
        agentId: user.id,
        tenantId: user.id,
        period: 'monthly',
        periodStart: startDate,
        periodEnd: endDate,
        totalOrders: orders.length,
        totalRevenue: totalRevenue,
        commissionRate: 0.1,
        amount: commissionAmount,
        status: 'pending'
      });

      await commissionRecord.save();
      console.log(`  ✅ Created commission record:`);
      console.log(`    Orders: ${orders.length}`);
      console.log(`    Revenue: $${totalRevenue.toFixed(2)}`);
      console.log(`    Commission: $${commissionAmount.toFixed(2)}`);
    }

    console.log('\n✅ Commission creation process completed!');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

createMissingCommissions();
