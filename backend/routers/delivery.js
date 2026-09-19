import { Router } from 'express'

const router = Router()

router.get('/dashboard', (request, response) => {
  response.status(501).json({
    ok: false,
    message: 'Delivery dashboard API is not implemented yet',
  })
})

router.get('/requests', (request, response) => {
  response.status(501).json({
    ok: false,
    message: 'Delivery requests API is not implemented yet',
  })
})

export default router
