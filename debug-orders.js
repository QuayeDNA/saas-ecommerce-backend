import mongoose from 'mongoose';

async function debugOrderQuery() {
  try {
    await mongoose.connect('mongodb://localhost:27017/saas-ecommerce');

    const usersToCheck = [
      { id: '688ec3502443ed871548ad98', name: 'Kweku Ananse' },
      { id: '689c4945ebd3a0dff8b99eff', name: 'Another Tester' }
    ];

    for (const user of usersToCheck) {
      console.log(`\n=== ${user.name} ===`);
      console.log(`User ID: ${user.id}`);

      // Try different query approaches
      const orders1 = await mongoose.connection.db.collection('orders').find({
        tenantId: user.id
      }).toArray();

      const orders2 = await mongoose.connection.db.collection('orders').find({
        tenantId: new mongoose.Types.ObjectId(user.id)
      }).toArray();

      console.log(`String tenantId query: ${orders1.length} orders`);
      console.log(`ObjectId tenantId query: ${orders2.length} orders`);

      // Check createdBy field too
      const orders3 = await mongoose.connection.db.collection('orders').find({
        createdBy: user.id
      }).toArray();

      const orders4 = await mongoose.connection.db.collection('orders').find({
        createdBy: new mongoose.Types.ObjectId(user.id)
      }).toArray();

      console.log(`String createdBy query: ${orders3.length} orders`);
      console.log(`ObjectId createdBy query: ${orders4.length} orders`);

      // Show sample order if found
      const allOrders = [...orders1, ...orders2, ...orders3, ...orders4];
      if (allOrders.length > 0) {
        const sampleOrder = allOrders[0];
        console.log('Sample order tenantId type:', typeof sampleOrder.tenantId);
        console.log('Sample order tenantId value:', sampleOrder.tenantId);
        console.log('Sample order createdBy type:', typeof sampleOrder.createdBy);
        console.log('Sample order createdBy value:', sampleOrder.createdBy);
      }
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

debugOrderQuery();
