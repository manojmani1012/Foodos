import express from 'express'
import authRouter from './routers/auth.js'
import adminRouter from './routers/admin.js'
import customerRouter from './routers/customer.js'
import deliveryRouter from './routers/delivery.js'
import restaurantRouter from './routers/restaurant.js'
import { notFoundHandler } from './middleware/notFound.js'
import { errorHandler } from './middleware/errorHandler.js'

const app = express()

app.use(express.json())

app.get('/health', (request, response) => {
  response.json({
    ok: true,
    service: 'foodos-backend',
    phase: 'phase-2-backend-foundation',
  })
})

app.get('/api/v1', (request, response) => {
  response.json({
    ok: true,
    message: 'Foodos API is running',
    routes: ['auth', 'customer', 'restaurant', 'delivery', 'admin'],
  })
})

app.use('/api/v1/auth', authRouter)
app.use('/api/v1/customer', customerRouter)
app.use('/api/v1/restaurant', restaurantRouter)
app.use('/api/v1/delivery', deliveryRouter)
app.use('/api/v1/admin', adminRouter)

app.use(notFoundHandler)
app.use(errorHandler)

export default app
