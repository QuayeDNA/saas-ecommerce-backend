import mongoose from 'mongoose';

async function checkUserOrders() {
  try {
    await mongoose.connect('mongodb://localhost:27017/saas-ecommerce');

    const usersToCheck = [
      { id: '688ec3502443ed871548ad98', name: 'Kweku Ananse' },
      { id: '689c4945ebd3a0dff8b99eff', name: 'Another Tester' }
    ];

    for (const user of usersToCheck) {
      console.log(`${user.name} orders:`);

      const orders = await mongoose.connection.db.collection('orders').find({
        tenantId: user.id
      }).toArray();

      if (orders.length === 0) {
        console.log('  No orders found');
      } else {
        orders.forEach((order, index) => {
          console.log(`  ${index + 1}. Status: ${order.status}, Payment: ${order.paymentStatus}, Date: ${order.createdAt}, Total: ${order.total}`);
        });
      }
      console.log('');
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

checkUserOrders();
