import { db, pool } from './db/connection'
import { createProductRepository } from './repositories/product.repository'
import { createCartRepository } from './repositories/cart.repository'
import { createOrderRepository } from './repositories/order.repository'
import { checkDatabaseHealth } from '@kysera/core'

/**
 * E-Commerce Example
 *
 * Demonstrates:
 * - Complex transactions (checkout process)
 * - Inventory management with optimistic locking
 * - Shopping cart operations
 * - Order lifecycle management
 * - State machine for order status
 */
async function main() {
  console.log('🛒 E-Commerce Example - Kysera ORM')

  // Check database health
  const health = await checkDatabaseHealth(db, pool)
  console.log('Database health:', health)

  // Create repositories
  const productRepo = createProductRepository(db)
  const cartRepo = createCartRepository(db)
  const orderRepo = createOrderRepository(db)

  // Example user ID (in real app, would come from authentication)
  const userId = 1

  // 1. Product Management
  console.log('\n📦 Product Management')
  console.log('Creating products...')

  const laptop = await productRepo.create({
    category_id: 1,
    name: 'Gaming Laptop',
    description: 'High-performance gaming laptop',
    price: 1299.99,
    stock: 10,
    is_active: true
  })
  console.log('Created product:', laptop)

  const mouse = await productRepo.create({
    category_id: 1,
    name: 'Wireless Mouse',
    description: 'Ergonomic wireless mouse',
    price: 29.99,
    stock: 50,
    is_active: true
  })
  console.log('Created product:', mouse)

  // 2. Product Search
  console.log('\n🔍 Product Search')
  const searchResults = await productRepo.search('gaming')
  console.log(`Found ${searchResults.length} products matching "gaming"`)

  // 3. Shopping Cart Operations
  console.log('\n🛒 Shopping Cart')

  // Add items to cart
  console.log('Adding items to cart...')
  await cartRepo.addItem({
    user_id: userId,
    product_id: laptop.id,
    quantity: 1
  })

  await cartRepo.addItem({
    user_id: userId,
    product_id: mouse.id,
    quantity: 2
  })

  // View cart with product details
  const cart = await cartRepo.getCartWithProducts(userId)
  console.log('Cart contents:', cart)

  const cartTotal = await cartRepo.getTotal(userId)
  console.log(`Cart total: $${cartTotal.toFixed(2)}`)

  // 4. Checkout Process (Transaction)
  console.log('\n💳 Checkout Process')

  try {
    const order = await db.transaction().execute(async (trx) => {
      const transactionalProductRepo = createProductRepository(trx)
      const transactionalCartRepo = createCartRepository(trx)
      const transactionalOrderRepo = createOrderRepository(trx)

      // Get cart items
      const cartItems = await transactionalCartRepo.getCartWithProducts(userId)

      if (cartItems.length === 0) {
        throw new Error('Cart is empty')
      }

      // Calculate total
      const total = cartItems.reduce((sum, item) => sum + item.subtotal, 0)

      // Create order
      const newOrder = await transactionalOrderRepo.create({
        user_id: userId,
        total_amount: total,
        status: 'pending'
      })

      // Decrease stock for each product
      for (const item of cartItems) {
        await transactionalProductRepo.decreaseStock(item.product_id, item.quantity)
        console.log(`  ✓ Decreased stock for ${item.product_name}: ${item.quantity} units`)
      }

      // Clear cart
      await transactionalCartRepo.clear(userId)

      console.log('  ✓ Order created successfully')
      return newOrder
    })

    console.log('Order:', order)

    // 5. Order Status Updates (State Machine)
    console.log('\n📋 Order Lifecycle')

    // Process order
    console.log('Processing order...')
    const processingOrder = await orderRepo.updateStatus(order.id, 'processing')
    console.log(`Order status: ${processingOrder.status}`)

    // Ship order
    console.log('Shipping order...')
    const shippedOrder = await orderRepo.updateStatus(order.id, 'shipped')
    console.log(`Order status: ${shippedOrder.status}`)

    // Deliver order
    console.log('Delivering order...')
    const deliveredOrder = await orderRepo.updateStatus(order.id, 'delivered')
    console.log(`Order status: ${deliveredOrder.status}`)

    // Try invalid transition (should fail)
    console.log('\n⚠️ Testing invalid status transition...')
    try {
      await orderRepo.updateStatus(order.id, 'pending')
      console.log('ERROR: Should have failed!')
    } catch (error) {
      console.log(`✓ Correctly rejected invalid transition: ${(error as Error).message}`)
    }

  } catch (error) {
    console.error('Checkout failed:', error)
  }

  // 6. Inventory Check
  console.log('\n📊 Inventory Status')
  const updatedLaptop = await productRepo.findById(laptop.id)
  console.log(`Laptop stock: ${updatedLaptop?.stock} (was 10, ordered 1)`)

  const updatedMouse = await productRepo.findById(mouse.id)
  console.log(`Mouse stock: ${updatedMouse?.stock} (was 50, ordered 2)`)

  // 7. Order History
  console.log('\n📜 Order History')
  const userOrders = await orderRepo.findByUserId(userId)
  console.log(`User has ${userOrders.length} order(s)`)
  userOrders.forEach(order => {
    console.log(`  - Order #${order.id}: ${order.status} - $${order.total_amount}`)
  })

  // Cleanup
  await db.destroy()
  console.log('\n✅ Example completed!')
}

// Run the example
main().catch(error => {
  console.error('Error:', error)
  process.exit(1)
})
