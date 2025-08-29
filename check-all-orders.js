import mongoose from 'mongoose';

async function checkAllOrders() {
  try {
    await mongoose.connect('mongodb://localhost:27017/saas-ecommerce');

    const orders = await mongoose.connection.db.collection('orders').find({}).toArray();
    console.log('Total orders:', orders.length);

    const ordersByTenant = {};
    orders.forEach(order => {
      const tenantId = order.tenantId?.toString();
      if (tenantId) {
        if (!ordersByTenant[tenantId]) {
          ordersByTenant[tenantId] = [];
        }
        ordersByTenant[tenantId].push(order);
      }
    });

    console.log('Orders by tenant:');
    Object.keys(ordersByTenant).forEach(tenantId => {
      console.log(`Tenant ${tenantId}: ${ordersByTenant[tenantId].length} orders`);
      // Show first order details
      const firstOrder = ordersByTenant[tenantId][0];
      console.log(`  First order - Status: ${firstOrder.status}, Payment: ${firstOrder.paymentStatus}, Total: ${firstOrder.total}`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

checkAllOrders();
